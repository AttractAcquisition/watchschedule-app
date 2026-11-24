# Schedule history on the calendar — approved 24 November 2026

The captain reported that generating a new window made the past disappear: on 24 November, generating December emptied the whole of November from the calendar; generating *from today* emptied 1–23 November. They asked for history to stay on the calendar, stay in the watch schedule, and keep counting towards fairness.

Two of those three were already true.

## What was actually wrong

**Fairness was never losing history.** `generationWindow` clamps a regeneration's start to today or later, so generation never re-plans a past day. `loadGlobalBase` → `canonicalHistory` replays every surviving version's assignments and opportunities into the ledger, and `publish_rota` flips `is_current = false` rather than deleting anything. November's watches were in the database and in the scores the entire time.

**The dashboard read was wrong.** `useDashboardData` fetched `watch_assignments` for the current schedule only (`.eq('schedule_id', sched.id)`), with one narrow backfill: if the current schedule *started in the future*, it loaded the single prior schedule covering today and showed its days before that start. Three gaps followed.

1. **Generating from today.** A window beginning today is not planned-ahead, so `plannedStart` was null, the backfill never ran, and every earlier day in the month vanished. This was the captain's second scenario exactly.
2. **More than one prior generation.** Only the one schedule covering today was ever loaded. A vessel with September, October and November schedules showed November at best.
3. **Reconfigured lanes.** `save_watch_configuration` mints a **new lane uuid** when a lane is added and deactivates removed ones. The backfill filtered history through `laneIds.has(a.lane_id)` against the *current* schedule's lanes, so any schedule generated before a lane reconfiguration was discarded even when the backfill did fire. This is why December could blank November even in the case the backfill was written for.

The result was a calendar that disagreed with the fairness panel beside it: the scores counted watches the calendar refused to show.

## The rule

The dashboard reads the **canonical union of all schedule versions** — every `schedules` row and every `watch_assignments` row for the vessel, resolved to one winner per date.

The winner rule is the engine's rule, verbatim:

> the newest generation whose `start_date <= date`, and only if that generation also covers the date.

Both clauses matter. The first is what preserves history: a regeneration always starts today or later, so for any past date the lookup skips every newer generation and lands on the one that actually covered it. The second preserves the documented behaviour that *a newer regeneration supersedes the older future, even if its horizon shrinks* — regenerate 24–28 November over a schedule that ran to the 30th and days 29–30 are owned by nobody, because the captain shrank the window. That rule was considered and deliberately left alone; reversing it would resurrect retired watches and shift fairness on every vessel, and it is not what the captain was reporting.

### This is a seam

```
canonicalHistory()                         resolveRota() / scheduleOwner()
supabase/functions/_shared/rota_v2.ts  ==  app/src/lib/canonicalRota.ts
```

The engine uses the rule to decide which stored version's watches count towards fairness; the client uses it to decide which stored version's watches the calendar shows. If the two drift, the calendar and the scores describe different rotas for the same day — the very bug this fixes. Change one, change both.

The client still computes no rota. Every assignment it renders was written by a server function; `canonicalRota.ts` only resolves which already-stored version owns a date.

### Retired lanes

When a historical assignment's lane id is no longer live, it is placed on the calendar row holding the same **lane position**, read from that version's own `rota_snapshot.lanes`. The watchkeeper lands in the right slot even though the uuid is gone. A row matching its lane id outright always wins the lane-day over a position-mapped one, so one watchkeeper per lane-day still holds. History whose position no longer exists at all is dropped rather than misfiled — exact per-version viewing is Schedule History's job (`additions.md` A2), which already loads retired lanes.

## What did not change

- **History is read-only.** Only the current schedule's own days stay clickable; `override-assignment` still refuses anything outside the current schedule (`manual-override.md`).
- **Exports stay scoped to the current schedule.** `scheduledDates()` is the rota in force, not the vessel's whole history — a WhatsApp paste or a printed rota must not grow a year of back-watches.
- **No schema change, no migration, no Edge Function change, no engine change.** Frontend only.
- Every §2 invariant: reads are RLS-scoped client selects, the schedule and fairness tables remain server-written, the engine remains deterministic.

## Fairness confirmation toast

The captain also asked that a manual change feed into fairness, with a "regenerate fairness score" button to trigger the recalculation.

It already feeds in. `override-assignment` recomputes fairness in the same transaction as the change, through the ordinary replay, and rewrites `vessel_fairness` (`manual-override.md` § Fairness). Nothing on screen said so, which is what made it look absent.

So there is no button, deliberately: a control implying fairness might be stale would misdescribe a system where it never is, and a button that only ever confirms what already happened is a lie about its own purpose. Instead a successful apply raises a brief confirmation — bottom-right, ~3 seconds, `components/ui/Toast.tsx`, `role="status"` with `aria-live="polite"` so it is announced without stealing focus, and fading only under `motion-safe`. It reads **"Fairness score has been updated."** `AssignmentEditor` reports the apply via an `onApplied` callback and `Dashboard` owns the toast.

## Seams

- **`app/src/lib/canonicalRota.ts`** (new) — `scheduleOwner` (per-date winner, memoised) and `resolveRota` (canonical assignments + scheduled dates, lane-mapped). Pure; no I/O.
- **`app/src/routes/Dashboard/useDashboardData.ts`** — loads all versions and all assignments (paged past the PostgREST row cap, since a vessel accrues a row per lane-day per generation) and resolves them. `DashboardData` gains `scheduledDates` and `hasPriorRota`; `interimScheduledDates` is gone, replaced by the general rule.
- **`WatchCalendar.tsx`** — takes the resolved scheduled-date set; assignment lookup is now an indexed map rather than a linear scan per cell, because the rota spans every generation.
- **`components/ui/Toast.tsx`** (new) + `AssignmentEditor.onApplied` + `Dashboard`.
- **`scheduledDates.ts`** — fallback clamped to the current schedule's range.

Verification: `app/src/lib/canonicalRota.test.ts` (the winner rule including the shrunken-window case and the same-timestamp tie-break; November surviving a December generation; 1–23 November surviving a generate-from-today; multi-month history; retired-lane mapping; one-watchkeeper-per-lane-day; scheduled-date resolution; legacy snapshots) and `app/src/components/ui/Toast.test.tsx`, plus `npm test` and `npm run build` in `app`.
