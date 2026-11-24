import { describe, expect, it } from 'vitest'
import { resolveRota, scheduleOwner, type RotaRow, type RotaVersion } from './canonicalRota'

const version = (id: string, start: string, end: string, generated: string, lanes = [{ id: 'lane-1', position: 1 }], dates?: string[]): RotaVersion => ({
  id, start_date: start, end_date: end, generated_at: generated,
  rota_snapshot: { lanes, scheduled_dates: dates ?? days(start, end) },
})

function days(start: string, end: string) {
  const out: string[] = []
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const row = (schedule: string, date: string, crew: string, lane = 'lane-1'): RotaRow => ({
  schedule_id: schedule, lane_id: lane, crew_id: crew, watch_date: date,
  day_type: 'weekday', is_friday: false,
})

const LANES = [{ id: 'lane-1', position: 1 }]
const crewOn = (r: ReturnType<typeof resolveRota>, date: string) =>
  r.assignments.find((a) => a.watch_date === date)?.crew_id ?? null

describe('scheduleOwner — the server winner rule', () => {
  it('gives a past date to the version that actually covered it', () => {
    const owner = scheduleOwner([version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'), version('dec', '2026-12-01', '2026-12-31', '2026-11-24T10:00:00Z')])
    expect(owner('2026-11-15')).toBe('nov')
    expect(owner('2026-12-05')).toBe('dec')
  })

  it('lets the newest generation win a date both cover', () => {
    const owner = scheduleOwner([version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'), version('new', '2026-11-24', '2026-12-31', '2026-11-24T10:00:00Z')])
    expect(owner('2026-11-23')).toBe('nov')
    expect(owner('2026-11-26')).toBe('new')
  })

  it('keeps the documented shrunken-window rule: the superseded future is owned by nobody', () => {
    const owner = scheduleOwner([version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'), version('short', '2026-11-24', '2026-11-28', '2026-11-24T10:00:00Z')])
    expect(owner('2026-11-29')).toBeNull()
    expect(owner('2026-11-20')).toBe('nov')
  })

  it('breaks a same-timestamp tie on id, like the server', () => {
    const owner = scheduleOwner([version('a', '2026-11-01', '2026-11-30', '2026-11-01T00:00:00Z'), version('b', '2026-11-01', '2026-11-30', '2026-11-01T00:00:00Z')])
    expect(owner('2026-11-10')).toBe('b')
  })
})

describe('resolveRota — history survives regeneration', () => {
  it('keeps the whole of November when December is generated', () => {
    const versions = [version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'), version('dec', '2026-12-01', '2026-12-31', '2026-11-24T10:00:00Z')]
    const rows = [row('nov', '2026-11-03', 'ana'), row('nov', '2026-11-20', 'ben'), row('dec', '2026-12-02', 'cal')]
    const resolved = resolveRota({ versions, rows, lanes: LANES })
    expect(crewOn(resolved, '2026-11-03')).toBe('ana')
    expect(crewOn(resolved, '2026-11-20')).toBe('ben')
    expect(crewOn(resolved, '2026-12-02')).toBe('cal')
  })

  // The reported bug: generating from today used to blank every earlier day,
  // because the dashboard read only the current schedule's assignments.
  it('keeps 1-23 Nov when regenerating from today, 24 Nov', () => {
    const versions = [version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'), version('from-today', '2026-11-24', '2026-12-31', '2026-11-24T09:00:00Z')]
    const rows = [
      row('nov', '2026-11-10', 'ana'), row('nov', '2026-11-23', 'ben'),
      row('nov', '2026-11-26', 'stale'), row('from-today', '2026-11-26', 'cal'),
    ]
    const resolved = resolveRota({ versions, rows, lanes: LANES })
    expect(crewOn(resolved, '2026-11-10')).toBe('ana')
    expect(crewOn(resolved, '2026-11-23')).toBe('ben')
    // regenerated days change; the superseded row for the same day is dropped
    expect(crewOn(resolved, '2026-11-26')).toBe('cal')
  })

  it('keeps several months of history, not just the one covering today', () => {
    const versions = [
      version('sep', '2026-09-01', '2026-09-30', '2026-08-28T10:00:00Z'),
      version('oct', '2026-10-01', '2026-10-31', '2026-09-28T10:00:00Z'),
      version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'),
    ]
    const rows = [row('sep', '2026-09-09', 'ana'), row('oct', '2026-10-09', 'ben'), row('nov', '2026-11-09', 'cal')]
    const resolved = resolveRota({ versions, rows, lanes: LANES })
    expect(crewOn(resolved, '2026-09-09')).toBe('ana')
    expect(crewOn(resolved, '2026-10-09')).toBe('ben')
    expect(crewOn(resolved, '2026-11-09')).toBe('cal')
  })

  it('maps history off a retired lane id onto the lane holding that position', () => {
    const versions = [
      version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z', [{ id: 'retired-lane', position: 1 }]),
      version('dec', '2026-12-01', '2026-12-31', '2026-11-24T10:00:00Z', [{ id: 'fresh-lane', position: 1 }]),
    ]
    const rows = [row('nov', '2026-11-12', 'ana', 'retired-lane'), row('dec', '2026-12-02', 'ben', 'fresh-lane')]
    const resolved = resolveRota({ versions, rows, lanes: [{ id: 'fresh-lane', position: 1 }] })
    expect(crewOn(resolved, '2026-11-12')).toBe('ana')
    expect(resolved.assignments.find((a) => a.watch_date === '2026-11-12')?.lane_id).toBe('fresh-lane')
  })

  it('drops history whose lane position no longer exists rather than misfiling it', () => {
    const versions = [
      version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z', [{ id: 'lane-3', position: 3 }]),
      version('dec', '2026-12-01', '2026-12-31', '2026-11-24T10:00:00Z', [{ id: 'lane-1', position: 1 }]),
    ]
    const rows = [row('nov', '2026-11-12', 'ana', 'lane-3')]
    expect(resolveRota({ versions, rows, lanes: LANES }).assignments).toHaveLength(0)
  })

  it('never puts two watchkeepers on one lane-day', () => {
    const versions = [
      version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z', [{ id: 'retired-lane', position: 1 }]),
    ]
    const rows = [row('nov', '2026-11-12', 'mapped', 'retired-lane'), row('nov', '2026-11-12', 'exact', 'lane-1')]
    const resolved = resolveRota({ versions, rows, lanes: LANES })
    expect(resolved.assignments).toHaveLength(1)
    // the row that matched its lane id outright wins
    expect(crewOn(resolved, '2026-11-12')).toBe('exact')
  })

  it('reports scheduled dates per owning version, so gaps render on history too', () => {
    const versions = [version('nov', '2026-11-01', '2026-11-03', '2026-10-28T10:00:00Z', LANES, ['2026-11-01', '2026-11-02', '2026-11-03'])]
    const rows = [row('nov', '2026-11-01', 'ana')]
    const resolved = resolveRota({ versions, rows, lanes: LANES })
    expect(resolved.scheduledDates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })

  it('excludes a superseded version\'s dates from the scheduled set', () => {
    const versions = [
      version('nov', '2026-11-01', '2026-11-30', '2026-10-28T10:00:00Z'),
      version('short', '2026-11-24', '2026-11-28', '2026-11-24T10:00:00Z'),
    ]
    const resolved = resolveRota({ versions, rows: [], lanes: LANES })
    expect(resolved.scheduledDates).toContain('2026-11-23')
    expect(resolved.scheduledDates).toContain('2026-11-28')
    expect(resolved.scheduledDates).not.toContain('2026-11-29')
  })

  it('falls back to a legacy snapshot\'s own assignments for its scheduled days', () => {
    const versions = [{ id: 'v1', start_date: '2026-11-01', end_date: '2026-11-30', generated_at: '2026-10-28T10:00:00Z', rota_snapshot: null }]
    const rows = [row('v1', '2026-11-05', 'ana')]
    const resolved = resolveRota({ versions, rows, lanes: LANES })
    // no snapshot lanes, so the lane id must match the live rota to place
    expect(resolved.scheduledDates).toEqual(['2026-11-05'])
    expect(crewOn(resolved, '2026-11-05')).toBe('ana')
  })
})
