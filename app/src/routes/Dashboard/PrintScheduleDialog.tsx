// Choose which month to print (docs/print-any-month.md).
//
// Printing was locked to the current schedule's own range, so the only month
// you could put on paper was the one just generated. Any month the calendar can
// show is now printable, from the same canonical rota.
//
// There is one action, not two. "Download PDF" and "Print" both called
// window.print() and so did exactly the same thing — the browser's dialog is
// where printer-or-PDF is chosen, and a web page cannot bypass it or pick for
// you. Two buttons for one capability only made it look broken.
import { useMemo, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { DashboardData } from './useDashboardData'
import { defaultPrintMonth, monthBounds, monthsWithRota, periodDates } from './printPeriod'

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthLabel = (m: string) => format(parseISO(`${m}-01`), 'MMMM yyyy')

export function PrintScheduleDialog({ data, onPrint }: {
  data: DashboardData
  onPrint: (period: { start: string; end: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const months = useMemo(
    () => monthsWithRota(data.scheduledDates, data.assignments),
    [data.scheduledDates, data.assignments],
  )
  const [month, setMonth] = useState(() => defaultPrintMonth(months, todayISO()))

  const bounds = monthBounds(month)
  const dayCount = periodDates(data.scheduledDates, data.assignments, bounds.start, bounds.end).length

  function start() {
    setOpen(false)
    onPrint(bounds)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setMonth(defaultPrintMonth(months, todayISO())); setOpen(true) }}
        disabled={!months.length}
        title={months.length ? 'Choose a month, then print or save as PDF' : 'Nothing rostered to print yet'}
        className="flex min-h-[40px] w-full items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-50"
      >
        <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Print or save as PDF…
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="print-month-title">
          <div className="w-full max-w-sm rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
            <div className="flex items-start justify-between gap-ws-3">
              <div>
                <p className="ws-eyebrow">— Print</p>
                <h3 id="print-month-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Which month?</h3>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>

            <label htmlFor="print-month" className="mt-ws-4 block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Month</label>
            <select
              id="print-month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="mt-ws-2 w-full rounded-ws-sm border border-ws-line-strong bg-ws-navy-deep px-ws-3 py-ws-2 text-ws-sm text-ws-text"
            >
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>

            <p className="mt-ws-2 text-ws-xs text-ws-text-faint">
              {dayCount > 0
                ? `${dayCount} ${dayCount === 1 ? 'day' : 'days'} rostered — exactly what the calendar shows for that month.`
                : 'Nothing was rostered that month.'}
            </p>
            <p className="mt-ws-3 text-ws-xs text-ws-text-muted">
              Your browser opens its own print dialog next. Choose a printer there, or “Save as PDF”.
            </p>

            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={() => setOpen(false)} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text transition-all hover:bg-ws-steel-3">Cancel</button>
              <button type="button" onClick={start} disabled={!dayCount}
                className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
                <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
