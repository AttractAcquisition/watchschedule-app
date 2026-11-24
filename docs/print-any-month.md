# Printing any month, and one honest print action — approved 24 November 2026

## Any month, not just the last one generated

The print-out was scoped to the current schedule's own range, so the only month that could go on paper was the one just generated. The calendar already shows the canonical rota across every generation; the print-out now follows it.

**Print → choose a month → the browser's print dialog.** The months offered are exactly those holding a rota, newest first, defaulting to the current month when it has one.

The days printed come from `useDashboardData` — the same canonical resolution, honouring the per-date winner rule and the calendar-clear marker. Printing **re-derives nothing**: if it resolved versions itself the paper and the screen could disagree, which is the failure the display seam exists to prevent.

`periodDates` takes the union of the rostered days and the days carrying a watch. A day with a watch but no entry in `scheduled_dates` would otherwise be dropped — exactly what an imported historical day looks like against a legacy snapshot that stored no scheduled-date list.

An empty month prints a header and "No watches were rostered in this period" rather than a bare page.

Exports (WhatsApp) still cover the current schedule: a paste to the crew is the rota in force, not an archive lookup.

## One print action, not two

"Download PDF" and "Print" both called `window.print()`. They were the same button twice, which is why it read as broken — "it only lets me download a PDF".

They are now one action: **Print or save as PDF…**.

**A web page cannot send a job straight to a printer.** `window.print()` is the only printing API available to it, and it always opens the browser's own dialog; browsers block silent printing deliberately. Printer-or-PDF is chosen *there*, and when the dialog offers only "Save as PDF" it is because the machine has no printer configured. The dialog now says so, so the limit reads as the browser's rather than the product's.

Unattended printing — a rota that prints itself to the bridge printer each week — is possible only outside the browser and is not in scope here.

## Seams

- **`_shared`-free and pure:** `printPeriod.ts` — `monthBounds`, `periodDates`, `monthsWithRota`, `defaultPrintMonth`.
- **`PrintScheduleDialog.tsx`** — the month picker; replaces `ScheduleExportButtons.tsx`, now deleted.
- **`PrintDocuments.tsx`** — `SchedulePrintDoc` takes an optional `period`; without one it prints the current schedule exactly as before.
- **`Dashboard.tsx`** — holds the chosen period and clears it on `afterprint`.

Verification: `printPeriod.test.ts` (month bounds incl. leap years, range filtering, a watch-only day, dedupe, empty months, month listing, default month) and `PrintScheduleDialog.test.tsx` (months offered newest-first, the chosen month is what prints, day count, disabled with no rota, cancel prints nothing, the browser-dialog notice).
