// Pure (no-deps) logic for the A2 Schedule History view — kept separate from
// ScheduleHistory.tsx so it's unit-testable in isolation.
export interface HistSchedule {
  id: string
  generated_at: string
  start_date: string
  end_date: string
  is_current: boolean
  horizon_weeks: number
}

// Derive a chronological version index (v1 = oldest generation) and return the
// list most-recent-first for display. The current schedule keeps its is_current flag.
export function deriveScheduleVersions(rows: HistSchedule[]): (HistSchedule & { version: number })[] {
  const byAge = [...rows].sort((a, b) => (a.generated_at < b.generated_at ? -1 : a.generated_at > b.generated_at ? 1 : 0))
  const versionById = new Map(byAge.map((r, i) => [r.id, i + 1]))
  return [...rows]
    .sort((a, b) => (a.generated_at > b.generated_at ? -1 : a.generated_at < b.generated_at ? 1 : 0))
    .map((r) => ({ ...r, version: versionById.get(r.id)! }))
}
