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

- **`watch_settings`** for the vessel: `tier`, `selected_departments`, `horizon_weeks` (1–13, capped at ~3 months), `schedule_start_date`, `include_weekends`, rotation anchors, and **`weekend_structure`** (B6: `per_day` | `sat_sun_block` | `fri_sat_sun_block`).
- **`crew_members`**: the full crew, with `department` and `eligible`.
- **`watch_lanes`**: the concrete lanes (derived from settings — see section 3).
- **`fairness_ledger`**: the current persistent state per (lane, crew) — possibly seeded by `seed-fairness`, possibly zero.
- **Run parameters** from the request: `from_date` (optional), `regenerate` (bool).

---

## 3. Deriving Lanes from Settings

Lanes are the unit of generation and of fairness. Derive (and persist to `watch_lanes`) from tier + `selected_departments`:

Lane count is **1..N by tier, floor of 1** (B5 — relaxed from exactly-N): one lane **per selected department**, and a tier may run fewer than its max.

- **Solo** -> exactly **one** lane: `kind='solo'`, `department=null`, `label='Watch'`. Pool = all eligible crew regardless of department.
- **Dual** -> **one or two** lanes: `kind='dept'`, one per selected department (1 ≤ count ≤ 2). Pool of each = eligible crew in that department.
- **Triple** -> **one to three** lanes: `kind='dept'`, one per selected department (1 ≤ count ≤ 3).

The engine is **count-agnostic**: it loops the **active** lanes and scores each independently, so running fewer lanes than the tier max simply means fewer independent ledgers — the per-lane selection/scoring math is unchanged (the frozen fairness engine). Floor of 1 (Dual/Triple may not select 0) is enforced by the DB CHECK + the client Zod, not the engine.

> **C4 — Watch Groups (a lane spans 1+ departments).** A "group" generalises a dept lane: instead of one lane = one department, a lane covers a **department SET** (from `lane_departments`) and **pools** their crew into one rotation. `eligiblePool(lane)` = eligible crew whose department ∈ the lane's set (availability-aware per C2, leave-aware per C3 — `makeAvailability` still applies per crew within the pooled group). **Groups-of-one** (one department per lane) reduce to the original single-dept filter exactly → existing vessels byte-identical (additive). The tier still caps total selected departments (B5, unchanged); a group is a *partition* of those departments into lanes (number of lanes ≤ departments ≤ N). Pure pool-MEMBERSHIP — the post-C2 scoring is indifferent to whether a pool is one department or several. **Regroup-reset (honest on the corrected engine):** the form reconciles desired groups (department-sets) against active lanes — an unchanged set carries its lane + ledger forward; a changed/new set is a NEW lane whose ledger starts empty → **even at formation**, with crew judged on their rate since the lane formed (C2) — no fictional counts. Disjointness (a department in at most one lane) is enforced by `lane_departments` `unique(vessel_id, department)` + Zod + the UI.

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

### 4.1 Weekend structure (B6 — `weekend_structure`)

Weekend coverage shape is configurable per vessel — a **scheduling-structure** choice that does **not** change the fairness scoring:

- **`per_day`** (default) — one person per day; Sat and Sun are independent picks (the original behaviour).
- **`sat_sun_block`** — one person covers the whole **Sat+Sun**.
- **`fri_sat_sun_block`** — one person covers **Fri+Sat+Sun**.

A block is decided by **one selection at its first chronological day** (the *lead*) via the unchanged fairness selector, then the chosen crew is assigned across every day of the block:
- `sat_sun_block` → **Saturday** leads `{Sat, Sun}` (selected on weekend cost — weekend balance).
- `fri_sat_sun_block` → **Friday** leads `{Fri, Sat, Sun}` (selected on the weekday+Friday cost — **Friday-spread**: lowest-Friday crew gets the block).

**Counting is PER COVERED DAY:** `updateLedger` is called once per day in the block with that day's own day-type/Friday flag, so `weekend_watches`/`friday_watches` keep meaning "days stood" — identical to `per_day`, to the live ledger, and to `seed-fairness`. This is the decisive reason for per-day counting (no unit seam across modes/seeding). Consequently the **scoring weights/formula are unchanged** (the frozen `fairness_engine` + `fairness_constants`); block modes are an orchestration change in `schedule_engine` only. The block-taker's Friday still counts and is weighted `W_FRIDAY`, and standing the weekend block sets `last_weekend_date` to the block's Sunday → the **Monday-after-weekend exclusion still fires**. Block modes are only meaningful when `include_weekends = true`; with weekends off, the in-range days collapse (a block degrades to its scheduled days only — never crashes). Storage stays **one `watch_assignments` row per (lane, date)**, so regeneration replay and seeding remain per-day automatically.

### 4.2 Charter Mode (B7 — `charter_periods`)

A **charter period** is a date range during which the watch rotation is **paused**. Generation reads the vessel's **booked** charters (`charter_periods` where `status='booked'`; `cancelled` is retained for history but ignored) and **skips every date inside any charter window** — generalising the existing weekend skip from one weekday-class to an arbitrary range. A skipped date gets **no selection, no assignment, no `updateLedger`, no event, and no gap** (a "Paused" charter is distinct from a `no_eligible_crew` gap; the scoring is not even called).

