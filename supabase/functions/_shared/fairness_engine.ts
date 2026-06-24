// fairness_engine.ts — the deterministic fairness core (fairness.md §1–§8).
// Pure, framework-free, NO randomness: every tie is broken by the §7 ordered
// rules, final fallback ascending crew_id. This is the math only — date-looping,
// the schedule container, and DB persistence are Phase 7 (schedule.md).
//
// The critical cross-document seam (fairness.md §4/§11 = schedule.md §5/§11):
//   selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned)
//     -> { crew_id, reason_code, detail }
//   updateLedger(lane, crew_id, date, dayType, isFriday, ledger)   // §4 Step D
import {
  W_WEEKDAY, W_FRIDAY, W_WEEKEND, W_CONSEC, W_FRIDAY_SELECT, RECENCY_NUDGE,
  K, EPSILON, SCORE_HIGH, SCORE_MID,
} from './fairness_constants.ts'

export type DayType = 'weekday' | 'weekend'

// One fairness_ledger row (per lane, per crew) — backend.md §2.
export interface LedgerEntry {
  crew_id: string
  total_watches: number
  weekday_watches: number
  weekend_watches: number
  friday_watches: number
  last_watch_date: string | null // 'YYYY-MM-DD'
  last_weekend_date: string | null
  consecutive_run: number
}

// A lane carries its candidate pool (the eligible, department-filtered, ACTIVE-lane
// crew built by schedule.md). selectCandidate then applies the §4 hard constraints.
export interface Lane {
  id: string
  kind: 'solo' | 'dept'
  department: string | null
  pool: string[] // candidate crew_ids
}

export type Ledger = Record<string, LedgerEntry>

export interface CandidateCost {
  crew_id: string
  cost: number
}
export interface SelectionDetail {
  date: string
  day_type: DayType
  is_friday: boolean
  candidates: CandidateCost[] // costs considered (the non-relaxed criterion), sorted ascending
  excluded: { crew_id: string; reason: string }[]
  relaxed: boolean
  tie_break?: string // which §7 rule decided, if a tie occurred
  winner: string | null
}
export interface SelectionResult {
  crew_id: string | null
  reason_code: string
  detail: SelectionDetail
}

