# additions.md — WatchSchedule Post-Launch Feature Additions

> **Purpose.** This document is the build context for three features added on top of the shipped V1 application, to be executed **after Phase 11 is fully closed and verified**. It follows the same discipline as the original spec suite (`master.md`, `backend.md`, `frontend.md`, `fairness.md`, `schedule.md`, `branding.md`): one phase per session, explicit verification gate before proceeding, surface conflicts rather than invent solutions, and update the relevant spec doc when implementation diverges.
>
> **This document does not supersede the original specs. It extends them.** Where it touches an existing surface, the original doc remains the source of truth for everything not explicitly changed here.

---

## 0. Hard Constraints (read before any work)

These are non-negotiable. Any phase that would violate one of these must STOP and surface the conflict.

1. **DO NOT TOUCH THE FAIRNESS SCORING.** The Crew Fairness Score, Schedule Fairness Score, Historical Fairness Score, Fairness Debt, Most Due To Serve, the Duty Weighting table, and the Crew Fairness Loop are **frozen**. None of these features changes a single fairness number, weight, formula, tie-break, or ledger-write rule, and none alters the live scoring path. If any task appears to require a scoring change, that is a signal the task is wrong — STOP.

2. **Project identity gate.** Before any Supabase write, re-verify the active connection resolves to project `gvpyknochnntoqsetomk` (org "Watch Schedule", `vpfjpwtoddgwaurjbmuy`) and **NOT** any Attract Acquisition project. If it does not, STOP. Confirm the active `project_ref` in output before the first migration.

3. **Canonical repo.** All work happens in the repo serving the live product at `app.watchschedule.com` (`~/Desktop/watch-schedule`). The dead `watch-schedule-app` / github.io repo is **frozen** — never deploy from or edit it. If a path discrepancy appears, STOP and resolve which tree is live before editing.

4. **Deploy gap.** Edge-function changes pushed to GitHub do **NOT** reach the backend. After any function change, deploy explicitly via the Supabase MCP and confirm the new version. Keep `verify_jwt` settings as they are on existing functions (frontend-invoked = TRUE).

5. **RLS model is inherited, not redesigned.** Server-written tables (`schedules`, `watch_assignments`, `fairness_ledger`, `fairness_events`) remain **client-SELECT-only**; only the service role writes them. Vessel-scoped tables remain scoped to `current_vessel_id()`. The gate-column guard on `profiles` (blocking client writes to `payment_status`, `product_tier`, `stripe_*`) stays intact. Any new table or policy follows this same pattern.

6. **Determinism is preserved.** No randomness introduced anywhere; identical inputs produce identical output.

---

## 1. Scope — What We Are Building

Three features, in priority order. Each is a self-contained phase with its own gate.

| Phase | Feature | One-line | New schema? | Touches engine? |
|---|---|---|---|---|
| **A1** | WhatsApp Export | One-tap plain-text schedule for crew WhatsApp groups | No | No |
| **A2** | Schedule Version History | Verify-then-surface published-schedule history + approval trail | **Audit first** | No |
| **A3** | Personal Crew View | Read-only per-crew view of own duties, history, fairness standing | Possibly minimal | Read-only |

**Out of scope (explicitly not built here):** Fleet Benchmarking, predictive forecasting, leave/coverage forecasting, Fairness Alerts, analytics/reporting dashboards, Rotation Stability Score, manual-override diff tracking, department-specific rule overrides, generalised What-If (crew swaps / relief additions / manual edits). These are deferred indefinitely and are not a task list. If a phase starts expanding toward any of these, STOP.

---

## 2. Sequencing & Gate Discipline

Build in order A1 → A2 → A3. Each phase is one session. Do not start a phase until the prior phase's gate passes. **A2 begins with an audit, not a build** — its first action is read-only investigation of what already persists.

Rationale for the order: A1 is near-zero-risk pure presentation and ships immediate adoption value. A2 may be largely already done at the data layer and only needs surfacing. A3 establishes the per-crew read surface that is independently valuable and is also the foundation for future per-seat expansion.

---

## PHASE A1 — WhatsApp Export

### Objective
Add a one-tap action on the schedule view that renders the current published schedule into the plain-text, day-by-day format crew paste directly into the vessel WhatsApp group, and copies it to the clipboard.