**Resume-from-correct-crew is emergent, not coded:** because a paused date accrues **zero burden**, the per-lane ledger entering the first post-charter day is byte-identical to the ledger leaving the last pre-charter day, so the unchanged fairness selector resumes from the correct next-due crew automatically. (Proven: a fresh run starting at the resume date *from the pre-charter ledger* reproduces the post-charter assignments and final ledger exactly.) `fairness_engine` + `fairness_constants` are **byte-unchanged**; this is a `schedule_engine` orchestration change only — the charter skip folds into `isScheduled`, so **B6 weekend-blocks also honour charters** (a charter cutting a block leaves the non-charter side as B6's partial-block path).

- **Horizon** stays a calendar window (`fromDate + horizon_weeks*7`); a charter inside it consumes calendar days that simply receive no watches — the horizon is **not** auto-extended (raise `horizon_weeks` for more post-charter coverage).
- **`is_current`** unchanged: regeneration still yields exactly one current schedule; charters only change which dates within it get watches.
- **Regeneration** reads booked charters and skips them; regenerating from a date inside a charter starts with skipped days until `end_date`. Overlapping/adjacent charters are handled by union (`inCharter(date)` = date ∈ any booked charter).

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

> **C2 — availability filter & opportunity counting.** On each scheduled date, a pool member is a candidate only if `available_from <= date` (Step-A; a not-yet-joined crew is never scheduled before arrival, and this guarantees their opportunity denominator ≥ 1). Independently, the engine counts one **opportunity** of that date's rotation for **every available crew in the pool** (not just the one assigned) — via a single `bumpOpportunities` helper used identically by the current run, by `replayLedgers` (each prior assignment date), and by `seed-fairness` (each seeded date). This consistent counting across seed + replay + run is what keeps the denominator equal for equal-availability crew (so fairness degrades to the pre-C2 behaviour) and correct for a mid-season joiner (`fairness.md` §4/§5/§9). Block/charter dates that aren't scheduled (B6/B7) contribute no opportunity, exactly as they contribute no watch.

> **C3 — dated per-crew leave (Charter Mode per crew).** "Available" now combines `available_from` (C2) with booked `crew_leave`: a single `makeAvailability(crew, leave)` predicate `isAvailable(id, date)` = joined AND not on leave that date. It feeds the SAME Step-A filter and `bumpOpportunities` — so on a crew member's booked leave days they are not a candidate (the watch goes to an available crew member) **and** those days are **not** opportunities for them. The leave days simply drop out of THEIR denominator: standing is preserved (neither for nor against them) — exactly the Charter "no burden during a pause → resume from where you were" principle (B7), scoped per-crew instead of per-vessel. Freeze-safe: it changes the INPUT (candidacy + opportunities), not the scoring. A block split by a leave excludes that crew from the block (B6 partial-block path). The eligibility toggle (`crew_members.eligible`) remains the blanket all-dates exclusion; leave is the dated-period one — they compose (a candidate must be eligible AND `isAvailable`).

---

## 7. Regeneration

Regeneration is the same algorithm with two differences:
1. **`from_date` defaults to today** (not the original start), so regenerating mid-cycle rebuilds the schedule *forward* from now, preserving the past (already-stood) portion implicitly via the ledger.
2. The prior `is_current` schedule is flipped to `is_current=false` and a new one inserted.

Crucially, regeneration is **fairness-aware, not random**: it continues balancing from wherever the crew currently stands. Triggers for regeneration:
- Crew changes (added/removed/eligibility toggled) in `/settings`.
- Settings changes (horizon, departments, start).
- Manual "Regenerate schedule" on the dashboard.

### 7.1 The ledger model (what the engine actually computes)

Every generation rebuilds the live `fairness_ledger` deterministically as:

```
fairness_ledger = SEED  +  replay(already-stood assignments with watch_date < from_date)  +  freshly-generated forward portion (from_date .. end)
```

- **SEED** is the immutable starting base from `seed-fairness` (Phase 8), stored in the
  `fairness_ledger.seed_*` columns (`seed_total_watches`, `seed_weekday_watches`,
  `seed_weekend_watches`, `seed_friday_watches`, `seed_last_watch_date`,
  `seed_last_weekend_date`, `seed_consecutive_run`). It is set once during onboarding and
  is **never** overwritten by generation. For Solo (or unseeded Dual/Triple) the seed is zero.
- **replay(...)** re-applies `updateLedger` over the prior current schedule's assignments
  that fall **before** `from_date` — the already-stood past — on top of the seed.
- The **forward portion** is the new chronological generation from `from_date`.

This is **idempotent under repeated regeneration and never double-counts**: because the
forward portion is always generated afresh from a base of `SEED + already-stood-past` (the
seed is read from the immutable `seed_*` columns, not from the live counters that the
previous generation wrote), regenerating any number of times from the same state yields the
same ledger. First generation has no prior schedule, so the base is just the SEED, and the
first rota is therefore fairness-aware from day one (heavier-seeded crew are favoured less).

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