// ---- date helpers (deterministic; UTC) -------------------------------------
// Exported for the schedule engine (Phase 7), which shares this day-math.
export function isoWeekday(date: string): number {
  // 1 = Monday … 7 = Sunday (schedule.md §8)
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat
  return wd === 0 ? 7 : wd
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function zeroEntry(crew_id: string): LedgerEntry {
  return {
    crew_id, total_watches: 0, weekday_watches: 0, weekend_watches: 0, friday_watches: 0,
    last_watch_date: null, last_weekend_date: null, consecutive_run: 0,
  }
}
const entryOf = (ledger: Ledger, id: string): LedgerEntry => ledger[id] ?? zeroEntry(id)

// ---- burden + selection cost (fairness.md §3, §4 Step B) -------------------

// Lifetime weighted burden (fairness.md §3) — used by the score (§5).
export function burden(e: LedgerEntry): number {
  return (e.weekday_watches - e.friday_watches) * W_WEEKDAY
    + e.friday_watches * W_FRIDAY
    + e.weekend_watches * W_WEEKEND
}

// Selection cost for THIS decision (fairness.md §4 Step B). Day-type dependent so
// the two rotations stay independent: weekday decisions read weekday/Friday counts;
// weekend decisions read weekend counts only.
export function selectionCost(e: LedgerEntry, date: string, dayType: DayType, isFriday: boolean): number {
  const consec = e.consecutive_run * W_CONSEC
  const recency = e.last_watch_date !== null && e.last_watch_date === addDays(date, -1) ? RECENCY_NUDGE : 0
  if (dayType === 'weekend') {
    return e.weekend_watches * W_WEEKEND + consec + recency
  }
  const baseWeekday = (e.weekday_watches - e.friday_watches) * W_WEEKDAY + e.friday_watches * W_FRIDAY
  const fridayTerm = isFriday ? e.friday_watches * W_FRIDAY_SELECT : 0
  return baseWeekday + fridayTerm + consec + recency
}

// ---- tie-breaking (fairness.md §7) -----------------------------------------
// Given a tied set (same lowest cost), resolve in the exact §7 order. Returns the
// winner and which rule decided (or 'cost' when the set was already a singleton).
const COST_EPS = 1e-9
type TieRule = 'cost' | 'total' | 'scarce_slot' | 'last_watch' | 'consecutive' | 'id'

function breakTie(ids: string[], dayType: DayType, isFriday: boolean, ledger: Ledger): { winner: string; rule: TieRule } {
  if (ids.length === 1) return { winner: ids[0], rule: 'cost' }
  // ordered numeric criteria; null last_watch_date = "never watched" = earliest.
  const lastWatchRank = (e: LedgerEntry) => (e.last_watch_date === null ? -Infinity : Date.parse(`${e.last_watch_date}T00:00:00Z`))
  const criteria: { rule: Exclude<TieRule, 'cost' | 'id'>; value: (e: LedgerEntry) => number; active: boolean }[] = [
    { rule: 'total', value: (e) => e.total_watches, active: true },
    { rule: 'scarce_slot', value: (e) => (dayType === 'weekend' ? e.weekend_watches : e.friday_watches), active: dayType === 'weekend' || isFriday },
    { rule: 'last_watch', value: lastWatchRank, active: true },
    { rule: 'consecutive', value: (e) => e.consecutive_run, active: true },
  ]
  let pool = [...ids]
  for (const c of criteria) {
    if (!c.active) continue
    const min = Math.min(...pool.map((id) => c.value(entryOf(ledger, id))))
    const kept = pool.filter((id) => c.value(entryOf(ledger, id)) === min)
    if (kept.length === 1) return { winner: kept[0], rule: c.rule }
    pool = kept
  }
  // final deterministic fallback: ascending crew_id
  pool.sort()
  return { winner: pool[0], rule: 'id' }
}

function dayTypeReason(dayType: DayType, isFriday: boolean): string {
  if (dayType === 'weekend') return 'weekend_balance'
  if (isFriday) return 'friday_spread'
  return 'lowest_cost'
}

// ---- the heart: selectCandidate (fairness.md §4) ---------------------------
export function selectCandidate(
  lane: Lane,
  date: string,
  dayType: DayType,
  isFriday: boolean,
  ledger: Ledger,
  alreadyAssigned: Set<string>,
): SelectionResult {
  const baseDetail = (extra: Partial<SelectionDetail>): SelectionDetail => ({
    date, day_type: dayType, is_friday: isFriday, candidates: [], excluded: [], relaxed: false, winner: null, ...extra,
  })

  // Step A — same-day guard, then the lane pool.
  const avail = lane.pool.filter((id) => !alreadyAssigned.has(id))
  if (avail.length === 0) {
    return { crew_id: null, reason_code: 'no_eligible_crew', detail: baseDetail({}) }
  }

  // Step A — Monday-after-weekend hard exclusion (fairness.md §4 A.1).
  const excluded: { crew_id: string; reason: string }[] = []
  let eligible = avail
  if (isoWeekday(date) === 1) {
    const prevSun = addDays(date, -1)
    const prevSat = addDays(date, -2)
    eligible = []
    for (const id of avail) {
      const e = entryOf(ledger, id)
      if (e.last_weekend_date === prevSun || e.last_weekend_date === prevSat) {
        excluded.push({ crew_id: id, reason: 'monday_exclusion_applied' })
      } else {
        eligible.push(id)
      }
    }
  }

  // §8 relaxation — if the Monday exclusion emptied the set, relax it: choose among
  // the previously-excluded the one with the LOWEST weekend burden (least-bad), and
  // flag it. (The optional rest rule is a hook; not enabled in v1, so nothing to
  // relax before this.)
  let relaxed = false
  let candidateIds = eligible
  let rankCost: (e: LedgerEntry) => number
  if (eligible.length === 0) {
    relaxed = true
    candidateIds = excluded.map((x) => x.crew_id)
    rankCost = (e) => e.weekend_watches * W_WEEKEND // lowest weekend burden
  } else {
    rankCost = (e) => selectionCost(e, date, dayType, isFriday)
  }

  // Step B/C — score, lowest cost, deterministic tie-break.
  const costs: CandidateCost[] = candidateIds
    .map((id) => ({ crew_id: id, cost: rankCost(entryOf(ledger, id)) }))
    .sort((a, b) => a.cost - b.cost || (a.crew_id < b.crew_id ? -1 : 1))
  const min = costs[0].cost
  const tied = costs.filter((c) => Math.abs(c.cost - min) <= COST_EPS).map((c) => c.crew_id)
  const { winner, rule } = breakTie(tied, dayType, isFriday, ledger)

  // reason_code
  let reason_code: string
  if (relaxed) reason_code = 'constraint_relaxed_monday_exclusion'
  else if (rule !== 'cost') reason_code = `tie_break_${rule}`
  else reason_code = dayTypeReason(dayType, isFriday)

  return {
    crew_id: winner,
    reason_code,
    detail: baseDetail({ candidates: costs, excluded, relaxed, winner, tie_break: rule === 'cost' ? undefined : rule }),
  }
}

// ---- Step D — updateLedger (fairness.md §4 Step D) -------------------------
// `ledger` is the per-lane state the spec treats as ambient; passed explicitly
// (trailing) so the function stays pure/testable. Mutates ledger[crew_id] and
// returns the updated entry. Counter updates only — fairness_score is recomputed
// separately by computeFairnessScore (it needs the whole lane).
export function updateLedger(
  _lane: Lane,
  crew_id: string,
  date: string,
  dayType: DayType,
  isFriday: boolean,
  ledger: Ledger,
): LedgerEntry {
  const e = entryOf(ledger, crew_id)
  const contiguous = e.last_watch_date !== null && e.last_watch_date === addDays(date, -1)
  const updated: LedgerEntry = {
    ...e,
    total_watches: e.total_watches + 1,
    weekday_watches: e.weekday_watches + (dayType === 'weekday' ? 1 : 0),
    weekend_watches: e.weekend_watches + (dayType === 'weekend' ? 1 : 0),
    friday_watches: e.friday_watches + (isFriday ? 1 : 0),
    last_watch_date: date,
    last_weekend_date: dayType === 'weekend' ? date : e.last_weekend_date,
    consecutive_run: contiguous ? e.consecutive_run + 1 : 1,
  }
  ledger[crew_id] = updated
  return updated
}

// ---- the 0–100 relative fairness score (fairness.md §5) --------------------
export type ScoreBand = 'high' | 'mid' | 'low'
export interface FairnessScore {
  crew_id: string
  score: number // 0–100
  burden: number
  deviation: number // burden - fair_share (>0 = over their share)
  over: boolean
  band: ScoreBand
}

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_HIGH) return 'high'
  if (score >= SCORE_MID) return 'mid'
  return 'low'
}

// Per-lane: relative to lane peers. A lone member is trivially 100.
export function computeFairnessScore(entries: LedgerEntry[]): FairnessScore[] {
  if (entries.length === 0) return []
  const burdens = entries.map(burden)
  const mean = burdens.reduce((a, b) => a + b, 0) / burdens.length
  const variance = burdens.reduce((a, b) => a + (b - mean) ** 2, 0) / burdens.length // population
  const spread = Math.max(Math.sqrt(variance), EPSILON)
  return entries.map((e, i) => {
    const b = burdens[i]
    const deviation = b - mean
    const z = deviation / spread
    const score = Math.max(0, Math.min(100, 100 - Math.abs(z) * K))
    return { crew_id: e.crew_id, score, burden: b, deviation, over: deviation > 0, band: scoreBand(score) }
  })
}
