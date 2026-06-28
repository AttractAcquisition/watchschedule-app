<!-- WatchSchedule spec set — v2 (cross-referenced & seam-verified). Document 4 of 6: fairness. Owns the definition of fairness + candidate selection. Seam with schedule.md: selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned). -->
# fairness.md — WatchSchedule Fairness Engine

> **Purpose.** This document specifies the fairness algorithm — the core differentiator of WatchSchedule. It defines what "fair" means numerically, how the persistent fairness ledger is maintained, how candidates are selected for each watch, and how every decision is recorded so the chatbot can explain it. This is the spec for the fairness logic inside the `generate-schedule` and `seed-fairness` Edge Functions (`backend.md`). The day-by-day generation loop that *calls* this logic is in `schedule.md`; where the two overlap, **fairness.md owns the definition of fairness and candidate selection**, and `schedule.md` owns the iteration/structure.

**Determinism requirement.** Given the same crew, settings, and ledger state, the engine MUST produce the same schedule every time. No randomness. All ties are broken by explicit, ordered rules (section 7). This is what makes the rota defensible to crew and explainable by the chatbot.

> **⚠️ C2 AMENDMENT (2026-06-27 — the one deliberate, approved change to the frozen scoring).** Burden is now a **RATE: watches ÷ opportunities the crew member was AVAILABLE for** (using `crew_members.available_from`, C1), not an absolute lifetime count. This fixes a confirmed bug: the absolute-count model relentlessly dumped watches on a mid-season joiner until their *count* caught longer-serving crew. **Weights/constants are UNCHANGED** (`fairness_constants.ts` byte-identical); the rate divides the existing count-based cost/burden. **Graceful degradation is proven:** with EQUAL availability every crew shares the same opportunity denominator, the divisor cancels, and the schedule + 0–100 scores are **byte-identical** to the pre-C2 engine — so existing same-roster vessels are unaffected. The amendment touches `burden`/`selectionCost`/`computeFairnessScore` + a Step-A availability filter + opportunity counting across seed/replay/run. See the new §9 worked examples (the post-amendment baseline).

---

## 1. Core Principles (the rules, in plain language)

These are the operator-stated rules the math must honour:

1. **Two independent rotations per lane.** Monday–Friday is one rotation; Saturday–Sunday is a separate rotation. Each is balanced on its own. A crew member's weekday load and weekend load are tracked and fairly distributed **separately**.
2. **Friday carries higher weight.** Friday is the most-undesirable weekday watch — we must not let the same person repeatedly draw Friday. Friday is tracked as its own sub-count and weighted more heavily than other weekdays in the fairness score and in selection.
3. **No Monday watch immediately after a weekend watch.** A crew member who stood watch on the immediately preceding Saturday or Sunday is **excluded** from the following Monday's watch. This couples the two rotations as a hard constraint (the weekend rotation constrains the next weekday rotation's Monday).
4. **Balance is cumulative and persistent.** Fairness is measured over the vessel's whole history (seeded from uploaded past schedules), not just the current generation. Someone who has historically done more watches is owed fewer until the ledger evens out.
5. **Fairness is per lane.** Each lane (Solo = one shared pool; Dual/Triple = one lane per selected department) has its **own** ledger and its **own** balance. A deckhand competes only with other deck-eligible crew in the Deck lane, never against the interior crew.
6. **Consecutive exposure is discouraged.** Long unbroken runs of consecutive watch days are penalised so the rota doesn't grind one person down before rotating.

---

## 2. The Persistent Fairness Ledger

Per `backend.md`, `fairness_ledger` holds one row **per (lane, crew member)**. The counters:

| Field | Meaning |
|---|---|
| `total_watches` | All watches ever stood by this member in this lane (weekday + weekend). |
| `weekday_watches` | Watches on Mon–Fri in this lane. |
| `weekend_watches` | Watches on Sat–Sun in this lane. **Counted PER DAY** — under the B6 weekend-block modes (`sat_sun_block`/`fri_sat_sun_block`) a block-taker accrues one per covered weekend-day (a Sat+Sun block = +2). The block is a `schedule.md` *structure* choice; the scoring weights/formula here are **unchanged**. |

