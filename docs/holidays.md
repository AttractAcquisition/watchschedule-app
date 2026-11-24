# Holidays

> **STATUS: PROPOSAL — not built.** Written first per `CLAUDE.md` §8.
> Owned by `fairness.md` (selection, weights, turn-taking) and `backend.md`
> (the table). `schedule.md` owns where it sits in the iteration.

## Why a weight is not enough

The obvious design is "Christmas is a day worth 3.0 instead of 1.0". It does
not work, and we have three failures from 24 November 2026 proving why: the
Friday rotation was weighted heavily (`W_FRIDAY_SELECT = 2.0`) and still handed
the same person three Fridays in a row, because **a weight balances totals
while a rota balances turns**. Totals come out even and one person still stands
Christmas twice.

Christmas is the single watch a crew will actually count. It gets a rotation.

## The model

A **major** holiday is lifted out of its day class and decided by its own
rotation, using the two keys that finally fixed Friday:

```
relaxed -> holidayTurn -> holidayQueue -> cost -> total -> scarce -> ...

holidayTurn  = major_holiday_watches        (lowest first: everyone stands one
                                             before anyone stands a second)
holidayQueue = last_major_holiday_date      (oldest first; never stood one
                                             sorts ahead of every date)
```

A **minor** holiday is not a rotation. It is selected normally for whatever day
it falls on, and carries an increased weight in `burden` so it shows in the
score. (Decision, 24 Nov 2026: Christmas Day outranks an August bank holiday,
but a bank holiday does not deserve its own queue.)

### Lifted out means lifted out

A major holiday increments `major_holiday_watches` and `total_watches`, and
contributes `W_HOLIDAY_MAJOR` to `burden`. It does **not** increment
`friday_watches`, `weekday_watches` or `weekend_watches`, and it does not touch
the Friday queue.

So standing Christmas does **not** reduce your ordinary weekday share — exactly
as standing a weekend does not. Three independent rotations: weekday, weekend,
major holiday. This is the existing two-rotation principle extended, not a new
idea.

### Where it sits in the iteration

`schedule.md` §5 scarcity order gains a step at the front:

```
major holiday -> weekend block -> Friday -> Monday -> Tue/Wed/Thu
```

A holiday is the scarcest and most contested day there is, so it picks from the
whole pool first.

**A holiday on a weekend splits the block.** 25 December 2027 is a Saturday;
the holiday day is decided on its own and the remainder of the block is decided
as usual. This is the existing B6 partial-block path that already handles a
block cut by leave or a charter — no new mechanism.

## Defining holidays

New table `vessel_holidays` (client-RW, vessel-scoped, RLS like
`charter_periods` / `crew_leave` / `watch_pins`):

| column | notes |
|---|---|
| `holiday_date` | plain `date` |
| `label` | "Christmas Day", "Owner's birthday" |
| `tier` | `major` \| `minor` |

The captain builds the list in Settings from three routes, which compose:

1. **Tick from a preset list** — UK bank holidays as the baseline, since the
   list has to start somewhere and a flag-state guess would be worse for a
   multinational crew.
2. **Add any date** — an owner's trip, a national day that matters to this
   crew, a charter handover.
3. **Retier anything** — the presets arrive with Christmas Day and New Year's
   Day as `major` and the rest `minor`; the captain overrides freely.

> **Presets are dated data, not a rule.** UK bank holidays move: Easter is
> computed, and a date falling on a weekend produces a substitute day. The
> preset list is therefore a static table **per year**, seeded a few years
> ahead, not an algorithm. It is a starting point the captain edits, never a
> source of truth.

## Surviving a reset

**Holiday history is exempt from `fairness_reset_at` and
`calendar_cleared_at`.** Every other counter is rebuilt from the generations a
reset leaves visible; the major-holiday counters are built from **all**
generations regardless.

The reason is that this is the one piece of state that cannot be rebuilt.
Christmas happens once a year and never appears in the same 91-day generation
window as the next one, so the ledger is the *only* thing carrying the rotation
across years. A clear pressed in March would silently erase who stood Christmas
— and nothing would reveal it until the following December.

> Consequence worth stating: a watch hidden from the calendar can still count
> toward someone's holiday turn. That is deliberate. Surface it in the holiday
> view so it is never a surprise.

## What this can and cannot promise

Six crew and two major holidays a year is **three years** before everyone has
stood one, and a yacht's crew turns over faster than that. Perfect rotation is
unreachable and the product should not claim it. The achievable promise is
narrower and still worth having:

> **Nobody aboard stands a major holiday twice before everyone aboard has
> stood one.**

Because fairness here is only visible on a multi-year view and the dashboard
shows a month, the holiday list must show **when each crew member last stood
one** — otherwise the rotation is real but invisible, which is the same as not
having it.

## Audit

`docs/rota-audit.md` gains two patterns:

| code | meaning |
|---|---|
| `holiday_concentration` | someone has stood 2+ major holidays while a colleague aboard has stood none |
| `consecutive_holidays` | the same person on a major holiday in consecutive years |

Both cumulative, both advisory — and counted the way `friday_concentration`
learned to count, from the ledger rather than the window.

## Constants

```
W_HOLIDAY_MAJOR = 3.0     # a stood major holiday, in burden
W_HOLIDAY_MINOR = 2.0     # a stood minor holiday, in burden
```

In `fairness_constants.ts` with everything else. Values are a tuning decision,
not a structural one — the rotation does the work, the weights only make the
score honest.

## Open question — charters

**Superyachts are busiest at Christmas and New Year.** A charter pauses the
rota completely (`schedule.md` §4.2): no selection, no assignment, no ledger
update, no turn consumed. So in exactly the years the holiday rotation matters
most, it may not advance at all — and the crew who worked hardest over
Christmas get no credit for it, because formally nobody stood a watch.

Three ways out, and this needs deciding rather than discovering:

1. **Accept it.** A paused day is a paused day; the rota resumes after. Simple,
   consistent with charter mode, and arguably wrong for the crew.
2. **Let a charter be marked "watches still stood."** The rota runs through it.
   Truer to life on a working yacht, but reopens a settled design.
3. **Credit the holiday without scheduling it.** Nobody is assigned, but the
   holiday turn is consumed by whoever was aboard. Fairest in spirit, strange
   in the data — a turn used with no watch behind it.

**Unresolved. Not to be invented at build time** (`CLAUDE.md` §8).

## Migration

New table `vessel_holidays`; new ledger columns `major_holiday_watches` and
`last_major_holiday_date`; `vessel_fairness` extended. Regenerate
`app/src/types/db.ts`. Server-only writes, RLS and determinism unchanged.
