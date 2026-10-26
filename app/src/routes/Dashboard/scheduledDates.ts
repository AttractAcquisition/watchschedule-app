import type { DashboardData } from './useDashboardData'

// Include entirely unfilled dates, not only dates with successful assignments.
export function scheduledDates(data: DashboardData): string[] {
  const snapshot = data.schedule?.rota_snapshot as { scheduled_dates?: string[] } | null
  return [...new Set(snapshot?.scheduled_dates ?? data.assignments.map(a => a.watch_date))]
    .filter(d => !data.charters.some(c => c.start_date <= d && d <= c.end_date)).sort()
}
