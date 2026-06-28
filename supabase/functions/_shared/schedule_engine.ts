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
  available_from: string // C2 — 'YYYY-MM-DD'; opportunities count only on/after this
}
export interface LaneRow {
  id: string
  kind: 'solo' | 'dept'
  department: string | null
  active: boolean
  departments?: string[] // C4 — the group's department SET (a lane may span 1+ depts). Defaults to [department] (groups-of-one).
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
// C4 — a dept lane pools crew from its department SET (a group of 1+ departments).
// groups-of-one (departments == [department]) reduce to the original single-dept
// filter exactly, so existing vessels are byte-identical. Pure pool-MEMBERSHIP — the
// post-C2 scoring is indifferent to whether the pool is one department or several.
function eligiblePool(lane: LaneRow, crew: Crew[]): string[] {
  const base = crew.filter((c) => c.eligible)
  if (lane.kind === 'solo') return base.map((c) => c.id).sort()
  const depts = lane.departments && lane.departments.length ? lane.departments : lane.department ? [lane.department] : []
  const set = new Set(depts)
  return base.filter((c) => c.department !== null && set.has(c.department)).map((c) => c.id).sort()
}

// A lane rotation is "completely flat" when no candidate has yet stood that
// rotation (schedule.md §4 — anchors apply only to the very first flat pick).
function rotationFlat(led: Ledger, pool: string[], dayType: DayType): boolean {
  const field = dayType === 'weekend' ? 'weekend_watches' : 'weekday_watches'
  return pool.every((id) => (led[id]?.[field] ?? 0) === 0)
}

// C2 — count one OPPORTUNITY of date `d`'s rotation for every crew member who was
// AVAILABLE on `d` (available_from <= d), creating the ledger entry if needed. The
// SAME helper is used by the current run AND by replay so seed/replay/run agree on
// "an opportunity available for" (the off-by-one guard). It increments for ALL
// available crew (not just the one assigned), which is exactly what keeps the
// denominator EQUAL across equal-availability crew → graceful degradation.
function bumpOpportunities(led: Ledger, poolIds: string[], isAvailable: (id: string, d: string) => boolean, d: string): void {
  const wd = isoWeekday(d)
  const weekend = wd >= 6
  const friday = wd === 5
  for (const id of poolIds) {
    if (!isAvailable(id, d)) continue // not joined yet (C2) OR on leave (C3) -> not an opportunity for them
    const e = led[id] ?? (led[id] = zeroEntry(id))
    if (weekend) e.weekend_opportunities += 1
    else { e.weekday_opportunities += 1; if (friday) e.friday_opportunities += 1 }
  }
}

// B7 — a charter window pauses the rotation. Inclusive [start, end] date range.
export interface CharterRange {
  start: string // 'YYYY-MM-DD'
  end: string
}

// C3 — a per-crew leave window. Inclusive [start, end]. Leave is Charter Mode
// scoped to ONE crew member: their leave dates are not opportunities and not
// candidacy for them (standing preserved); the watch goes to an available crew.
export interface LeaveRange {
  crew_id: string
  start: string
  end: string
}

// C3 — the single availability predicate combining C2's available_from with C3's
// leave: a crew member is available on date `d` iff they have joined (available_from
// <= d) AND are not on booked leave covering `d`. Used IDENTICALLY by the run,
// replay, and (conceptually) seed, so the opportunity denominator and candidacy
// agree everywhere. With NO leave this reduces exactly to the C2 available_from
// check → C2 behaviour byte-identical (freeze-safe).
export function makeAvailability(crew: Crew[], leave: LeaveRange[]): (id: string, d: string) => boolean {
  const availMap = new Map(crew.map((c) => [c.id, c.available_from]))
  const leaveByCrew = new Map<string, LeaveRange[]>()
  for (const l of leave) { const arr = leaveByCrew.get(l.crew_id) ?? []; arr.push(l); leaveByCrew.set(l.crew_id, arr) }
  return (id: string, d: string) =>
    (availMap.get(id) ?? '') <= d && !(leaveByCrew.get(id) ?? []).some((l) => d >= l.start && d <= l.end)
}

export interface PlanInput {
  startDate: string
  settings: ScheduleSettings
  crew: Crew[]
  lanes: LaneRow[] // active + retired; only active are scheduled
  baseLedgers: Record<string, Ledger> // seeded / replayed-past base, per lane
  charters?: CharterRange[] // B7 — booked charter windows to skip (default none)
  leave?: LeaveRange[] // C3 — booked per-crew leave (default none)
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
  const isAvailable = makeAvailability(input.crew, input.leave ?? []) // C2 available_from + C3 leave

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
  // B7 — charter pause: a date inside any booked charter window is skipped entirely.
  // No selection, no assignment, no updateLedger -> NO burden accrues, so the
  // unchanged fairness selector resumes from the correct next-due crew after the
  // charter (resume-from-correct-crew EMERGES from the untouched ledger). Folding
  // it into isScheduled also makes B6 weekend-blocks exclude charter days (a charter
  // cutting a block leaves the non-charter side as B6's partial-block path).
  const charters = input.charters ?? []
  const inCharter = (d: string) => charters.some((c) => d >= c.start && d <= c.end)
  const isScheduled = (d: string) =>
    d >= start && d <= end && !(dayTypeOf(d) === 'weekend' && !input.settings.include_weekends) && !inCharter(d)
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
    if (inCharter(date)) continue // B7 — paused: pure skip (no select/assign/ledger/event/gap)
    const leadIsFriday = isoWeekday(date) === 5

