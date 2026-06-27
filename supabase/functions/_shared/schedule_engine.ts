// schedule_engine.ts — the generation orchestration (schedule.md). Wraps the
// proven Phase-6 fairness core in the chronological date loop and produces a
// PLAN (container + assignments + events + final ledgers + scores). It does NO
// DB I/O — generate-schedule loads inputs, calls planSchedule(), and persists.
// This keeps the loop deterministic and unit-testable in isolation.
import {
  selectCandidate, updateLedger, computeFairnessScore, zeroEntry,
  isoWeekday, addDays, type DayType, type Lane, type Ledger, type LedgerEntry,
} from './fairness_engine.ts'

export interface Crew {
  id: string
  department: string | null
  eligible: boolean
}
export interface LaneRow {
  id: string
  kind: 'solo' | 'dept'
  department: string | null
  active: boolean
}
// B6 — weekend coverage shape. per_day = one person per day (default; today's
// behaviour). sat_sun_block = one person covers Sat+Sun. fri_sat_sun_block = one
// person covers Fri+Sat+Sun. This is a SCHEDULING-STRUCTURE choice only; the
// fairness scoring (fairness_engine + fairness_constants) is unchanged — block
// modes count weekend/Friday watches PER COVERED DAY via the same updateLedger.
export type WeekendStructure = 'per_day' | 'sat_sun_block' | 'fri_sat_sun_block'

export interface ScheduleSettings {
  horizon_weeks: number
  include_weekends: boolean
  weekday_rotation_anchor: number
  weekend_rotation_anchor: number
  weekend_structure?: WeekendStructure // default 'per_day'
}

export interface PlannedAssignment {
  lane_id: string
  crew_id: string
  watch_date: string
  day_type: DayType
  is_friday: boolean
}
export interface PlannedEvent {
  lane_id: string
  crew_id: string | null // null only for no_eligible_crew gaps
  watch_date: string
  reason_code: string
  detail: unknown
}
export interface LaneScore {
  lane_id: string
  members: { crew_id: string; fairness_score: number }[]
}
export interface GenPlan {
  start_date: string
  end_date: string
  horizon_weeks: number
  assignments: PlannedAssignment[]
  events: PlannedEvent[]
  ledgers: Record<string, Ledger> // final per-lane state (base + this run)
  scores: LaneScore[]
  gaps: { lane_id: string; watch_date: string }[]
}

const clampHorizon = (w: number) => Math.max(1, Math.min(13, Math.trunc(w)))

// schedule.md §6 — eligible pool for a lane (ineligible crew excluded here).
function eligiblePool(lane: LaneRow, crew: Crew[]): string[] {
  const base = crew.filter((c) => c.eligible)
  const inLane = lane.kind === 'solo' ? base : base.filter((c) => c.department === lane.department)
  return inLane.map((c) => c.id).sort() // stable order
}

// A lane rotation is "completely flat" when no candidate has yet stood that
// rotation (schedule.md §4 — anchors apply only to the very first flat pick).
function rotationFlat(led: Ledger, pool: string[], dayType: DayType): boolean {
  const field = dayType === 'weekend' ? 'weekend_watches' : 'weekday_watches'
  return pool.every((id) => (led[id]?.[field] ?? 0) === 0)
}

export interface PlanInput {
  startDate: string
  settings: ScheduleSettings
  crew: Crew[]
  lanes: LaneRow[] // active + retired; only active are scheduled
  baseLedgers: Record<string, Ledger> // seeded / replayed-past base, per lane
}

