# Manual override — one cell, by hand — approved 26 October 2026

This contract reverses the "manual per-day schedule editing" exclusion in `additions-v2.md` (scope note) and `additions.md` §"Out of scope". The captain asked for it directly; it is now in scope and specified here. Nothing else in those exclusions moves: there is still no locking, no approval lifecycle, no diff tracking, no what-if simulator, and no crew-initiated edits.

## What it is

On the dashboard calendar the captain clicks the person standing a given lane's watch and changes them to someone else — or to nobody. The schedule is **not** re-planned: the generator owns generation, the captain owns that one cell. Every other day stays exactly as generated. Fairness **is** recomputed immediately, by the ordinary ledger replay over the amended assignments, so the scores always describe the rota the crew actually work.

A regeneration replaces its whole window, so manual changes inside it are overwritten — intended, and stated in the UI. Manual changes on dates **before** a regeneration's start survive as history and keep counting towards fairness, under the same per-date winner rule as every other superseded schedule.

## Rules, consent and refusal

The engine's hard exclusions remain hard: the captain may break one only by acknowledging that specific rule, by code, in the same request. Blanket consent does not exist — the request carries `acknowledge: [code, …]` and the server refuses unless **every** violation it finds is named there. Violations are recomputed against the live rota at apply time, so a change made in another tab re-opens consent rather than slipping through.

| code | severity | meaning |
|---|---|---|
| `monday_after_weekend` | rule | fairness.md §4 A.1, checked in both directions — assigning the Monday after a weekend they stood, or the weekend before a Monday they hold. |
| `friday_into_weekend` | rule | fairness.md §1b (26 Oct 2026), both directions. Exempt under `fri_sat_sun_block`, where the Friday leads the block. |
| `both_weekend_days` | rule | the double weekend watch — both halves of one weekend. Not raised for a `sat_sun_block`, which covers both days by construction. |
| `on_leave` / `not_joined` / `ineligible` | rule | booked `crew_leave`, an `available_from` after the day, or `eligible = false`. |
| `outside_lane_pool` | rule | the crew member's department is not in that lane's pool. Their watches still count on the ledger; the generator still will not pick them for that lane. |
| `consecutive_weekends` | caution | the weekend either side is theirs as well — priced by the engine, not forbidden by it. |
| `long_consecutive_run` | caution | four or more scheduled days in a row. |

One thing is **refused outright and cannot be consented away**: `already_on_watch` — one person, one watch a day, the invariant `publish_rota` enforces for generated rotas and `apply_manual_override` re-checks after writing. Days outside the current schedule, days it never scheduled, and charter-paused days are not editable at all.

A weekend block has one watchkeeper by construction, so a change to any of its days moves **all** of them. The block is derived exactly as `planGlobal` derives it, from the structure recorded in that schedule's own snapshot (`rota_snapshot.weekend_structure`) — never from today's settings, which may have moved on.

## Fairness

The recompute is not a second formula. `loadGlobalBase` replays seed plus canonical history over **all** dates with the amendment applied, and `globalScores` scores it — the same two functions generation uses. The scored population is the engine's: everyone an active lane can draw on, plus anyone standing a watch in the schedule being edited (so a consented out-of-pool assignee is still scored while their watch stands).

The crew member taking a watch gains the **opportunity** for those days, appended to that schedule's `rota_snapshot.opportunities`; they were available to stand it, and without the denominator the burden rate would be meaningless. The crew member losing it keeps theirs — they were available too. Deduplication by `crew_id:watch_date` in `replayGlobal` makes the append idempotent. A legacy (engine v1) snapshot has no stored opportunity list and is left alone: writing one would make the replay read a single entry as the complete set.

Tests prove the property this rests on: replaying a published rota reproduces the generator's ledger byte-for-byte, so a recompute with nothing amended cannot drift from what generation wrote.

## Seams

- **Edge Function `override-assignment`** (the 9th; `supabase/functions/override-assignment/`). Two modes on one contract, so the browser holds no copy of the rules:
  - `{ watch_date, lane_id }` → `{ days, current_crew_id, options: [{ crew_id, full_name, in_lane, violations, blockers }] }`
  - `{ watch_date, lane_id, crew_id | null, acknowledge }` → `{ applied, fairness }`, or `{ requires_consent, violations }`, or `{ blocked, blockers }` — all **200**: consent and refusal are answers, not transport failures.
  Re-derives `vessel_id` from the JWT like every other function; requires an active subscription.
- **`_shared/manual_override.ts`** — pure predicates: `blockFor` (which days move together) and `checkOverride` (what a selection breaks). No I/O, no writes.
- **`_shared/rota_data.ts`** — `loadGlobalBase` takes an optional `RotaPatch`, an amendment replayed as if already saved, so a change can be scored before it is persisted.
- **RPC `apply_manual_override(p_vessel, p_revision, p_plan)`** — service-role only, migration `20261026030000`. Rewrites the block's assignments, re-checks the one-watch-a-day invariant, appends the opportunities, logs a `manual_override` row in `fairness_events`, rewrites `vessel_fairness`, and bumps `rota_revision` — all in one transaction behind the same revision check `publish_rota` uses, so an in-flight generation fails safely rather than publishing over the change.
- **`watch_assignments.is_manual`** — which rows the captain set by hand. Generation writes `false`, so a regenerate clears the flag with the overrides.
- **Client** — `AssignmentEditor.tsx` (the picker and the per-rule consent checkboxes) and `WatchCalendar.tsx` (editable cells, a gold inset ring on hand-changed days). The client computes no rules and writes no rota table; it calls the function and invalidates the dashboard query.

Invariants unchanged: Supabase is the single source of truth, RLS is the access gate, the schedule and fairness tables are written only by server functions through service-role, secrets stay in Edge Functions, and generation stays deterministic — an override is an input to the next replay, never a source of randomness in it.

Verification: `supabase/functions/_shared/manual_override_test.ts` (block derivation, every rule from both directions, refusal vs. consent, replay fidelity, and that an override moves exactly one watch), plus `rota_v2_test.ts` unchanged and `npm run build` in `app`.
