// Which days a printed rota covers (docs/print-any-month.md).
//
// Printing used to be locked to the current schedule's own range, so the only
// month you could ever put on paper was the one just generated. The calendar
// shows the canonical rota across every generation; the print-out now follows
// it, so any month you can look at is a month you can print.
//
// Pure: it reads the dates the dashboard already resolved, and resolves nothing
// itself. The per-date winner rule, and the calendar-clear marker, are applied
// upstream in useDashboardData — printing must never re-derive them, or the
// paper and the screen could disagree.

export interface DatedRow { watch_date: string }

const inRange = (d: string, start: string, end: string) => d >= start && d <= end

/** First and last day of a `YYYY-MM` value, as ISO dates. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

/**
 * Every day to print for a period: the days a generation rostered, plus any day
 * carrying a watch. A day with a watch but no entry in `scheduledDates` would
 * otherwise be silently dropped — exactly what an imported historical day looks
 * like on a legacy snapshot that stored no scheduled-date list.
 */
export function periodDates(scheduledDates: string[], assignments: DatedRow[], start: string, end: string): string[] {
  const days = new Set<string>()
  for (const d of scheduledDates) if (inRange(d, start, end)) days.add(d)
  for (const a of assignments) if (inRange(a.watch_date, start, end)) days.add(a.watch_date)
  return [...days].sort()
}

/** The `YYYY-MM` months holding any rota at all, newest first. */
export function monthsWithRota(scheduledDates: string[], assignments: DatedRow[]): string[] {
  const months = new Set<string>()
  for (const d of scheduledDates) months.add(d.slice(0, 7))
  for (const a of assignments) months.add(a.watch_date.slice(0, 7))
  return [...months].sort().reverse()
}

/**
 * The month to offer first: the one being looked at if it holds any rota,
 * otherwise the most recent month that does. Never an empty sheet when the
 * vessel has something to print.
 */
export function defaultPrintMonth(months: string[], today: string): string {
  const current = today.slice(0, 7)
  if (months.includes(current)) return current
  return months[0] ?? current
}
