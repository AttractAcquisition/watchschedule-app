// Canonical rota resolution for DISPLAY.
//
// The dashboard calendar must show the rota the crew actually worked, not just
// the newest generation. Regenerating December leaves November's watches in
// `watch_assignments` attached to the superseded `schedules` row — they are
// still history, they still count towards fairness, and the captain still needs
// to see them.
//
// This module decides, for each date, WHICH stored schedule version owns it. It
// computes no rota: every assignment it returns was written by a server
// function. It only resolves which already-stored version a date belongs to.
//
// SEAM — the winner rule here is the server's rule, verbatim:
//   supabase/functions/_shared/rota_v2.ts -> canonicalHistory()
// Keep the two byte-for-byte equivalent. If one changes, change both, or the
// calendar and the fairness scores will disagree about the same day.
//
//   "the newest generation that ACTUALLY COVERS the date"
//
// Narrowing a window re-plans only the days inside it (24 November 2026).
// Regenerate 5-15 Nov over a 1-30 Nov schedule and 16-30 Nov keep the older
// generation's plan: still rostered, still shown, still counted. They used to
// be dropped silently by a rule that stopped at the newest version starting on
// or before the date.

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export interface RotaVersion {
  id: string
  start_date: string
  end_date: string
  generated_at: string
  rota_snapshot?: unknown
}

export interface RotaRow {
  schedule_id: string
  lane_id: string
  crew_id: string
  watch_date: string
  day_type: 'weekday' | 'weekend'
  is_friday: boolean
  is_manual?: boolean
}

export interface RotaLaneRow {
  id: string
  position?: number
}

interface SnapshotLane { id: string; position: number }
interface Snapshot { lanes?: SnapshotLane[]; scheduled_dates?: string[] }

const snapshotOf = (v: RotaVersion): Snapshot => (v.rota_snapshot ?? {}) as Snapshot

/**
 * Which stored schedule version owns each date. Memoised per date, like the
 * server's. Returns null for a date no surviving version covers.
 */
export function scheduleOwner(versions: RotaVersion[]): (date: string) => string | null {
  const ordered = [...versions].sort((a, b) => cmp(b.generated_at, a.generated_at) || cmp(b.id, a.id))
  const cache = new Map<string, string | null>()
  return (date: string) => {
    if (!cache.has(date)) {
      const v = ordered.find((s) => s.start_date <= date && date <= s.end_date)
      cache.set(date, v ? v.id : null)
    }
    return cache.get(date)!
  }
}

/**
 * Place a historical assignment on one of the calendar's lane rows.
 *
 * `save_watch_configuration` mints a NEW lane uuid whenever a lane is added and
 * deactivates removed ones, so a schedule generated before a reconfiguration
 * references lane ids the current rota no longer has. Matching on id alone
 * silently dropped that history. Fall back to the lane POSITION recorded in the
 * owning version's own snapshot: the watchkeeper still lands in the right slot.
 */
function laneMapper(versions: RotaVersion[], lanes: RotaLaneRow[]) {
  const currentIds = new Set(lanes.map((l) => l.id))
  const byPosition = new Map<number, string>()
  lanes.forEach((l, i) => {
    const position = l.position ?? i + 1
    if (!byPosition.has(position)) byPosition.set(position, l.id)
  })
  // lane id -> the position it held in the schedule that wrote it
  const positionOf = new Map<string, number>()
  for (const v of versions) {
    for (const l of snapshotOf(v).lanes ?? []) {
      if (!positionOf.has(l.id)) positionOf.set(l.id, l.position)
    }
  }
  return (laneId: string): string | null => {
    if (currentIds.has(laneId)) return laneId
    const position = positionOf.get(laneId)
    if (position === undefined) return null
    return byPosition.get(position) ?? null
  }
}

export interface ResolvedRota {
  /** Canonical assignments across every surviving version, lane-mapped, sorted. */
  assignments: RotaRow[]
  /** Every date a surviving version scheduled — drives gap rendering. */
  scheduledDates: string[]
}

/**
 * Resolve the full stored rota for display: one winner per date, across all
 * generations, mapped onto the calendar's current lane rows.
 */
export function resolveRota(
  { versions, rows, lanes }: { versions: RotaVersion[]; rows: RotaRow[]; lanes: RotaLaneRow[] },
): ResolvedRota {
  const owner = scheduleOwner(versions)
  const mapLane = laneMapper(versions, lanes)

  const assignments: RotaRow[] = []
  // One watch per lane-day: the owning version decides, and a lane-mapped row
  // must never displace a row that matched its lane id outright.
  const taken = new Set<string>()
  const exact = rows.filter((r) => owner(r.watch_date) === r.schedule_id)
  for (const pass of [true, false]) {
    for (const r of exact) {
      const mapped = mapLane(r.lane_id)
      if (!mapped) continue
      if (pass !== (mapped === r.lane_id)) continue
      const key = `${mapped}:${r.watch_date}`
      if (taken.has(key)) continue
      taken.add(key)
      assignments.push(mapped === r.lane_id ? r : { ...r, lane_id: mapped })
    }
  }
  assignments.sort((a, b) => cmp(a.watch_date, b.watch_date) || cmp(a.lane_id, b.lane_id))

  const scheduled = new Set<string>()
  for (const v of versions) {
    const dates = snapshotOf(v).scheduled_dates
    // A legacy (engine v1) snapshot carries no scheduled_dates; its own
    // assignments are the only evidence of which days it rostered.
    for (const d of dates ?? rows.filter((r) => r.schedule_id === v.id).map((r) => r.watch_date)) {
      if (owner(d) === v.id) scheduled.add(d)
    }
  }
  return { assignments, scheduledDates: [...scheduled].sort() }
}
