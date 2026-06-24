<!-- WatchSchedule spec set — v2 (cross-referenced & seam-verified). Document 5 of 6: schedule. Owns generation orchestration. Seam with fairness.md: selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned) -> { crew_id, reason_code, detail }. -->
# schedule.md — WatchSchedule Generation Engine

> **Purpose.** This document specifies the watch-schedule generation engine — the orchestration that turns crew + settings + the fairness ledger into a concrete rota written to the database. It is the spec for the `generate-schedule` Edge Function (`backend.md`). The *definition of fairness* (eligible-set constraints, candidate cost, tie-breaking, ledger updates, score) lives in `fairness.md`; **this document owns iteration, lane structure, the two-rotation mechanics, persistence, and regeneration.** Together they fully define generation.

**Determinism (inherited).** Same crew + settings + ledger -> identical schedule. The engine is a pure function of its inputs plus the ordered rules in `fairness.md`. No randomness anywhere.

---

## 1. What "Generate" Produces

A single run of `generate-schedule` produces:
- One new **`schedules`** row (the container) with `start_date`, `end_date`, `horizon_weeks`, `is_current = true` (and flips any prior current schedule to `false`).
- A full set of **`watch_assignments`** — for every lane, for every scheduled date in the horizon, one assigned crew member (with `day_type` and `is_friday`).
- Updated **`fairness_ledger`** rows (incremented as assignments are made — per `fairness.md`).
- Appended **`fairness_events`** — one per decision, recording why (so the chatbot can explain).
- On first run: sets `profiles.onboarding_complete = true`, `onboarding_step = 'complete'`.

All writes are performed by the Edge Function using the **service-role** client. The client never writes these tables; it reads them via RLS-scoped selects.

---

## 2. Inputs

Loaded server-side at the start of a run (re-derive `vessel_id` from the JWT — never trust the client):

- **`watch_settings`** for the vessel: `tier`, `selected_departments`, `horizon_weeks` (1–13, capped at ~3 months), `schedule_start_date`, `include_weekends`, rotation anchors.
- **`crew_members`**: the full crew, with `department` and `eligible`.
- **`watch_lanes`**: the concrete lanes (derived from settings — see section 3).
- **`fairness_ledger`**: the current persistent state per (lane, crew) — possibly seeded by `seed-fairness`, possibly zero.
- **Run parameters** from the request: `from_date` (optional), `regenerate` (bool).

---

## 3. Deriving Lanes from Settings

Lanes are the unit of generation and of fairness. Derive (and persist to `watch_lanes`) from tier + `selected_departments`:

- **Solo** -> exactly **one** lane: `kind='solo'`, `department=null`, `label='Watch'`. Pool = all eligible crew regardless of department.
- **Dual** -> exactly **two** lanes: `kind='dept'`, one per selected department. Pool of each = eligible crew in that department.
- **Triple** -> exactly **three** lanes: `kind='dept'`, one per selected department.

If lanes already exist for the vessel and settings are unchanged, reuse them (so the ledger keys stay stable). If `selected_departments` changed since last time, reconcile via the `watch_lanes.active` flag (never delete — that would cascade away fairness history): create genuinely new lanes (`active=true`); retire lanes no longer used by setting **`active=false`** (their `fairness_ledger`/`fairness_events` are retained); and if a previously-retired department is re-added, **re-activate its existing lane** (`active=true`) rather than inserting a duplicate, so the ledger key stays stable. **Changing tier/departments is a significant action**; on reconcile, surface to the captain that fairness for a newly added department starts fresh (no history) unless seeded.

> **Active-lane contract (Phase 6/7 must honour):** generation and the fairness engine operate on **`active=true` lanes only**. Retired (`active=false`) lanes are kept for history and are never scheduled against.

> The lane is the boundary of fairness. One ledger per lane. The engine loops lanes independently — there is no cross-lane balancing (a deckhand's burden never affects an engineer's).

---

## 4. The Two-Rotation Model (per lane)

Within each lane, the engine maintains **two conceptually separate rotations**:

