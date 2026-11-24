# Post-generation rota audit

> Approved 24 November 2026. Owned by `schedule.md` (orchestration); the
> objective and its precedence are owned by `fairness.md`.

## Why it exists

Every rule the engine enforces is **local** — this day, this person, these
neighbours. Nothing ever asked whether the **finished month** is defensible, so
emergent shapes slipped through with the engine satisfied at every single step:
one crew member drawing three Fridays running, another standing every Monday,
a third taking back-to-back weekends. Each decision was individually correct.

The audit answers one question a captain can check:

> **Is there a single swap that would make this rota fairer?**

If the answer is no, the rota is **locally optimal** under the same measure the
dashboard scores from — a claim that can be reproduced, not merely asserted.

A non-empty result is **not a defect**. The engine is greedy: it commits each
day against the ledger as it stood at that moment, so a finished month can hold
improvements it could not have seen. Surfacing them is the point. What the
audit guarantees is that everything it reports is genuine — positive, ordered
best-first, legal under every rule, and never a trade of the rotation for a
rounder total.

## What it is not

It is **not** an LLM reviewer. A model asked to review a rota will fluently
justify a bad one; manufactured confidence is the opposite of defensible. The
audit is deterministic arithmetic with a published objective.

It **reports and never applies.** A cleanup pass that silently rearranged days
would break the per-day explanation the product is built on — "why is Greta on
the 25th?" cannot be answered with "a later pass moved her." The captain
decides; the engine shows its work. Improvements surface as candidates for the
ordinary manual override (`docs/manual-override.md`), which already carries
consent, recording and replay.

## The objective

The spread (population standard deviation) of the **burden rate** across rated
crew — `burden ÷ opportunities × meanOpp`, identical to what
`computeFairnessScore` uses, so the audit and the dashboard agree on what
"fairer" means. Lower is fairer.

Only two crew members' burdens move in a swap, so each candidate is scored in
**constant time** by adjusting running sums rather than rebuilding the spread.

## Two objectives, and which wins

Weighted balance and **rotation** are different objectives and they do not
always agree: a swap can flatten the burden spread by handing someone a second
Friday while a colleague has none. That is a trade of one kind of fairness for
another, not an improvement. The audit therefore **rejects any swap that
increases the variance of Friday counts**, matching the precedence set in
`fairness.md` Step B — where they conflict, the rotation wins, because it is
the fairness a crew actually experiences.

## Scope and limits

- **Weekday-to-weekday swaps only.** Weekend days move as whole blocks under
  `sat_sun_block` / `fri_sat_sun_block`, so exchanging one of them would split
  a block the engine placed atomically, and the weekend is its own rotation in
  any case. **Fridays are weekdays here** — which is the case that matters.
- **Pairwise only.** A three-way rotation that improves on every pairwise swap
  will not be found. "No single swap improves this" is the exact claim; it is
  not a proof of global optimality.
- A swap is only offered once it is known to improve the objective **and** has
  been checked against every engine rule: lane pool, eligibility, availability,
  same-day double-booking, rule 1b, rule 1c and the Monday rule. Rules always
  beat arithmetic.
- Capped at `maxPairs` (default 200,000) so a three-lane quarter cannot stall
  a generation.

## Patterns

Advisory, never blocking — shapes that are properties of the finished month
rather than of any one decision:

| code | meaning |
|---|---|
| `friday_concentration` | cumulative Friday counts differ by 2+ turns across the crew |
| `repeated_weekday` | one crew member on the same weekday 3+ times in the window |
| `consecutive_weekends` | the same person on two weekend blocks running |

`friday_concentration` is counted **cumulatively from the ledger**, never from
the window alone. A crew member who stood their Friday last month has had their
turn; judging a window in isolation reports concentrations that do not exist —
eight Fridays across six people is 2,2,1,1,1,1 and there is no other
distribution. A gap of one turn is unavoidable whenever the Fridays do not
divide evenly, so only a gap of **two or more** is reported.

`repeated_weekday` is expected on a settled rota and is not a defect: with a
weekly cycle people naturally land on a fixed slot. It is surfaced because
crews notice it, and a captain may want to break it by hand.

## Storage

Written into `schedules.rota_snapshot.audit` — an existing `jsonb` column, so
**no migration**. Shape: `{ spread, improvable[], patterns[], considered }`.

## Determinism

Fully deterministic: swaps are ordered by gain, then by date, then by crew id.
The audit never mutates the plan it inspects.
