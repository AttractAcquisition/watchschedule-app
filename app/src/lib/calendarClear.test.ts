// The clear marker must be honoured by the CALENDAR, not only by the engine's
// replay. Shipping it server-side alone emptied the fairness panel while every
// watch stayed on screen — docs/calendar-restore.md.
import { describe, expect, it } from 'vitest'
import { resolveRota, type RotaVersion, type RotaRow } from './canonicalRota'

const version = (id: string, start: string, end: string, generated: string): RotaVersion => ({
  id, start_date: start, end_date: end, generated_at: generated,
  rota_snapshot: { lanes: [{ id: 'lane-1', position: 1 }], scheduled_dates: [start, end] },
})
const row = (schedule: string, date: string, crew: string): RotaRow => ({
  schedule_id: schedule, lane_id: 'lane-1', crew_id: crew, watch_date: date, day_type: 'weekday', is_friday: false,
})
const LANES = [{ id: 'lane-1', position: 1 }]

/** The filter useDashboardData applies before resolving. */
const visible = (versions: RotaVersion[], clearedAt: string | null) =>
  versions.filter((v) => !clearedAt || v.generated_at > clearedAt)

describe('a cleared calendar', () => {
  const versions = [
    version('sep', '2026-09-01', '2026-09-30', '2026-08-28T10:00:00Z'),
    version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'),
  ]
  const rows = [row('sep', '2026-09-01', 'ana'), row('nov', '2026-11-01', 'ben')]

  it('shows every watch while no marker is set', () => {
    const r = resolveRota({ versions: visible(versions, null), rows, lanes: LANES })
    expect(r.assignments).toHaveLength(2)
    expect(r.scheduledDates.length).toBeGreaterThan(0)
  })

  it('hides every watch generated at or before the marker', () => {
    const r = resolveRota({ versions: visible(versions, '2026-11-24T12:00:00Z'), rows, lanes: LANES })
    expect(r.assignments).toHaveLength(0)
    expect(r.scheduledDates).toHaveLength(0)
  })

  it('keeps anything generated after the marker, so a fresh rota appears', () => {
    const after = [...versions, version('dec', '2026-12-01', '2026-12-31', '2026-11-24T18:00:00Z')]
    const r = resolveRota({
      versions: visible(after, '2026-11-24T12:00:00Z'),
      rows: [...rows, row('dec', '2026-12-01', 'cal')],
      lanes: LANES,
    })
    expect(r.assignments.map((a) => a.crew_id)).toEqual(['cal'])
  })

  it('puts everything back when the marker is lifted — nothing was deleted', () => {
    const r = resolveRota({ versions: visible(versions, null), rows, lanes: LANES })
    expect(r.assignments.map((a) => a.crew_id).sort()).toEqual(['ana', 'ben'])
  })
})