- **Weekday rotation** — covers **Monday–Friday**.
- **Weekend rotation** — covers **Saturday–Sunday** (only if `include_weekends = true`).

They are separate because their fairness is tracked separately (`fairness.md` section 1–4) and because the Friday weighting and the Monday-after-weekend exclusion only make sense in this split.

**Mechanically**, the engine does NOT pre-shuffle two fixed orderings. Instead, for each date it asks the fairness selector for the best candidate *for that day type*, which reads the appropriate counters. This keeps both rotations balanced dynamically as the ledger evolves across the horizon (and across past generations). The `weekday_rotation_anchor` / `weekend_rotation_anchor` settings are only used as a starting bias / deterministic seed for the *very first* assignment when the ledger is completely flat (all candidates equal) — they ensure a defined, repeatable starting point rather than an arbitrary one.

---

## 5. Generation Algorithm

High-level, deterministic, per run:

```
function generateSchedule(vessel, settings, crew, lanes, ledger, params):
    start = params.from_date ?? (regenerate ? today : settings.schedule_start_date)
    end   = start + settings.horizon_weeks * 7 days - 1 day
    dates = each calendar date from start..end (inclusive)

    create schedules row { start, end, horizon_weeks, is_current=true }
    if a prior schedule is_current: set it is_current=false   # regeneration replaces current

    # Work chronologically so the ledger evolves correctly and constraints
    # (e.g. Monday-after-weekend) can see the days just assigned.
    for date in dates (ascending):
        dayType = isWeekend(date) ? 'weekend' : 'weekday'
        if dayType == 'weekend' and not settings.include_weekends:
            continue
        isFriday = (weekday(date) == Friday)

        for lane in lanes:                      # lanes are independent
            pool = eligiblePool(lane, crew)     # eligible crew in lane (Solo: all; Dept: that dept)
            if pool is empty:
                record gap + fairness_event('no_eligible_crew'); continue

            # Delegate the decision to the fairness engine (fairness.md section 4):
            result = selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssignedOn[date])
            # result = { crew_id, reason_code, detail }

            write watch_assignment {
                schedule_id, vessel_id, lane_id=lane.id, crew_id=result.crew_id,
                watch_date=date, day_type=dayType, is_friday=isFriday
            }
            mark alreadyAssignedOn[date].add(result.crew_id)

            updateLedger(lane, result.crew_id, date, dayType, isFriday)   # fairness.md section 4D
            append fairness_event { schedule_id, lane, crew_id=result.crew_id,
                                    watch_date=date, reason_code=result.reason_code,
                                    detail=result.detail }

    if first generation for vessel:
        set profiles.onboarding_complete = true, onboarding_step = 'complete'

    return summary { schedule_id, start, end, assignments_count, fairness_by_lane }
```

**Why chronological ascending order matters:** the Monday-after-weekend exclusion and the consecutive-run penalty both depend on what was assigned on immediately preceding days. Processing dates in order means each decision sees an up-to-date ledger and an accurate `alreadyAssignedOn` map. Do not parallelise across dates within a lane in a way that breaks this ordering.

**Lane independence:** lanes can be processed in any order relative to each other on a given date (they don't share pools in Dual/Triple, since each crew member is in one department). The `alreadyAssignedOn[date]` guard is a belt-and-braces safety for any edge case where a crew member could appear in more than one pool (shouldn't happen in v1, but the guard keeps the rota sane).

---

## 6. Eligible Pool Construction

```
function eligiblePool(lane, crew):
    base = crew where eligible == true
    if lane.kind == 'solo':
        return base                              # all eligible crew, any department
    else: # dept lane
        return base where department == lane.department
```

Ineligible crew (the "not eligible for watch" toggle from `/settings`) are excluded here — they remain in the crew list but never enter a pool. This is the mechanism by which leave/sickness/training exclusions take effect at the next generation/regeneration.

---

## 7. Regeneration

Regeneration is the same algorithm with two differences:
1. **`from_date` defaults to today** (not the original start), so regenerating mid-cycle rebuilds the schedule *forward* from now, preserving the past (already-stood) portion implicitly via the ledger.
2. The prior `is_current` schedule is flipped to `is_current=false` and a new one inserted.