> **Charter Mode (B7) and fairness.** A charter is a *paused* date range — `schedule.md` simply **skips** those dates, so **no burden accrues** (no `updateLedger`, no score recompute — the scoring isn't even called). The ledger is byte-identical across the gap, so the unchanged selector **resumes from the correct next-due crew** automatically. Charter Mode therefore changes **nothing** in this document — pure structure, scoring frozen.

> **Dated per-crew leave (C3) and fairness.** Leave is Charter Mode scoped to one crew member: their booked leave dates are removed from **their** opportunity denominator (they were not "available" then) and they are not a candidate. The post-C2 rate (`watches ÷ opportunities`) is therefore computed over only the days they were actually available — **standing is preserved** (a few days off neither reset nor count against months of service; their rate before and after leave is consistent). This is an INPUT change (fewer opportunities/candidacy for the absent crew) feeding the **unchanged** post-C2 formula — the scoring is frozen, identical to C2.
| `friday_watches` | Watches specifically on Fridays (subset of weekday) in this lane. |
| `last_watch_date` | Date of their most recent watch in this lane (any day). |
| `last_weekend_date` | Date of their most recent **weekend** watch — drives the Monday-exclusion rule. |
| `consecutive_run` | Length of their current unbroken run of consecutive watch days ending at `last_watch_date`. |
| `fairness_score` | Cached 0–100 display score (section 5). Recomputed whenever counters change. |

**Lifecycle:**
- **Seeded** by `seed-fairness` from uploaded history (Dual/Triple). For Solo (no upload) or a vessel with no history, all counters start at 0 — a "cold" but valid state.
- **Incremented** by `generate-schedule` as it assigns each watch (the assignment that the engine makes immediately updates the ledger so the next day's decision sees up-to-date counts — see section 6).
- **Never reset** by normal generation. Resetting is an explicit, separate action.

> **Why weekday/weekend/Friday are separate counts:** because the rules treat them as separate rotations with different desirability. Mixing them into a single number would let someone with many weekend watches be unfairly handed weekday watches too, or vice versa. Tracking them apart is what makes "separate rotation" real.

---

## 3. Weighting

Not all watches are equally burdensome. We convert raw counts into a **weighted burden** using weights. These weights are the tuning knobs of the engine; defaults below are the v1 baseline (store them as named constants so they can be adjusted centrally).

```
W_WEEKDAY   = 1.0    # a normal Mon-Thu watch
W_FRIDAY    = 1.5    # Friday is heavier (extra 0.5 on top of being a weekday)
W_WEEKEND   = 1.3    # a Sat or Sun watch (per day)
W_CONSEC    = 0.25   # added burden per day of consecutive run beyond the first
```

**Weighted burden** for a crew member in a lane:

```
burden = (weekday_watches - friday_watches) * W_WEEKDAY     # non-Friday weekdays
       +  friday_watches                    * W_FRIDAY       # Fridays, heavier
       +  weekend_watches                   * W_WEEKEND       # weekend days
```

Note Friday is counted once, at the Friday weight (not double-counted as weekday + Friday). `weekday_watches` includes Fridays in the count, so we subtract `friday_watches` from the weekday term and add them back at the Friday weight.

> **C2:** this count-based `burden` is retained as the numerator; the fairness measure is now `burden ÷ opportunities` (see §5). The weights above are unchanged — they multiply inside `burden`, and the rate divides the result.

The consecutive penalty is applied at **selection time** (section 4), not stored in `burden`, because it reflects the *candidate's current run* at the moment of a decision rather than lifetime history.

---

## 4. Candidate Selection (the heart of the engine)

For a given **lane**, on a given **date**, the engine must choose who stands that watch. The procedure:

> **Canonical signature (must match `schedule.md` exactly):**
> `selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned) -> { crew_id, reason_code, detail }`
> where `dayType` is `'weekday' | 'weekend'`, `isFriday` is a boolean, `ledger` is the current per-(lane,crew) `fairness_ledger` state, and `alreadyAssigned` is the set of crew already assigned on this date (across lanes) used by the same-day guard. The companion `updateLedger(lane, crew_id, date, dayType, isFriday)` applies the ledger increments in Step D.

### Step A — Build the eligible candidate set
Start from the lane's pool:
- Solo lane -> all crew with `eligible = true`.
- Dept lane -> all crew with `eligible = true` AND `department = lane.department`.
- **C2 availability filter:** AND `available_from <= date` — a crew member is not a candidate before they joined (and this guarantees their opportunity denominator is ≥ 1, so the rate is well-defined; no divide-by-zero).

Then remove anyone failing a **hard constraint** for this date:
1. **Weekend-to-Monday exclusion.** If the date is a **Monday**, exclude any candidate whose `last_weekend_date` is the immediately preceding Saturday or Sunday (i.e. they stood the weekend that just ended). 
2. **Same-day already assigned.** In multi-lane tiers a crew member belongs to exactly one department, so they can only be in their own lane — but guard anyway: a crew member already assigned on this date (any lane) cannot be assigned again the same date.
3. **(Optional, settings-driven) rest rule.** If a minimum-rest setting is enabled, exclude candidates who stood watch within the configured look-back. (v1 default: only the explicit Monday-after-weekend rule above is enforced; a general rest rule is a later enhancement — leave a hook.)

If the hard constraints empty the candidate set (e.g. everyone did the weekend), relax in a defined order (section 8) and record that relaxation as a `fairness_event`.

### Step B — Score each candidate for THIS decision
For each remaining candidate, compute a **selection cost**. The engine picks the **lowest cost** (the person most "owed" a break from this kind of watch is the *least* likely to be picked; the person who has done the *least* of this kind of watch is the most likely to be picked — lowest cost = fairest to pick now).

The selection cost depends on the **day type** of the date, so that the two rotations stay independent:

**If the date is a weekday (Mon–Fri):**
```
cost = base_weekday_burden(candidate)
     + friday_term
     + consec_penalty(candidate, date)
     + recency_nudge(candidate, date)

where:
  base_weekday_burden = (weekday_watches - friday_watches) * W_WEEKDAY
                      +  friday_watches * W_FRIDAY
        # i.e. how much weekday+friday burden they already carry; more burden -> higher cost -> less likely picked

  friday_term = (date is Friday)
                ?  friday_watches * W_FRIDAY_SELECT      # heavily penalise giving Friday to someone who already has Fridays
                :  0
        # W_FRIDAY_SELECT defaults to 2.0 — stronger than the ledger weight, to actively spread Fridays

  consec_penalty = consecutive_run(candidate, up to date) * W_CONSEC
        # discourage extending a long run

  recency_nudge  = (last_watch_date is very recent) ? small positive : 0
        # tiny tie-shaper so we don't pick the same person two weekdays running when others are equal
```

**If the date is a weekend day (Sat/Sun):**
```
cost = weekend_watches * W_WEEKEND
     + consec_penalty(candidate, date)
     + recency_nudge(candidate, date)
        # weekend rotation is balanced purely on weekend history, independent of weekday load
```

Key point: **weekday decisions look at weekday/Friday counts; weekend decisions look at weekend counts.** That separation is the mechanism behind "Mon–Fri and Sat–Sun are their own schedules." Friday gets an *extra* selection penalty (`W_FRIDAY_SELECT`) so the same person doesn't keep drawing Friday even if their overall weekday count looks balanced.

> **C2 amendment — the cost is a RATE.** The ENTIRE count-based cost above is divided by the candidate's opportunities for that rotation (weekday cost ÷ `weekday_opportunities`, weekend cost ÷ `weekend_opportunities`). The **whole** cost is divided (not just the volume terms) so that with EQUAL availability the common divisor cancels and the ranking is byte-identical to pre-C2 (graceful degradation — verified: dividing only volume would flip picks via `consec`/`recency`). An opportunity = a scheduled watch-date of that rotation in the lane on/after the crew's `available_from`; it is counted for **every available crew on every scheduled date** (not just the one assigned), across seed + replay + the current run, so the denominator stays equal for equal-availability crew. Effect: a mid-season joiner reaches the lane's *rate* after ~their fair share of their own window, instead of being dumped on until their *count* catches longer-serving crew.

### Step C — Pick the lowest cost, break ties deterministically
Choose the candidate with the lowest `cost`. Resolve ties via the ordered tiebreakers in section 7.

### Step D — Assign, update ledger, record reason
- Write the `watch_assignment` (with `is_friday`, `day_type`).
- **Immediately update** that member's `fairness_ledger` row: increment the relevant counters (`total_watches`, `weekday_watches`/`weekend_watches`, `friday_watches` if Friday), set `last_watch_date` (and `last_weekend_date` if weekend), update `consecutive_run` (increment if this date is contiguous with their last watch, else reset to 1), and recompute `fairness_score`.
- Append a `fairness_event` with a `reason_code` and a `detail` JSON snapshot (the candidate costs considered, why this one won). Reason codes include: `lowest_cost`, `friday_spread`, `weekend_balance`, `monday_exclusion_applied`, `tie_break_<rule>`, `constraint_relaxed_<which>`.

This per-decision record is what lets `schedule-chat` answer "why is Alex on Friday" precisely: it reads the event and explains the cost comparison in plain language.

---

## 5. The Fairness Score (0–100, for display)

The dashboard shows a **fairness score per crew member** (per lane). This is a *display* measure of how balanced that member is relative to their lane peers — not the same as selection cost, but derived from the same ledger.

**Definition.** Within a lane, compute each member's weighted `burden` (section 3). Then express fairness as how close a member is to the lane's fair share:

```
fair_share   = mean(burden) over all ACTIVE members in the lane
deviation    = burden(member) - fair_share
spread       = max(stddev(burden over lane), epsilon)   # avoid divide-by-zero on tiny/equal crews

# Normalise deviation into a 0-100 score where 100 = exactly fair, lower = further from fair.
# A member doing MORE than their share and a member doing LESS are both "less balanced",
# but we surface direction in the breakdown (over/under), while the score measures closeness to balance.

z            = deviation / spread
fairness_score(member) = clamp( 100 - (abs(z) * K), 0, 100 )      # K defaults to 25
```

> **C2 amendment — score over the burden RATE.** `burden` above is replaced by a rate measure: `(burden ÷ opportunities_total) × meanOpp_lane`, where `opportunities_total = weekday_opportunities + weekend_opportunities` and `meanOpp_lane` is the lane's average opportunity count. The **relative structure** is the rate (so the score reflects watches-per-availability — a later joiner who has done their share reads ~100, same as a long-tenured peer); multiplying by `meanOpp_lane` restores **count magnitude** so the `EPSILON` spread-floor (a constant, unchanged) calibrates exactly as before. With EQUAL availability `opportunities_total == meanOpp_lane`, so the measure reduces **exactly** to the count `burden` and the 0–100 score is byte-identical to pre-C2. A member with **no opportunities yet** (`opportunities_total = 0`, e.g. just added) is shown **100 / not-owed** and excluded from the lane's spread (no re-introduced dumping).

- `K` is a scaling constant (default 25) so that being one standard deviation from the mean costs ~25 points. Tune centrally.
- **Interpretation for the UI** (drives the gauge colour from `branding.md`):
  - **>= 85** -> sea green (`--ws-fair-high`): well balanced.
  - **70–84** -> gold (`--ws-fair-mid`): slightly off balance.
  - **< 70** -> muted red (`--ws-fair-low`): notably over- or under-loaded; needs attention.
- The expandable breakdown shows the **direction and the components**: total watches, weekend count, Friday count, last-on-watch, current consecutive run, and whether they're currently *over* or *under* their fair share. (The chatbot uses the same data.)

> **Why a relative (peer-compared) score rather than absolute:** fairness is inherently comparative — "fair" means "evenly distributed across this crew," which only has meaning relative to the others in the lane. A lone crew member in a lane is trivially 100 (no one to be unfair to). As the ledger evens out over time, everyone's score trends toward 100.

**Vessel-level / dashboard summary metrics** (the `branding.md` dashboard metric colours) are lane/crew aggregates:
- **Watch Balance** (gold): how even `total` weighted burden is across the lane (e.g. `100 - normalised spread`).
- **Weekend Fairness** (sand): same idea computed on `weekend_watches` only.
- **Rotation Continuity** (sea green): a health indicator that the rotation is intact / no hard-constraint violations occurred (drops if relaxations were needed).

---

## 6. Seeding from Past Schedules (Dual/Triple)

`seed-fairness` (`backend.md`) establishes the *starting* ledger so the first generated rota is fairness-aware:

1. Claude vision extracts historical (date, crew, lane) watch records from the uploaded schedule images.
2. Fuzzy-match extracted names to `crew_members` (present the matches; unmatched names are surfaced for the captain to reconcile — do not silently drop).
3. For each (lane, member), aggregate the historical counts into the ledger fields (total/weekday/weekend/friday, last_watch_date, last_weekend_date, best-effort consecutive_run from the trailing history).
4. Compute initial `fairness_score`.
5. This is a **set** operation (idempotent): re-uploading replaces the seed rather than adding to it.

If no history is uploaded (always the case for Solo, optional for Dual/Triple), the ledger starts at zero — the very first schedule is then balanced from a clean slate, which is still fair, just not informed by prior burden.

---

## 7. Tie-Breaking (deterministic order)

When two or more candidates share the lowest selection cost, break ties in this exact order until one remains:

1. **Lower `total_watches`** in the lane (fewer total watches -> picked first).
2. **Lower `weekend_watches`** if the date is a weekend, or **lower `friday_watches`** if the date is a Friday (balance the specific scarce slot).
3. **Earlier `last_watch_date`** (longest since last watched -> picked first; rests the recently-worked).
4. **Lower `consecutive_run`**.
5. **Stable identifier order** (e.g. ascending `crew_id` / created_at) as the final deterministic fallback.

Recording: when a tiebreaker decides, the `fairness_event.reason_code` notes which rule (`tie_break_total`, `tie_break_scarce_slot`, etc.) so the decision remains explainable.

---

## 8. Constraint Relaxation (when the rota is infeasible)

Sometimes hard constraints cannot all be satisfied (e.g. on a small crew, everyone eligible for Monday stood the weekend). Relax in this defined order, recording each relaxation as a `fairness_event` so the captain can see where the rota was forced:

1. Prefer to **shrink the eligible-but-excluded set** by the *least* important constraint first: relax the optional rest rule (if enabled) before the Monday-after-weekend rule.
2. If still infeasible, relax the **Monday-after-weekend exclusion**, choosing among the previously-excluded the one with the **lowest weekend burden** (the least-bad choice), and flag it (`constraint_relaxed_monday_exclusion`). This visibly dents **Rotation Continuity**.
3. If a lane has **no eligible crew at all** (everyone toggled ineligible), produce no assignment for that lane/date and surface a clear warning to the captain (the UI shows a gap with an explanation; the chatbot can explain it).

Never silently violate a rule — always record it. The value of the product is trust; visible, explained exceptions preserve trust where silent ones would destroy it.

---

## 9. Worked Example (the post-C2 baseline — regression canary)

C2 changed the math deliberately, so this is the NEW baseline. It has two halves: (a) proves the change **degrades** to the old behaviour when availability is equal; (b) proves it **fixes** the join-timing bug.

### 9(a) No turnover (EQUAL availability) — reproduces the pre-C2 numbers exactly
Crew A, B, C, all available from the lane's start, so each has the same opportunity denominators. Ledger (weekday/friday/weekend): A(6,2,3), B(5,1,2), C(5,2,4).

- **Tuesday** (weekday): count cost A `(6-2)·1.0 + 2·1.5 = 7.0`, B `5.5`, C `6.0`. The rate divides each by the common `weekday_opportunities` → ranking unchanged → **B stands** (exactly as pre-C2).
- **Friday** (with `W_FRIDAY_SELECT=2.0`): count cost A `11.0`, B `7.5`, C `10.0` → ÷ common opp → **B** (exactly as pre-C2).
- **Score:** with equal opportunities the rate measure reduces to the count burden, so the 0–100 scores are byte-identical to pre-C2 (e.g. B ≈ 65). ✅ **degradation: same schedule, same scores.**

### 9(b) Mixed availability (turnover) — the fix
Weekend rotation. A & C aboard long (**30** available weekends each, stood **10**); B joined recently (**3** available weekends) and has stood their share (**1**):

| | A | B (recent joiner) | C |
|---|---|---|---|
| stood / available weekends | 10 / 30 | **1 / 3** | 10 / 30 |
| weekend **rate** (`watches·W_WEEKEND ÷ opp`) | 0.433 | **0.433** | 0.433 |
| **C2** fairness score | **100** | **100** | **100** |
| **C2** next-weekend selection cost | 0.433 | **0.433 (tie — not preferred)** | 0.433 |
| pre-C2 (count) burden | 13.0 | **1.3** | 13.0 |
| pre-C2 score / next pick | 82 | **64, and dumped ~10×** | 82 |

**B, with 1 watch, reads 100 alongside A's 10** — both stood their fair share of the time they were available — and B is **not** preferentially assigned. A 0/3 joiner is picked for ~their fair share of their own window then balances (verified: ≤ ~4 of the next 8 weekends, versus the pre-C2 engine dumping ~8). This is the behaviour the chatbot narrates from honest numbers ("stood 1 of 3 available weekends").

**Following Monday:** unchanged — a crew member who stood the preceding weekend is still hard-excluded from Monday (`monday_exclusion_applied`); rate-fairness applies to the remaining candidates.

---

## 10. Constants Summary (tune centrally)

```
# Ledger burden weights
W_WEEKDAY        = 1.0
W_FRIDAY         = 1.5
W_WEEKEND        = 1.3
W_CONSEC         = 0.25

# Selection-time extra penalties
W_FRIDAY_SELECT  = 2.0     # extra penalty per existing Friday when assigning a Friday
RECENCY_NUDGE    = 0.1     # tiny tie-shaper for very-recent last_watch_date

# Score scaling
K                = 25      # points lost per 1 std-dev from lane mean
EPSILON          = 0.5     # spread floor to avoid divide-by-zero
SCORE_HIGH       = 85      # >= -> sea green
SCORE_MID        = 70      # 70-84 -> gold; < -> muted red
```

Store these as named constants in the function (a single `fairness_constants.ts`) so the captain-facing behaviour can be tuned without rewriting logic.

---

## 11. Contract with `schedule.md`
- `schedule.md` owns: iterating dates across the horizon, per-lane looping, weekday/weekend rotation structure, writing the schedule container, and orchestration.
- `fairness.md` (this doc) owns: the eligible-set hard constraints, the selection cost, tie-breaking, ledger updates, the score formula, and the recorded reasons.
- `generate-schedule` calls, for each (lane, date): `selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned)` (this doc) -> returns `{ crew_id, reason_code, detail }`, then writes the assignment and applies `updateLedger(lane, crew_id, date, dayType, isFriday)` (this doc's update rules). **This 6-argument signature is the canonical seam and must match `schedule.md` section 5/11 exactly.**

> Fairness is the product. Make it deterministic, make it explainable, and never let it violate a rule without recording why. Every number on the dashboard and every answer from the chatbot traces back to the ledger and the events defined here.
