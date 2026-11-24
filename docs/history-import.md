# Upload past watches — approved 24 November 2026

The captain records watches that were **actually stood**: typed in by hand, or uploaded as a CSV. They land on the calendar as ordinary watches and fairness recounts from them.

This is the 10th canonical Edge Function, `import-watch-history`. It is **not** a second past-schedule parser: `seed-fairness` still owns reading a photograph of a rota into `rota_seed`, untouched, and onboarding still uses it. The distinction is the destination — `seed-fairness` writes seed records that only fairness reads; this writes real `watch_assignments`, which the calendar renders and the captain can correct afterwards by clicking the cell.

## Where an imported watch goes

Two destinations, decided **per date** by the same per-date winner rule as the fairness replay (`versionOwner`):

| the date | destination |
|---|---|
| a generation already covers it | **amend that generation** — the same path a single-cell override takes |
| no generation covers it | a new `is_historical` schedule row |

**Why not one wide historical row.** A schedule row spans a *range*, and the winner rule gives a version every date in its range. A single row from the first imported record to the last would claim — and therefore blank — every generated day in between. Dates with no owner are grouped into **maximal contiguous runs** instead, one row each, so a range never reaches past the days it actually holds.

A historical row is a schedule version like any other for the winner rule; `is_historical` is for display and audit. Its snapshot carries `scheduled_dates` listing only the imported days, so the calendar draws no gap warning for the days between.

## Conflicts

**The import wins, silently.** If the CSV says Elisa stood 14 November and the generated rota says Greta, Elisa is recorded. This is a record of what happened, not a plan to be negotiated with; the generated assignment is replaced and fairness recomputes.

The same person is also cleared from any other lane that day, or the one-watch-a-day invariant would reject the whole import. That invariant is re-checked after writing, exactly as `publish_rota` checks a generated plan.

## Matching and parsing

All of it is server-side and pure (`_shared/history_import.ts`), so the browser holds no copy of the rules.

- **CSV** needs a header row with a `date` column and a `crew` column (`watch_date`, `crew_name`, `name`, `watchkeeper` and others are accepted). A BOM, CRLF, quoted fields, embedded commas and `""` escapes are all handled. A bad line is reported **by line number** and the rest still imports.
- **Dates** are read day-first: `05/11/2026` is 5 November. This is a European maritime product. The downloadable template uses ISO dates so the ambiguous case need not arise.
- **Names** resolve to exactly one crew member or to **nobody**. Two Gretas aboard means "Greta" matches neither: putting the wrong person on a watch corrupts fairness silently and invisibly, which is worse than reporting a miss. Unmatched names come back named, for the captain to fix.
- **Future dates are refused.** This imports what was stood; the generator owns what is still to come.
- **A later row wins the same crew-day**, so re-uploading a corrected file sticks rather than colliding. This is the merge behaviour: an import adds and overwrites, it never wipes what it does not mention.
- Manual entry sends `crew_id` directly and skips name matching entirely.
- At most 2000 watches per import.

## Crew who have left

The picker lists **everyone on the crew list, eligible or not**. A departed crew member still stood the watches they stood, and their assignments still belong on the record.

This rests on a property worth stating plainly: **hard-deleting a crew member destroys their watch history.** `watch_assignments.crew_id` cascades on delete (migration `20260922010000`), deliberately — it is the captain's two-step "remove this person and everything about them" action. Deletion is for mistakes. **A crew member who has left the vessel should be marked ineligible, not deleted.**

An ineligible member behaves correctly throughout: the generator never picks them (lane pools require `eligible`), they are excluded from the fairness ranking, but their watches still replay into the ledger as history. No schema change was needed to support this.

## Fairness

The recompute is the ordinary replay — `loadGlobalBase` over the amended rota, then `globalScores` — never a second formula. `RotaPatch` gained a `versions` hook for it: rows bound for a historical schedule row that does not exist yet would otherwise be dropped by the winner rule (no version owns their dates), and the whole import would score as nothing.

Imported days carry an opportunity only for the person recorded. An image or a CSV is evidence of who **stood** a watch, not of who **could have**; inventing a denominator nobody recorded would be a guess dressed as data. Imports are therefore flagged `history_estimated`.

On success the dashboard raises the same "Fairness score has been updated" toast as a manual override.

## Tiers

Open to **all tiers, Solo included** (captain's decision, 24 November 2026). `seed-fairness`'s image import keeps its existing Dual/Triple gate; correcting your own history is not a paid feature.

## Seams

- **Edge Function `import-watch-history`** — `{ csv | rows | records, preview? }`. With `preview: true` it reports what would change and writes nothing. Re-derives `vessel_id` from the JWT; requires an active subscription.
- **`_shared/history_import.ts`** — `parseHistoryCsv`, `splitCsvLine`, `toIsoDate`, `matchCrewName`, `resolveHistory`, `contiguousRuns`. Pure, no I/O. The crew matcher is shared with `seed-fairness`, so a name read off a photo and a name typed into a CSV resolve identically.
- **`_shared/rota_data.ts`** — `RotaPatch.versions`, for pricing a pending schedule row before it exists.
- **RPC `import_watch_history(p_vessel, p_revision, p_plan)`** — service-role only, migration `20261124020000`. Amends owning generations, creates historical rows, re-checks one-watch-a-day, logs a `history_import` fairness event, rewrites `vessel_fairness`, bumps `rota_revision` — one transaction behind the same revision check `publish_rota` uses.
- **`schedules.is_historical`** — migration `20261124020000`.
- **Client** — `ImportHistoryButton.tsx`, to the **left of Regenerate** on the dashboard.

Invariants unchanged: Supabase is the single source of truth, RLS is the access gate, the schedule and fairness tables are written only by server functions through service-role, secrets stay in Edge Functions, and generation stays deterministic — an import is an input to the next replay, never a source of randomness in it.

Verification: `_shared/history_import_test.ts` (quoted and escaped CSV fields, BOM and CRLF, flexible headers, per-line errors, day-first and invalid dates, ambiguous matching, future-date rejection, dedupe ordering, contiguous runs across a month boundary) and `app/src/routes/Dashboard/ImportHistoryButton.test.tsx` (departed crew listed, incomplete rows not sent, confirmation, unmatched names surfaced, server refusal not reported as success, CSV route), plus `npm test`, `npm run build` and `deno check`.