// The generation loop (schedule.md §5). Chronological ascending — load-bearing
// for the Monday-after-weekend exclusion and the consecutive-run penalty.
export function planSchedule(input: PlanInput): GenPlan {
  const horizon = clampHorizon(input.settings.horizon_weeks)
  const start = input.startDate
  const end = addDays(start, horizon * 7 - 1)
  const activeLanes = input.lanes.filter((l) => l.active)

  const poolByLane = new Map<string, string[]>()
  for (const lane of activeLanes) poolByLane.set(lane.id, eligiblePool(lane, input.crew))

  // Clone the base ledgers so the function stays pure (no input mutation).
  const ledgers: Record<string, Ledger> = {}
  for (const lane of activeLanes) {
    ledgers[lane.id] = {}
    const base = input.baseLedgers[lane.id] ?? {}
    for (const [id, e] of Object.entries(base)) ledgers[lane.id][id] = { ...e }
  }

  const assignments: PlannedAssignment[] = []
  const events: PlannedEvent[] = []
  const gaps: { lane_id: string; watch_date: string }[] = []

  // B6 — weekend structure. A "block" is decided by ONE selection at its first
  // chronological day (the lead), then the chosen crew is assigned across every
  // day of the block, with updateLedger called PER COVERED DAY (per-day counting).
  // per_day reduces to a single-day block == the original loop exactly (regression).
  const structure: WeekendStructure = input.settings.weekend_structure ?? 'per_day'
  const dayTypeOf = (d: string): DayType => (isoWeekday(d) >= 6 ? 'weekend' : 'weekday')
  const isScheduled = (d: string) => d >= start && d <= end && !(dayTypeOf(d) === 'weekend' && !input.settings.include_weekends)
  // Days covered by the lead at `date` (only in-range, scheduled days):
  //   fri_sat_sun_block: Friday leads {Fri,Sat,Sun} (Friday-spread driven)
  //   sat_sun_block:     Saturday leads {Sat,Sun}
  // Degenerate boundary cases (a weekend day reached with its lead out of range, or
  // weekends disabled) collapse to the in-range days only — never crash.
  const blockDaysFor = (date: string): string[] => {
    const wd = isoWeekday(date)
    if (structure === 'fri_sat_sun_block' && wd === 5) return [date, addDays(date, 1), addDays(date, 2)].filter(isScheduled)
    if (structure === 'fri_sat_sun_block' && wd === 6) return [date, addDays(date, 1)].filter(isScheduled)
    if (structure === 'sat_sun_block' && wd === 6) return [date, addDays(date, 1)].filter(isScheduled)
    return [date]
  }

  // Crew assigned on a date (across lanes + earlier block leads). A block candidate
  // must be free on ALL its days. For per_day this is exactly the original per-date set.
  const assignedByDate = new Map<string, Set<string>>()
  const assignedOn = (d: string): Set<string> => { let s = assignedByDate.get(d); if (!s) { s = new Set(); assignedByDate.set(d, s) } return s }
  const covered = new Set<string>() // `${lane_id}:${date}` already handled by a block lead

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const leadType = dayTypeOf(date)
    if (leadType === 'weekend' && !input.settings.include_weekends) continue
    const leadIsFriday = isoWeekday(date) === 5

    for (const lane of activeLanes) {
      if (covered.has(`${lane.id}:${date}`)) continue // assigned by an earlier block lead
      const pool = poolByLane.get(lane.id)!
      const led = ledgers[lane.id]
      const laneSel: Lane = { id: lane.id, kind: lane.kind, department: lane.department, pool }

      const days = blockDaysFor(date)
      // candidate must be free on every day of the block
      const blockBusy = new Set<string>()
      for (const d of days) for (const id of assignedOn(d)) blockBusy.add(id)

      // ONE selection at the lead day — unchanged selectCandidate / unchanged scoring.
      const res = selectCandidate(laneSel, date, leadType, leadIsFriday, led, blockBusy)
      if (res.crew_id === null) {
        for (const d of days) {
          gaps.push({ lane_id: lane.id, watch_date: d })
          events.push({ lane_id: lane.id, crew_id: null, watch_date: d, reason_code: 'no_eligible_crew', detail: res.detail })
          covered.add(`${lane.id}:${d}`)
        }
        continue
      }

      // schedule.md §4 — anchor applies ONLY to the lead pick of a flat rotation
      // (default anchor 0 == the fairness id-fallback, so this is a no-op then).
      let crewId = res.crew_id
      let reason = res.reason_code
      const anchor = leadType === 'weekend' ? input.settings.weekend_rotation_anchor : input.settings.weekday_rotation_anchor
      if (anchor && rotationFlat(led, pool, leadType)) {
        const elig = res.detail.candidates.map((c) => c.crew_id).slice().sort()
        const pick = elig[anchor % elig.length]
        if (pick !== crewId) { crewId = pick; reason = 'anchor_start' }
      }

      // Assign across the block; count PER COVERED DAY — updateLedger once per day
      // with that day's own day-type/Friday flag, so weekend_watches/friday_watches
      // keep meaning "days stood" (the frozen formula is unchanged).
      for (const d of days) {
        const dType = dayTypeOf(d)
        const dIsFriday = isoWeekday(d) === 5
        assignments.push({ lane_id: lane.id, crew_id: crewId, watch_date: d, day_type: dType, is_friday: dIsFriday })
        assignedOn(d).add(crewId)
        updateLedger(laneSel, crewId, d, dType, dIsFriday, led)
        events.push({ lane_id: lane.id, crew_id: crewId, watch_date: d, reason_code: reason, detail: res.detail })
        covered.add(`${lane.id}:${d}`)
      }
    }
  }

  // Per-lane fairness scores over the CURRENT eligible pool (§5).
  const scores: LaneScore[] = activeLanes.map((lane) => {
    const pool = poolByLane.get(lane.id)!
    const led = ledgers[lane.id]
    const entries: LedgerEntry[] = pool.map((id) => led[id] ?? zeroEntry(id))
    const computed = computeFairnessScore(entries)
    return { lane_id: lane.id, members: computed.map((s) => ({ crew_id: s.crew_id, fairness_score: s.score })) }
  })

  return { start_date: start, end_date: end, horizon_weeks: horizon, assignments, events, ledgers, scores, gaps }
}

// Replay prior already-stood assignments (watch_date < from_date) onto a base
// ledger so regeneration is fairness-aware without double-counting the replaced
// future (schedule.md §7). For first generation there are none, so base = empty.
// (Phase 8 seeding will pre-fill the base before this replay.)
export function replayLedgers(
  activeLaneIds: string[],
  priorAssignments: PlannedAssignment[],
  seed: Record<string, Ledger> = {},
): Record<string, Ledger> {
  const ledgers: Record<string, Ledger> = {}
  for (const laneId of activeLaneIds) {
    ledgers[laneId] = {}
    const s = seed[laneId] ?? {}
    for (const [id, e] of Object.entries(s)) ledgers[laneId][id] = { ...e }
  }
  const sorted = [...priorAssignments].sort((a, b) => (a.watch_date < b.watch_date ? -1 : a.watch_date > b.watch_date ? 1 : 0))
  for (const a of sorted) {
    if (!ledgers[a.lane_id]) continue // lane no longer active
    const laneSel: Lane = { id: a.lane_id, kind: 'solo', department: null, pool: [] }
    updateLedger(laneSel, a.crew_id, a.watch_date, a.day_type, a.is_friday, ledgers[a.lane_id])
  }
  return ledgers
}