### Why
Highest real-world-adoption lever in the product. The schedule's value is realised only when crew see it, and crew live in WhatsApp, not the app. This bridges generated output to where the audience already is. Lowest effort of the three — pure presentation over data already held.

### Scope fence
- **IN:** A formatting function over existing `watch_assignments` + `crew_members` data; a button on the schedule surface; copy-to-clipboard; a short confirmation toast.
- **OUT:** Any WhatsApp Business API / Cloud API integration. Any direct-send. Any message scheduling. V1 is copy-to-clipboard text only. Do not add an external dependency or a new secret.

### Build
1. **Pure formatter (client-side).** A function that takes the current schedule's assignments and produces a plain-text block. No backend change required — the dashboard already holds this data via RLS-scoped reads.
2. **Format (confirm exact shape with Alex before finalising, but default to):**
   - A header line: vessel name + date range (e.g. `M/Y Legacy 4 — Watch Schedule | 6–12 Oct`).
   - One line per scheduled day per lane, in date order. For solo vessels: `Mon 6 — Tom`. For dual/triple (multiple lanes per day): group by day with lane labels, e.g. `Mon 6 — Deck: Tom | Interior: Luke`.
   - Plain text only — no markdown, no emoji unless Alex requests (WhatsApp renders neither reliably from a paste, and crew groups vary).
3. **UI.** A clearly labelled action (e.g. "Copy for WhatsApp") on the schedule/dashboard surface, near the existing schedule actions. Follow `branding.md` tokens — do not introduce new styling primitives.
4. **Clipboard.** Use the standard clipboard write with a success toast. Handle the clipboard-unavailable case gracefully (fallback: render the block in a selectable text area).

### Verification gate (all must pass)
- [ ] Export reflects the **currently published / current** schedule exactly — every assignment present, correct crew, correct dates, correct lane grouping for the vessel's tier.
- [ ] Solo, dual, and triple vessels each render a sensible, unambiguous format.
- [ ] Copy-to-clipboard works; fallback path works when clipboard API is blocked.
- [ ] No backend change, no new edge function, no new dependency, no new secret.
- [ ] No fairness data altered or recomputed (read-only over existing assignments).
- [ ] Styling uses existing tokens only.

### Spec to update on completion
`frontend.md` — add the export action to the schedule surface description.

---

## PHASE A2 — Schedule History (read-only)

> **Audit (A2.0) established no approval/publication/locking lifecycle exists in the product — schedules are generated, not approved; the original "who approved/locked it" / `schedule_health_scores` / publish-lock language assumed a non-existent feature and was scoped out.** What the live schema actually retains: every past generated schedule survives regeneration (`is_current` flips to `false`, rows are never deleted), with its `generated_at` timestamp and its `watch_assignments` (and `fairness_events`) intact. A2 therefore surfaces that history — no schema change, no approval system.

### Objective
A read-only history of past **generated** schedules: list prior schedules for the vessel by `generated_at` (most recent first) with a derived version index (v1, v2, …; the current one distinguished), each openable read-only to view that version's assignments. Pure surface over already-persisted, already-client-readable data.

### Why
Audit trail and dispute resolution. When a crew member disputes weekend burden, the captain needs the receipts — and the receipts ARE the generated schedules, all of which are already persisted and reconstructable.

### Phase A2.0 — AUDIT FIRST (read-only; no edits, no migrations)  — DONE
The audit confirmed the ground truth above. Gap table (live schema):
- **Schedule snapshot** (`schedules` row + `watch_assignments`): PERSISTED BUT NOT SURFACED.
- **Generation date** (`generated_at`): PERSISTED BUT NOT SURFACED.
- **Approver/locking user:** NOT PERSISTED (no approval lifecycle exists).
- **Version sequence:** NOT PERSISTED (no column); derivable at read time by ordering on `generated_at`.

### Build (pure surface — no schema change)
- A read-only history view listing past generated schedules with their generation date and a derived version index, the current one marked. Reads via the existing SELECT-only vessel-scoped RLS — **no new policy, no migration**.
- Each entry is openable read-only to view that version's `watch_assignments`. No editing of historical schedules. **No "restore/revert"** in this phase (defer — out of scope).