Crucially, regeneration is **fairness-aware, not random**: it reads the up-to-date persistent ledger, so it continues balancing from wherever the crew currently stands. Triggers for regeneration:
- Crew changes (added/removed/eligibility toggled) in `/settings`.
- Settings changes (horizon, departments, start).
- Manual "Regenerate schedule" on the dashboard.

> Design note: v1 regenerates the whole forward horizon. It does **not** attempt to preserve specific previously-published future assignments (no "lock this day" feature yet). If that's needed later, add an `assignment.locked` flag the engine respects. Leave the hook; don't build it in v1.

**History:** previous schedules are retained (`is_current=false`) for audit and for the chatbot to reference past rotations if asked. They are not shown on the dashboard (which always reads the current schedule).

---

## 8. Horizon & Dates

- `horizon_weeks` is capped at **13 weeks (~3 months)** by the DB check constraint (`backend.md`) and the UI control (`frontend.md`). The engine trusts the stored value but should defensively clamp to [1,13].
- Dates are handled in the vessel's intended local sense; store `watch_date` as a plain `date` (no timezone ambiguity for a day-granular rota). Week/weekend determination uses ISO weekday (Mon=1 … Sun=7); **Friday = ISO 5**, **weekend = ISO 6,7**.
- The week/month dashboard views (`frontend.md`) render from `watch_assignments.watch_date`; the engine just needs to emit correct dates and day-types.

---

## 9. Outputs to the Client

After a successful run the function returns the summary (`backend.md` `generate-schedule` response). The client then reads, via RLS-scoped selects:
- the current `schedules` row,
- its `watch_assignments` (to render the week/month calendar, with Friday/weekend styling per `branding.md`),
- the `fairness_ledger` (to render the per-member fairness chips, grouped by lane/department),
- on demand, `fairness_events` via the `schedule-chat` function (to explain specific decisions).

The engine writes nothing to the client directly beyond the summary; the database is the source of truth and the client subscribes/reads from it.

---

## 10. Edge Cases & Rules of Thumb

- **Empty lane (no eligible crew):** emit no assignment for that lane/date, record `fairness_event('no_eligible_crew')`, and let the UI show an explained gap. Never crash, never assign an ineligible person.
- **Single eligible member in a lane:** they take every watch in that lane; fairness score is trivially 100 (no peers). Valid.
- **Crew smaller than ideal for the Monday-exclusion:** if the exclusion makes Monday infeasible, relax per `fairness.md` section 8 and record it (dents Rotation Continuity).
- **`include_weekends = false`:** skip Sat/Sun entirely; the weekend rotation and weekend counters simply don't grow. The Monday-after-weekend rule then never triggers (no weekend watches to exclude on).
- **Mid-week start date:** fine — the engine starts at `start_date` whatever weekday it is; rotations balance from the ledger regardless of phase.
- **Determinism check (recommended test):** generate twice from identical inputs and assert byte-identical assignments. Include this as an automated test.

---

## 11. Contract Recap (schedule.md <-> fairness.md)
- **schedule.md (this doc):** loops dates ascending across the horizon; loops lanes; builds eligible pools; writes the schedule container, assignments, and triggers ledger/event writes; handles regeneration and history; clamps the horizon; emits correct dates/day-types.
- **fairness.md:** given (lane, date, dayType, isFriday, ledger, alreadyAssigned), returns the chosen crew member + reason; defines the hard constraints, the selection cost, tie-breaking, the ledger update rules, and the 0–100 score.
- **The single call site:** for each (lane, date), `generate-schedule` calls `selectCandidate(...)` (fairness.md) then persists the assignment and applies `updateLedger(...)` (fairness.md). Everything else in generation is this document.

> The engine's job is correct, ordered, persistent structure; the fairness engine's job is the just decision at each step. Keep generation deterministic and chronological, keep every decision recorded, and the dashboard and chatbot will always be able to show and explain a rota the crew can trust.
