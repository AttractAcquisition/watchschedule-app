# Clearing and restoring the rota — approved 24 November 2026

Three operations, all reversible, none of which deletes a watch.

| | what it does |
|---|---|
| **Clear all watches** | hides every generation from the calendar and stops it counting towards fairness |
| **Restore cleared watches** | lifts that marker |
| **Make this the live schedule** | copies an older generation forward as the new current one |

The third reverses the "no revert/restore" exclusion in `additions.md` A2 for the schedule-history surface. The captain asked for it directly. The rest of that exclusion stands: no approval lifecycle, no locking, no diff tracking, no crew-initiated edits.

## Clearing is a marker, not a delete

`vessels.calendar_cleared_at` hides generations at or before that moment. The watches stay in `watch_assignments`, Schedule History still lists every version, and **Restore cleared watches** puts them all back.

**Fairness follows the calendar.** Clearing sets `fairness_reset_at` to the *same timestamp* and empties `vessel_fairness`. Scores that describe watches nobody can see are worse than no scores, and the next regeneration would otherwise balance against invisible history.

That shared timestamp is how a restore knows what to undo: it nulls `fairness_reset_at` **only** when it still equals `calendar_cleared_at`. A fairness reset the captain made separately and earlier, through "Clear fairness history", is left alone — restoring the calendar must not resurrect a season they deliberately ended.

`loadGlobalBase` takes the later of the two markers. Each only ever moves the cut-off forward.

## Restoring a version copies it forward

A restore does **not** flip `is_current` on the old row. The per-date winner rule ranks versions by `generated_at`, so an old row could only win its dates again by having its timestamp rewritten — which would falsify the audit trail and make Schedule History lie about when work was planned.

Instead the chosen version is **copied** into a new current version: same dates, same snapshot, same assignments, `restored_from` pointing at the original. The copy wins its dates honestly because it genuinely is the newest generation. The original is untouched and stays in the list, as does the schedule the restore displaced. A `version_restored` row lands in `fairness_events`.

Manual overrides made since the restored version was generated are **not** carried over — they live on their own versions, and the UI says so before confirming.

A restore also lifts any clear marker, since a restored schedule the captain cannot see would be pointless.

## Fairness is always the ordinary replay

`restore-rota` computes scores with `loadGlobalBase` + `globalScores` — the same two functions generation uses — and hands them to the RPC. There is no second formula in SQL.

Pricing a change before it is written needed one addition: `RotaPatch.liftCalendarClear`, which replays as if the marker were already gone. The alternative was to null the marker in the database, compute, and put it back — which loses the marker outright if the call fails in between. A restore also uses `RotaPatch.versions` to price the copy under a pending id, the same mechanism the past-watch import uses.

A clear sends no scores at all, because there is nothing left to score; the RPC empties `vessel_fairness` instead.

## Seams

- **Edge Function `restore-rota`** (11th canonical) — `{ action: 'clear_calendar' | 'restore_calendar' | 'restore_version', source_schedule_id? }`. Re-derives `vessel_id` from the JWT; requires an active subscription; refuses restoring the version that is already live.
- **RPC `apply_rota_restore(p_vessel, p_revision, p_plan)`** — service-role only, migration `20261124030000`. One transaction behind the same revision check `publish_rota` uses.
- **`vessels.calendar_cleared_at`**, **`schedules.restored_from`** — migration `20261124030000`.
- **`_shared/rota_data.ts`** — `RotaPatch.liftCalendarClear`; `loadGlobalBase` honours the later of the two markers.
- **Client** — `Settings/CalendarReset.tsx` (Account tab, beneath "Clear fairness history") and the "Make this the live schedule" action in `Dashboard/ScheduleHistory.tsx`. Both raise the "Fairness score has been updated" toast.

Invariants unchanged: RLS is the access gate, the schedule and fairness tables are written only by server functions through service-role, and generation stays deterministic.

Verification: `app/src/routes/Settings/CalendarReset.test.tsx` (clear is two-step and says nothing is deleted, cancelling changes nothing, restore needs no confirm, a server refusal is not reported as success).
