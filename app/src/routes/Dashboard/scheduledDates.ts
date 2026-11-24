import type { DashboardData } from './useDashboardData'

// The CURRENT schedule's rostered dates — what an export or a printed rota
// covers. Deliberately NOT the canonical union the calendar shows: a WhatsApp
// paste or a print-out is the rota in force, not the vessel's whole history.
// Include entirely unfilled dates, not only dates with successful assignments.
export function scheduledDates(data: DashboardData): string[] {
  const schedule = data.schedule
  const snapshot = schedule?.rota_snapshot as { scheduled_dates?: string[] } | null
  const own = snapshot?.scheduled_dates
    ?? data.assignments
      .filter((a) => !schedule || (a.watch_date >= schedule.start_date && a.watch_date <= schedule.end_date))
      .map((a) => a.watch_date)
  return [...new Set(own)]
    .filter(d => !data.charters.some(c => c.start_date <= d && d <= c.end_date)).sort()
}