    for (const lane of activeLanes) {
      if (covered.has(`${lane.id}:${date}`)) continue // assigned by an earlier block lead
      const pool = poolByLane.get(lane.id)!
      const led = ledgers[lane.id]

      const days = blockDaysFor(date)
      // C2/C3 — count an opportunity for every AVAILABLE crew on every scheduled
      // block day (available_from reached AND not on leave), BEFORE selection.
      for (const d of days) bumpOpportunities(led, pool, isAvailable, d)
      // Step-A — candidates must be available on EVERY day of the block (joined, and
      // not on leave) — so a leave that splits a block excludes that crew (the
      // non-leave remainder goes to someone else). Guarantees opp >= 1.
      const availPool = pool.filter((id) => days.every((d) => isAvailable(id, d)))
      const laneSel: Lane = { id: lane.id, kind: lane.kind, department: lane.department, pool: availPool }

      // candidate must be free on every day of the block
      const blockBusy = new Set<string>()
      for (const d of days) for (const id of assignedOn(d)) blockBusy.add(id)

      // ONE selection at the lead day — unchanged seam; selectionCost is now cost÷opp.
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
      if (anchor && rotationFlat(led, availPool, leadType)) {
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
// C2 — `poolByLane` + `availMap` let replay also tally OPPORTUNITIES for the
// replayed history (every prior assignment date is one opportunity for every crew
// available then), using the SAME bumpOpportunities helper as the run so the
// denominator is consistent across seed + replay + run. Omitting them (legacy
// callers) replays counts only.
export function replayLedgers(
  activeLaneIds: string[],
  priorAssignments: PlannedAssignment[],
  seed: Record<string, Ledger> = {},
  poolByLane: Map<string, string[]> = new Map(),
  isAvailable: (id: string, d: string) => boolean = () => true,
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
    // opportunity for every available crew on this historical date (one assignment
    // per lane per date == one opportunity), then the watch for the one who stood.
    bumpOpportunities(ledgers[a.lane_id], poolByLane.get(a.lane_id) ?? [], isAvailable, a.watch_date)
    const laneSel: Lane = { id: a.lane_id, kind: 'solo', department: null, pool: [] }
    updateLedger(laneSel, a.crew_id, a.watch_date, a.day_type, a.is_friday, ledgers[a.lane_id])
  }
  return ledgers
}
