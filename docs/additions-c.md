# additions-c.md — WatchSchedule Fairness-Model Correction & Availability Wave (C1–C4)

> **Purpose.** This wave corrects the core fairness model and builds it out properly. It exists because the B8 (groups) audit surfaced a **confirmed pre-existing bug**: the fairness engine measures burden as ABSOLUTE lifetime watch-counts, so a crew member who joins mid-season (zero ledger) is relentlessly assigned watches until their absolute count "catches up" to longer-serving crew — violating the product's core fairness promise in the most common real scenario (crew turnover). The fix requires a deliberate, approved amendment to the previously-frozen fairness scoring. Groups (the original B8) is the LAST phase here, because it must build on the corrected engine, not the buggy one.
>
> **Discipline (unchanged from the main build & additions-v2).** One phase per session; explicit verification gate before proceeding; surface conflicts rather than invent; update the relevant spec doc when implementation diverges. Engine-touching phases are audit/design-gated and STOP for the operator's ruling before code.
>
> **The arc:** C1 adds availability DATA → C2 makes fairness USE it (fixing the bug — the one deliberate scoring change) → C3 adds dated LEAVE (which the corrected fairness makes meaningful) → C4 adds GROUPS (which the corrected fairness makes clean). Each depends on the prior; each is independently shippable.

---

## 0. Hard Constraints (read before any work)

1. **THE FREEZE IS AMENDED EXACTLY ONCE — IN C2 — DELIBERATELY.** The fairness scoring (weights, burden formula, selection cost, score formula, tie-break, ledger-write rules) was frozen through the entire main build and the B-wave. **C2 is the single, intentional, approved amendment to that scoring.** Outside C2, the freeze still holds: C1 adds data and changes NO scoring; C3 and C4 are freeze-safe and must NOT change the scoring (they feed the post-C2 formula different inputs). After C2 establishes a NEW correct worked-example baseline, C3 and C4 prove that NEW baseline reproduces — same canary discipline as B5–B7, around corrected numbers. If any phase OTHER than C2 finds it needs to change the scoring math → STOP, that's wrong.

2. **C2 inverts the usual freeze proof.** Every prior engine phase proved "the worked-example reproduces UNCHANGED." C2 deliberately CHANGES it. So C2's verification is: (a) the new behaviour satisfies the fairness principle (a later joiner is treated fairly, not dumped on), (b) the old behaviour was genuinely the bug, and **(c) GRACEFUL DEGRADATION — when all crew have EQUAL availability (no turnover, no leave), the new formula ranks candidates IDENTICALLY to today's, so existing same-roster vessels are UNAFFECTED.** (c) is the property that makes amending the freeze responsible rather than reckless. It must be PROVEN.

3. **Project identity gate.** Before any Supabase write, re-verify the active project resolves to `gvpyknochnntoqsetomk` (org "Watch Schedule"), NOT any Attract Acquisition project. Confirm `project_ref` before the first migration.

4. **Canonical repo & tree.** Work in the live local tree `~/Desktop/watch-schedule`, remote `watchschedule-app` (under AttractAcquisition). The archived `watch-schedule-new` is frozen — never deploy from it. Migration history is reconciled (commit 49109d6) — `db push` is the correct tool.

5. **Deploy gap.** Edge-function changes committed to GitHub do NOT reach the backend. After any function change, deploy explicitly and confirm the new version.

