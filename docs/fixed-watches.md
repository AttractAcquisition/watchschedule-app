# Fixed watches — pinning a crew member to a date before generation — approved 27 October 2026

The captain names someone for a specific date **before** the rota is built: "Marco stands the weekend of the 14th." Generation then plans everything else around that, under the ordinary fairness rules. This is the mirror image of [manual-override.md](manual-override.md), which changes one cell **after** generation; a fixed watch is an *input* to generation, not an edit of its output.

It does not reverse any exclusion in `additions.md` or `additions-v2.md`: those rule out manual editing of a generated schedule, which the 26 October contract already addressed. Pinning is a configuration input, like `crew_leave` or `charter_periods`.

## What it is

Under **Settings → Watch configuration → Advanced → Fixed watches** the captain picks a crew member, a lane and a date. The pin is stored and survives generation: it is a standing instruction, so every regeneration reproduces it until the captain deletes it. A pin whose date has passed goes inert — it is kept and shown greyed out, never deleted, so the fairness history it produced stays intact.

Generation honours the pin exactly, then plans the rest of the rota around it with the normal engine: the pinned watch lands on the ledger before the surrounding days are chosen, so the crew member's fairness standing absorbs it and the engine gives them correspondingly less elsewhere. A pin is **not** a fairness exemption; it is a fact the fairness engine has to live with.

A pin that cannot apply is inert rather than an error: a date outside the generation window, a charter-paused day, a weekend when `include_weekends` is off, or a lane that is no longer active. The UI says so per pin; generation ignores it and plans that day normally.

## Which days one pin covers

The weekend structure decides. Under `sat_sun_block` a pin on either day moves both; under `fri_sat_sun_block` a pin on Friday, Saturday or Sunday moves all three. The block is derived by `blockFor` from `rota_v2`'s own walk of the window, so a pin can never split a block the generator treats as one watch.

## Rules, consent and refusal

A pin may break a rule, and the captain may proceed only by acknowledging that exact code — the same model as the manual override. What differs is **what counts as a violation at pin time**, and this is the heart of the contract:

> The neighbour rules are checked against **facts only** — another pin, or a watch already stood on a date *before* the generation window. They are **never** checked against days the generator has not planned yet.

This matters because the days around a pin do not exist when the pin is made. Pinning someone to a weekend breaks nothing on its own: the generator will simply not hand them that weekend's Friday or the Monday after, because the pin is already on the ledger when those days are chosen. Raising `monday_after_weekend` there would be a false alarm about a day the engine was never going to assign. But if the captain pins **both** the weekend *and* the Monday after it, that is a real conflict between two deliberate instructions, and it needs consent.

| code | severity | when it fires at pin time |
|---|---|---|
| `monday_after_weekend` | rule | The preceding Sat/Sun is **pinned** to the same person, or was stood by them **before** the window. Not raised against an ungenerated weekend. |
| `friday_into_weekend` | rule | The Friday is pinned to them, or stood before the window. Both directions. Exempt under `fri_sat_sun_block`. Not raised against ungenerated days. |
| `both_weekend_days` | rule | Both halves of one weekend are pinned to the same person. Not raised for `sat_sun_block`, which covers both by construction. |
| `on_leave` / `not_joined` / `ineligible` | rule | Booked `crew_leave`, an `available_from` after the day, or `eligible = false`. Static facts, always knowable. |
| `outside_lane_pool` | rule | Their department is not in that lane's pool. The pin still stands; the generator would not have picked them for that lane. |
| `consecutive_weekends` | caution | The weekend either side is pinned to them or was stood before the window. |
| `long_consecutive_run` | caution | Four or more consecutive days, counting pins and pre-window history only. |

Two things are **refused outright** and cannot be consented away, both enforced by unique constraints rather than by application code:

- One person, one watch a day — `unique (vessel_id, crew_member_id, watch_date)`.
- One person per lane-day — `unique (vessel_id, lane_id, watch_date)`.

Consent is stored **per pin**, in `watch_pins.acknowledged`. The captain ticks a code once and that pin stops asking, so a routine regeneration is not a consent interview. Violations are recomputed from live data on every evaluation, so a code that appears later — leave booked over a pin after the fact — is unacknowledged and re-opens consent. Generation refuses while any pin has an unacknowledged violation, and says which.

## Fairness

A pinned watch is an ordinary watch on the ledger. `planGlobal` writes it through the same `updateLedger` call as a chosen assignment, before the rest of the window is planned, so every later selection sees it.

The pinned crew member also gains the **opportunity** for those days, exactly as the manual override grants it: they were available to stand the watch, and without the denominator their burden rate would be meaningless. A pinned crew member outside every lane pool is added to the scored population for the same reason the override contract adds a consented out-of-pool assignee — they are standing a watch, so they are scored.

Determinism is unchanged. Pins are read in a fixed order and applied before any search, so identical inputs still produce identical schedules.

## Seams

- **Table `watch_pins`** — migration `20261027010000`. Client-RW, vessel-scoped (the `crew_leave` / `charter_periods` pattern), `current_vessel_id()` RLS. Columns: `crew_member_id`, `lane_id`, `watch_date`, `acknowledged text[]`, `note`. Cascades from vessel, crew member and lane. It is a configuration table, not a rota table, so the client owns it — the schedule and fairness tables remain server-only (master.md §2 invariant 4).
- **`_shared/watch_pins.ts`** — pure predicates. `pinBlocks` groups pins into the blocks the engine will treat as one watch; `checkPins` evaluates them by delegating to `checkOverride` with a **facts-only `stood`** predicate. No I/O, no writes, no second copy of the rules.
- **`_shared/rota_data.ts`** — `loadGlobalBase` additionally returns `stoodBefore`, the `crew:date` set of watches standing before the window, which is what "fact" means for the neighbour rules.
- **`_shared/rota_v2.ts`** — `planGlobal` takes `pins`. Each block's pinned lanes are forced, their crew pre-reserved so no other lane can take them that day, and the opportunity and ledger updates follow the ordinary path. The event's `reason_code` is `fixed_watch`.
- **Edge Function `generate-schedule`** — gains `preview_pins: true`, which evaluates the pins and returns them **without writing**, and a consent gate on the real run: `{ requires_pin_consent: true, pins }` at 200 when any pin has an unacknowledged violation. Consent and refusal are answers, not transport failures.
- **Client** — `FixedWatches.tsx` (the Advanced panel: add, delete, per-pin status and consent checkboxes) and `RegenerateButton.tsx`, which presents the pins falling inside the window before the captain commits. The client evaluates no rules: it renders what `preview_pins` returns and writes back only the codes the server named.

Invariants unchanged: Supabase is the single source of truth, RLS is the access gate, the schedule and fairness tables are written only by server functions through service-role, `vessel_id` is re-derived from the JWT, secrets stay in Edge Functions, and generation stays deterministic.

Verification: `supabase/functions/_shared/watch_pins_test.ts` (block derivation, the facts-only rule, each code from both directions, consent and refusal, inert pins) and additions to `rota_v2_test.ts` (a pin is honoured, lands on the ledger, reserves the person vessel-wide for that day, and leaves generation deterministic), plus `npm run build` in `app`.
