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
export interface ScheduleSettings {
  horizon_weeks: number
  include_weekends: boolean
  weekday_rotation_anchor: number
  weekend_rotation_anchor: number
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

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const wd = isoWeekday(date)
    const dayType: DayType = wd >= 6 ? 'weekend' : 'weekday'
    const isFriday = wd === 5
    if (dayType === 'weekend' && !input.settings.include_weekends) continue

    const alreadyAssigned = new Set<string>()
    for (const lane of activeLanes) {
      const pool = poolByLane.get(lane.id)!
      const led = ledgers[lane.id]
      const laneSel: Lane = { id: lane.id, kind: lane.kind, department: lane.department, pool }
      const res = selectCandidate(laneSel, date, dayType, isFriday, led, alreadyAssigned)

      if (res.crew_id === null) {
        // §10 empty lane: emit a gap, record the reason, never crash.
        gaps.push({ lane_id: lane.id, watch_date: date })
        events.push({ lane_id: lane.id, crew_id: null, watch_date: date, reason_code: 'no_eligible_crew', detail: res.detail })
        continue
      }

      // schedule.md §4 — anchor applies ONLY to the first pick of a flat rotation
      // (default anchor 0 == the fairness id-fallback, so this is a no-op then).
      let crewId = res.crew_id
      let reason = res.reason_code
      const anchor = dayType === 'weekend' ? input.settings.weekend_rotation_anchor : input.settings.weekday_rotation_anchor
      if (anchor && rotationFlat(led, pool, dayType)) {
        const elig = res.detail.candidates.map((c) => c.crew_id).slice().sort()
        const pick = elig[anchor % elig.length]
        if (pick !== crewId) { crewId = pick; reason = 'anchor_start' }
      }

      assignments.push({ lane_id: lane.id, crew_id: crewId, watch_date: date, day_type: dayType, is_friday: isFriday })
      alreadyAssigned.add(crewId)
      updateLedger(laneSel, crewId, date, dayType, isFriday, led)
      events.push({ lane_id: lane.id, crew_id: crewId, watch_date: date, reason_code: reason, detail: res.detail })
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