### Verification gate (all must pass)
- [ ] Audit gap table produced and reviewed before any build (done in A2.0).
- [ ] Every past generated schedule is retrievable with its generation date and a version index; the current one is distinguished.
- [ ] Opening a historical schedule renders that version's assignments correctly (a regenerated-away schedule still shows its original assignments).
- [ ] History view is strictly read-only; no path to mutate, regenerate-from, or revert a historical schedule.
- [ ] No migration / no schema change / no new RLS policy (the data and policy already exist).
- [ ] Generation and fairness scoring paths are untouched.
- [ ] No "revert/restore" introduced.

### Spec to update on completion
`frontend.md` (history surface). No `backend.md` change — no schema/function change in this phase.

---

## PHASE A3 — Personal Crew View

### Objective
A read-only view scoped to a single crew member showing their upcoming duties, duty history, and their own fairness standing — distinct from the captain dashboard.

### Why
The app is currently captain-facing; the crew who actually serve the watch have no reason to open it. A personal view turns every crew member into a user, defuses "why did *I* get this duty" at source, and makes fairness visible to the people it protects. It is also the natural foundation for future per-seat / multi-user expansion — build the view now, monetise seats later.

### Scope fence
- **IN:** A read-only, crew-scoped surface: "My upcoming duties," "My duty history," "My fairness standing" (the crew member's own Crew Fairness Score / standing as already computed). Reuses existing fairness numbers — displays, never recomputes.
- **OUT:** Any new fairness computation. Any crew-initiated edits, swaps, or leave requests from this view (display only in this phase). Any new auth/identity system — if per-crew login isn't already modelled, surface that as a decision rather than inventing an auth scheme. Full multi-seat billing (deferred).

### Critical decision to surface (do not silently choose)
Determine how a crew member is identified to the app. The current model is captain/vessel-account-centric (`profiles` ↔ `vessels`, `crew_members` as records, not necessarily auth users). Before building, establish and surface:
- **Option A:** Crew View is rendered *within the captain's account* (captain views any crew member's personal view) — no new auth, ships now, no per-crew login.
- **Option B:** Crew members get their own scoped login — larger change, touches auth/RLS, likely a separate future effort.

**Default recommendation: Option A for this phase** (captain-side per-crew view, zero auth change), with Option B explicitly deferred. Confirm with Alex before building if ambiguous.

### Build
1. Implement per the chosen option (default A). Data and fairness numbers already exist; this is a scoped read surface plus a stripped-down UI — **no new engine logic.**
2. RLS: any read stays within `current_vessel_id()`. Under Option A no new policy is needed (captain already reads own-vessel crew + fairness). Under Option B, scoped policies would be required — but Option B is deferred.
3. UI: stripped-down, crew-appropriate. Follow `branding.md`. Show the crew member's own duties (upcoming + history) and own fairness standing only — not the whole-schedule captain view.

### Verification gate (all must pass)
- [ ] Identity decision (A vs B) surfaced and agreed before build; chosen approach documented in-doc.
- [ ] View shows only the selected crew member's own duties + history + fairness standing.
- [ ] All fairness figures are read from existing computed values — nothing recomputed, no engine call that writes.
- [ ] Reads remain vessel-scoped; no cross-vessel leakage (proven).
- [ ] No crew-initiated mutations in this phase.
- [ ] Scoring path untouched.

### Spec to update on completion
`frontend.md` (new surface) and, only if Option B is ever taken, `backend.md` (auth/RLS) — not in this phase.

---

## 3. Done Definition

All three phases complete when:
- A1–A3 gates all pass.
- No fairness scoring, weighting, ledger rule, or generation logic was modified (verifiable: `fairness.md` and `schedule.md` unchanged; engine unit tests still reproduce the same worked-example numbers).
- All new edge-function code is deployed and version-confirmed on `gvpyknochnntoqsetomk`.
- The relevant spec docs (`frontend.md`, and `backend.md` where schema/functions changed) are updated to match what shipped.
- Nothing from the out-of-scope list crept in.

---

*Governing principle: these three features sit on top of a finished engine. All three are read/display surfaces over data that already exists. None of them is allowed to change how fairness is calculated. If a phase ever seems to require touching the scoring, the phase is wrong — stop and surface it.*