6. **RLS model inherited, not redesigned.** Server-written tables (`schedules`, `watch_assignments`, `fairness_ledger`, `fairness_events`) stay client-SELECT-only. Captain CONFIGURATION inputs (`crew_members`, `watch_settings`, `charter_periods`, and the new availability/leave tables) are client-RW, vessel-scoped via `current_vessel_id()` — the `crew_members` pattern. (Per the B7 audit's correction: config the captain provides = client-RW; engine outputs = SELECT-only.)

7. **Determinism preserved.** Identical inputs → identical schedules, before and after every phase (including post-C2, with the new formula).

8. **Adoption-safety (the design north star).** A captain who photographs a crew list and never enters dates MUST get correct behaviour automatically. Availability defaults to "when added to the system," so a brand-new vessel (everyone added at once) has EQUAL availability → the corrected fairness degrades to today's behaviour → the fix is invisible for the common case and only engages when crew are genuinely added at different times (which is exactly when it should).

---

## 1. The Conceptual Model (the spine of the whole wave)

Three distinct kinds of "not available," which must NOT be treated the same:

1. **Never been here yet (joiner)** — available only from when they joined; owes nothing for before. → handled by "available from" (C1) feeding opportunity-based fairness (C2).
2. **Permanently gone (leaver / rotation)** — done; a replacement is a NEW joiner (available from when added). → handled by the same "available from" model; no special case.
3. **Temporarily away (leave)** — a few days off must NOT reset months of standing. Those specific watch-days simply don't count in their denominator; standing before and after is preserved. → handled by dated leave (C3) as per-crew skipped opportunities.

**The unifying measure (chosen):** fairness = **watches stood ÷ watch-opportunities the crew member was AVAILABLE for** — not absolute count, not days-since-join. This single denominator handles all three cases uniformly:
- Joiner: denominator counts only post-join opportunities.
- Leaver: gone; replacement's denominator starts at their arrival.
- Leave: leave-days are removed from the denominator (and they're not scheduled then); pre/post standing intact.

**Key connection:** leave = Charter Mode applied per-crew. Charter pauses dates for the WHOLE vessel (no burden accrues, rotation resumes from where it was). Leave pauses dates for ONE crew member (no burden accrues to them for those watches; their standing resumes intact). The "no burden during a pause → resume from where you were" principle that made Charter Mode's resume-from-correct-crew emerge for free (B7) is the SAME principle that makes leave preserve fairness standing. The machinery is conceptually proven.

---

## 2. Scope & Sequencing

| Phase | What | Touches scoring? | Shippable alone? | Depends on |
|---|---|---|---|---|
| **C1** | Availability data model ("available from" per crew, default = when-added) | **No** (adds data only) | Yes (invisible — defaulted) | — |
| **C2** | Fairness correction: burden = watches ÷ opportunities-available-for (THE freeze amendment) | **YES — the one deliberate change** | Yes (fixes the joiner bug) | C1 |
| **C3** | Dated per-crew leave (skipped opportunities) + coexists with the eligibility toggle | **No** (feeds the post-C2 formula) | Yes | C2 |
| **C4** | Watch Groups (combined-department lanes) — the original B8 — on the corrected engine | **No** (pool-membership change) | Yes | C2 (cleaner with availability-aware fairness) |

Build **C1 → C2 → C3 → C4**, one per session, each gate passing before the next. C2 is **design-first** (approve the exact formula before any code). C4 carries forward the confirmed B8 design parameters (see C4).

Rationale for the order: C2 needs C1's data; C3's leave only MEANS something once fairness is opportunity-based (C2 creates the denominator leave subtracts from); C4 (groups) is cleanest on the corrected engine (availability-aware fairness makes "regroup resets to even" natural, with no fictional counts).

---

## PHASE C1 — Availability Data Model (additive, no scoring change)

> **STATUS: DONE.** Added `crew_members.available_from date` (migration `20260627020000`): NEW crew default to `current_date` via the column DEFAULT (so every insert path — OCR onboarding, settings-upload OCR, manual — sets it with the captain entering nothing; no insert-code or Edge-Function change needed). EXISTING crew backfilled to a single **per-vessel** anchor `COALESCE(min(schedules.start_date), vessels.created_at)` — chosen so each existing vessel's crew get **EQUAL** `available_from` (awthomas: all 10 → 2026-06-25, `distinct=1`), which is what makes C2's opportunity-fairness degrade to today for same-roster vessels. UI: "Available from {date}" line + optional editable date in the crew-row editor. **No scoring change** — `fairness_engine`/`fairness_constants`/`schedule_engine` byte-unchanged, worked example reproduces exactly, no Edge Function changed (pre-C1 schedules byte-identical by construction). RLS inherited (`crew_rw_own_vessel`, client-RW vessel-scoped). Nothing consumes `available_from` yet — C2 does.

### Objective
Introduce the concept of crew availability into the data model, defaulted so captains uploading a crew list never have to enter dates. Change NO fairness math — this is groundwork that C2 builds on. C1 ships invisibly: nothing behaves differently; a sensibly-defaulted date field is added.

### Build
1. **Migration (db push):** add `crew_members.available_from date` (or equivalent). Default for NEW crew = the moment they're added to the system (insertion time / first-OCR-appearance). **Backfill existing crew** to a sensible existing date (e.g. their `created_at`, or the vessel's earliest schedule date — choose the one that makes existing same-roster vessels have EQUAL availability so C2 degrades cleanly; justify the choice). Additive, nullable-with-default or NOT NULL DEFAULT — must not disrupt existing rows. Regen `db.ts`.
2. **OCR / crew-add flows:** when crew are added via `parse-crew-list` (onboarding or the B2 settings upload) or manually, set `available_from` to "now" by default — captain enters nothing.
3. **UI:** surface `available_from` per crew (in crew management / the crew editor) as an OPTIONAL, editable date, clearly defaulted ("Added [date]" / "Available from"). A captain can correct it (someone who joined before setup) but is never required to. Keep it unobtrusive.
4. **No engine change.** `fairness_engine.ts`, `fairness_constants.ts`, `schedule_engine.ts` UNTOUCHED. The field exists but nothing consumes it for scoring yet.

### Gate
- [ ] Migration applied: `available_from` exists; new crew default to when-added; existing crew backfilled to a date that gives existing vessels EQUAL availability (justify). No existing row disrupted; `db.ts` regenerated.
- [ ] OCR + manual crew-add set `available_from` automatically (captain enters nothing) — proven end-to-end.
- [ ] UI shows the date as optional/editable, sensibly defaulted; a captain CAN edit it but isn't required to.
- [ ] **No scoring change:** `fairness_engine.ts` + `fairness_constants.ts` BYTE-UNCHANGED; the worked-example still reproduces exactly (nothing consumes the new field yet); existing schedules byte-identical.
- [ ] RLS: `available_from` is captain-editable config (client-RW vessel-scoped, the crew_members pattern — it's already on crew_members).
- [ ] Build passes; tokens; baseline restored (awthomas only).

### Spec to update
`backend.md` (the column + backfill), `frontend.md` (the crew availability field), `additions-c.md` (C1 done).

---

## PHASE C2 — Fairness Correction (THE DELIBERATE FREEZE AMENDMENT) — DESIGN-FIRST

> **STATUS: DONE (2026-06-27) — the freeze is now re-baselined around corrected numbers.** Design approved, then built: burden/selectionCost/computeFairnessScore are now RATES = count ÷ opportunities-available-for (the WHOLE cost ÷ a common per-rotation opp; score = rate re-expressed at the lane's mean opportunity so the EPSILON floor calibrates exactly). `fairness_constants.ts` BYTE-UNCHANGED. Step-A filter (`available_from <= date`) guarantees opp ≥ 1. Opportunities counted consistently across run + replay + seed via one `bumpOpportunities` helper; additive ledger columns persist them (migration 20260627030000, existing rows backfilled EQUAL). **Both halves proven (14/14 engine):** GRACEFUL DEGRADATION — no-turnover fixtures (solo, dual, block+charter) generate schedules + scores BYTE-IDENTICAL to the pre-C2 engine; THE FIX — A(10/30) & B(1/3) both read 100% and B is not preferred, a 0/3 joiner gets ~fair share (≤4 of 8) vs the old engine dumping (≥7). Live (deployed): a mid-horizon joiner stood 1 of 2 available weekends (rate 0.5, = peers), NOT dumped. Determinism holds; divide-by-zero structurally prevented; chatbot reads opp counters for honest "X of Y". New fairness.md §9 is the regression baseline. Historical: grandfather-via-degradation (no recompute, immutable schedules untouched).

### Objective
Correct burden from ABSOLUTE count to **watches ÷ opportunities-available-for**, using C1's `available_from`, so a mid-season joiner is judged on their share of the time they were available — fixing the confirmed dumping bug. This is the single intentional amendment to the frozen scoring.

### DESIGN GATE (do this FIRST — propose, then STOP for operator approval before ANY code)
When deliberately changing the fairness formula, the operator approves the EXACT new math before implementation. Produce for approval:
1. **The formula change (exact):** show CURRENT `burden` / `selectionCost` / `computeFairnessScore`, and the PROPOSED availability-aware versions precisely. Define exactly how the rate is computed (watches per available-day? per available-week?), how existing weights (`W_WEEKDAY`/`W_FRIDAY`/`W_WEEKEND`) apply to a rate, how the denominator is bounded (divide-by-zero / brand-new crew with ~0 available days — the sane behaviour), and how recency/consecutive terms interact with the change.
2. **GRACEFUL-DEGRADATION PROOF:** prove (algebraically or by worked example) that with EQUAL availability across all crew, the rate-based ranking == today's count-based ranking. This guarantees existing same-roster vessels are unaffected. If it does NOT perfectly degrade, surface exactly where and why.
3. **The NEW worked example (the new baseline replacing fairness.md §9):** (a) the no-turnover case (must match today's numbers — proves degradation) AND (b) a mixed-availability case (A: 10 watches / long availability vs B: 0 / short — showing both read ~fair and B is NOT dumped on). These become the new regression baseline.
4. **Historical-data decision (surface for ruling):** vessels with EXISTING count-based ledgers — are they reinterpreted, recomputed, or grandfathered when C2 ships? (Their immutable historical schedules don't change; the question is how the live ledger is treated going forward.) Lay out options + recommendation; this is the operator's call.
5. **Edge/divide-by-zero:** the exact behaviour for a crew member available 0 days (just added) — must NOT reintroduce dumping via a 0-rate.
6. **What changes / what's contained:** mixed-join-date vessels get corrected schedules going forward; seed-fairness interaction (does seeding need `available_from`?); replay-model interaction (replay reconstructs from assignments — does rate-based change replay?); confirm the change is contained to scoring + the availability input.

**STOP and present the design. Do NOT touch `fairness_engine.ts` / `fairness_constants.ts` or write any code until the operator approves the exact formula and the new worked example.**

### Build (only after the design is approved)
1. Implement the approved availability-aware burden/selection/score, consuming `available_from` (and available-opportunity counting). Update `fairness_constants.ts` only if the approved design requires a constant (with operator sign-off).
2. Establish the NEW worked-example as the regression baseline (replace fairness.md §9 with the approved new numbers).
3. Handle the approved historical-data treatment.
4. Keep determinism and explainability — the chatbot must explain picks from REAL, honest numbers (no fictional counts).

### Gate
- [ ] The implemented formula matches the APPROVED design exactly.
- [ ] **Graceful degradation PROVEN in code:** equal-availability crew → identical ranking to the pre-C2 engine (existing same-roster vessels unaffected — diff a no-turnover fixture against pre-C2 output: byte-identical).
- [ ] **The principle is satisfied:** in the mixed-availability worked example, the later joiner (B) reads ~fair and is NOT preferentially assigned watches (the bug is fixed — demonstrate the old engine dumped on B and the new one does not).
- [ ] The NEW worked-example reproduces exactly and is recorded as the new fairness.md §9 baseline.
- [ ] Divide-by-zero / ~0-availability crew handled per the approved design (no re-introduced dumping).
- [ ] Determinism holds (identical inputs → identical output under the new formula).
- [ ] Historical-data treatment applied per the approved ruling.
- [ ] Explainability: the chatbot explains a pick from honest, real numbers.
- [ ] Build passes; RLS intact; seed-fairness/replay interactions handled per design.

### Spec to update
`fairness.md` (the amended formula + the NEW §9 worked example + a clear note this was a DELIBERATE, approved amendment fixing the absolute-count bug, with the date), `backend.md`, `schedule.md`, `additions-c.md` (C2 done — freeze re-baselined around corrected numbers).

---

## PHASE C3 — Dated Per-Crew Leave (freeze-safe; feeds the post-C2 formula)

> **STATUS: DONE (2026-06-28).** Leave = Charter Mode per crew. Added `crew_leave` (migration `20260627040000`; client-RW vessel-scoped, reuses `charter_status` soft-cancel). A single `makeAvailability(crew, leave)` predicate (available_from AND not-on-leave) feeds the SAME C2 Step-A filter + `bumpOpportunities` across run/replay → a crew member's booked leave days drop out of THEIR opportunity denominator and candidacy. **Freeze-safe: `fairness_engine.ts` + `fairness_constants.ts` BYTE-UNCHANGED** (only `schedule_engine` orchestration + generate-schedule input changed). **13/13 engine canary:** no-leave is byte-identical to C2 (freeze-safe); §9 reproduces; **standing preserved** — leave days removed from the denominator (opp 4 not 8 for a 2-weekend leave), pre-leave watches not reset, not counted-as-missed, fairness stays healthy; leave-skip works; determinism holds. **Live (deployed):** RLS client-RW (cross-vessel write 403 / read empty); a crew member on booked leave is not scheduled those days (watch goes to an available crew); soft-cancel is inert. UI: `LeaveManager` in Settings + calendar "🌙 away" indicator (distinct from charter-Paused and gap). Toggle (blanket) + leave (dated) coexist.

### Objective
Add dated leave periods per crew member — those watch-days are removed from the crew member's availability (denominator) and they're not scheduled then, while their standing before/after is preserved (the per-crew Charter-Mode principle). Leave only MEANS something now that fairness is opportunity-based (C2). The existing eligibility toggle is KEPT (quick "unavailable now"); dated leave is added alongside (dated periods).

### Build
1. **Migration (db push):** a `crew_leave`-style table (crew_member_id / vessel_id, start_date, end_date CHECK end >= start, optional label, status booked/cancelled soft-cancel) — client-RW vessel-scoped RLS (crew_members pattern). Index. Regen `db.ts`.
2. **Availability/opportunity counting (no scoring change):** the post-C2 denominator (opportunities-available-for) EXCLUDES a crew member's booked leave days. This is input to the unchanged-after-C2 formula — NOT a scoring change. A crew member on leave for a watch-day is simply not an available candidate for those dates (analogous to the Charter skip, but per-crew).
3. **Generation (orchestration only):** during a crew member's booked leave, they are not selected for those dates (excluded from that date's eligible pool); the watch goes to an available crew member; no burden accrues to the absent crew member; their standing resumes intact afterward. Determinism preserved. `fairness_engine.ts` + `fairness_constants.ts` UNTOUCHED.
4. **Toggle coexistence:** keep the eligibility toggle as a quick "unavailable for the next generation" control; dated leave is the dated-period mechanism. Define clearly how they compose (toggle = blanket exclude from next gen; leave = exclude specific dates) — both just remove the crew member from the relevant eligible pools.
5. **UI:** a leave management surface per crew (add/cancel dated leave); the calendar can indicate a crew member's leave; Settings is the home (alongside crew management).

### Gate
- [ ] `crew_leave` table + client-RW vessel-scoped RLS (cross-vessel denied); soft-cancel inert (cancelled leave doesn't affect generation).
- [ ] A crew member on booked leave is NOT scheduled for those dates; the watch goes to an available crew member; no crash.
- [ ] **Standing preserved (the key proof):** a crew member who takes a few days' leave returns with their fairness standing intact — leave-days are removed from their denominator, NOT counted against them, NOT reset. Prove: pre-leave vs post-leave fairness ratio is consistent (leave is transparent to standing, like the Charter resume).
- [ ] Opportunity counting excludes leave days correctly (the C2 denominator respects leave) — and this is INPUT to the formula, NOT a scoring change (`fairness_engine.ts` + `fairness_constants.ts` BYTE-UNCHANGED; the NEW post-C2 worked-example still reproduces).
- [ ] Toggle + dated leave coexist with clear, correct composition.
- [ ] Determinism holds; calendar shows leave; build passes; RLS intact.

### Spec to update
`backend.md` (crew_leave table/RLS), `schedule.md` (leave as per-crew skipped opportunities; standing preserved), `frontend.md` (leave UI + toggle coexistence), `fairness.md` (NOTE: leave removes opportunities from the denominator; scoring unchanged from C2), `additions-c.md` (C3 done).

---

## PHASE C4 — Watch Groups (the original B8) on the corrected engine (freeze-safe)

> **STATUS: DONE (2026-06-28) — C-WAVE COMPLETE.** A lane may now span a GROUP of 1+ departments, pooling their crew into one rotation. Additive/generalising: groups-of-one == today. Shipped: `lane_departments` junction (migration `20260628010000`, `unique(vessel_id, department)` disjointness; backfilled existing active lanes → one row each; dropped the superseded `watch_lanes` one-dept-per-lane unique; client-RW RLS); `eligiblePool` pools from the lane's department SET (`schedule_engine` orchestration only — `fairness_engine`/`fairness_constants` **byte-unchanged**); generate-schedule/seed-fairness load the junction; `WatchSettingsForm` group builder (per-department Lane selector) with disjointness + reconcile-by-set (carry unchanged / new lane = even-at-formation / retire+free). **Freeze-safe:** pure pool-membership; post-C2 §9 reproduces. **11/11 engine canary:** existing-vessel groups-of-one **byte-identical** to pre-C4; combined-group lane pools both departments; **honest regroup-reset** (new combined lane even from formation, no fictional counts; unchanged group carries forward); C3 leave on a grouped crew; determinism. **Live (deployed):** a (Deck & Engineering) lane pooled all 4 deck+eng crew into one rotation; DB disjointness rejects a department in two lanes (409); RLS client-RW (cross-vessel read empty). `partitionGroups` 5/5. Baseline = awthomas only.
>
> **— The C-wave (C1 availability data → C2 fairness correction → C3 dated leave → C4 groups) is complete. The fairness model is corrected (availability-aware) and built out; the one deliberate freeze amendment (C2) holds, and C1/C3/C4 are freeze-safe around it.**

### Objective
A "group" is a bundle of one or more departments acting as a SINGLE combined lane — its members pooled into one rotation. The captain picks GROUPS instead of bare departments. Built LAST so it lands on the corrected, availability-aware engine, where it composes cleanly.

### Confirmed design parameters (from the B8 audit + operator rulings — carry forward)
- **Generalizes** the current model: today's single-department selection = the special case where every group is a singleton. Existing vessels (single-department lanes) remain valid, untouched — additive.
- **Disjointness:** a department appears in AT MOST ONE group (a crew member can't be on both sides of the watch). Enforced via a `lane_departments` junction with `unique(vessel_id, department)` (recommended over a `department[]` column — the junction enforces cross-row disjointness cleanly), plus Zod, plus UI dynamically disabling any group sharing a department with an already-picked one.
- **Partial coverage allowed:** a department in no group simply isn't on watch (validation = groups disjoint, NOT partition-all).
- **Regroup resets to even:** when a group's membership changes (incl. a newly-formed combined group), that lane's fairness state starts even at formation; an unchanged group carries forward. **On the corrected engine this is NATURAL** — availability-aware fairness already judges crew on their rate since they became available to that lane, so a new combined lane starts even WITHOUT fictional counts (the data-honesty wrinkle that count-based Route-A would have caused is gone, because C2 made fairness opportunity-relative).

### Audit confirmations to honour (from the B8 audit, still valid)
- Ledger is per-(vessel_id, lane_id, crew_id) — per-lane-per-crew → regroup-reset = zero/re-init that lane's rows; unchanged group keeps them.
- Groups = a pure pool-MEMBERSHIP change feeding the (post-C2) scoring — `selectCandidate`/`updateLedger`/`computeFairnessScore` are indifferent to whether a lane's pool is one department or several. **No scoring change.** (Confirm again against the post-C2 engine.)
- seed-fairness must map each department in a group → that group's lane (contained change; per-lane-per-crew aggregation; no scoring change).
- reconcileLanes matches on the group's department-SET (set match → carry lane+ledger; set changed → reset rule).
- Interactions: B5 tier-flex (Dual 1–2 groups, Triple 1–3, floor 1); B6 weekend structure (a group's weekend/block = the group's pooled rotation); B7 charter (orthogonal); C2 availability (a group's pool is availability-aware per C2); C3 leave (a grouped crew member's leave removes them from the group's pool for those dates).

### Build
1. **Migration (db push):** `lane_departments(lane_id fk, department, vessel_id)` junction with `unique(vessel_id, department)`; backfill existing lanes → one junction row each (additive, no behaviour change). Regen `db.ts`.
2. **schedule_engine.ts (orchestration only):** `eligiblePool` assembles a lane's pool from its department SET (availability-aware per C2; leave-aware per C3); `deriveLanes`/`reconcileLanes` key on the group's department-set; regroup-reset re-inits a changed/new lane's ledger even at formation. `fairness_engine.ts` + `fairness_constants.ts` BYTE-UNCHANGED (post-C2).
3. **generate-schedule + seed-fairness:** read group→departments; seed maps each dept in a group to the group's lane.
4. **Client:** WatchSettingsForm group picker (pick groups, not bare departments; disjointness via dynamic disable); existing single-dept selections render as groups-of-one.

### Gate
- [ ] Migration: `lane_departments` junction + `unique(vessel_id, department)` disjointness; existing lanes backfilled to groups-of-one; `db.ts` regenerated.
- [ ] **Existing-vessel byte-identical:** a single-department (groups-of-one) vessel generates byte-identically to pre-C4 (additive proven).
- [ ] A combined-group lane rotates its POOLED crew fairly (availability-aware per C2): e.g. (Deck & Engineering) pools both departments into one rotation.
- [ ] **Disjointness enforced:** the DB rejects a department in two groups; Zod rejects it; the UI disables groups sharing a department with an already-picked one.
- [ ] **Regroup resets to even (clean on the corrected engine):** forming a new combined group starts its lane even at formation WITHOUT fictional counts; an unchanged group carries its ledger forward — prove both.
- [ ] **FROZEN-ENGINE REGRESSION (post-C2 baseline):** the NEW (post-C2) worked-example reproduces exactly; `fairness_engine.ts` + `fairness_constants.ts` byte-unchanged.
- [ ] Interactions proven: B5 count (1..N groups by tier, floor 1), B6 weekend structure on a group, B7 charter orthogonal, C3 leave on a grouped crew member, seed-per-group.
- [ ] Partial coverage allowed (a department in no group isn't scheduled); determinism; build passes; RLS intact.

### Spec to update
`schedule.md` (group lanes + pool assembly + regroup-reset), `backend.md` (junction + disjointness + RLS), `frontend.md` (group picker), `fairness.md` (NOTE: pooling is a membership change; scoring unchanged from C2), `additions-c.md` (C4 done — wave complete).

---

## 3. Done Definition

This wave is complete when:
- C1–C4 gates all pass.
- The fairness model is corrected: crew are judged on their share of the time they were AVAILABLE (joiner, leaver, and leave all handled uniformly), the absolute-count dumping bug is fixed, and the chatbot explains picks from HONEST numbers.
- **The scoring was changed EXACTLY ONCE (C2), deliberately and approved**, with graceful degradation PROVEN (equal-availability vessels unaffected) and a new recorded worked-example baseline. C1/C3/C4 changed NO scoring (verifiable: post-C2 `fairness_engine.ts` + `fairness_constants.ts` byte-unchanged across C3 and C4).
- Dated leave preserves standing (leave is transparent, like the Charter resume).
- Groups land on the corrected engine, composing cleanly (regroup-reset is natural, no fictional counts), with disjointness enforced and existing vessels untouched.
- All new function code deployed and version-confirmed on `gvpyknochnntoqsetomk`; migration history stays in sync; baseline is the operator's account only.
- The relevant spec docs reflect what shipped (especially fairness.md's amended formula + new baseline + the deliberate-amendment note).

---

*Governing principle: this wave fixes what the groups question revealed — the fairness engine was measuring the wrong thing (absolute counts) and quietly being unfair to anyone who joined mid-season. The fix is measured in ONE deliberate, approved scoring amendment (C2), proven to degrade gracefully so existing vessels are untouched, and then built out (leave, groups) on the corrected foundation. The freeze protected the engine from CASUAL change; C2 is the DELIBERATE, careful change it was always meant to permit when correctness required it.*
