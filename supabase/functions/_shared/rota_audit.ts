// Post-generation audit (docs/rota-audit.md).
//
// Every rule the engine enforces is LOCAL — this day, this person, these
// neighbours. Nothing ever asked whether the finished month is defensible, so
// emergent patterns slipped through with the engine satisfied at every step:
// one person drawing three Fridays running, another standing every Monday.
//
// This pass answers one question a captain can actually check: **is there a
// single swap that would make this rota fairer?** If the answer is no, the rota
// is locally optimal under the same measure the dashboard scores from, and that
// is a claim that can be reproduced rather than asserted. It REPORTS and never
// applies — a cleanup pass that silently rearranged days would break the
// per-day explanation the product is built on.
import { burden, isoWeekday, addDays, type Ledger, type LedgerEntry } from './fairness_engine.ts'
import { W_WEEKDAY, W_FRIDAY, W_WEEKEND } from './fairness_constants.ts'
import { makeAvailability, type Crew, type LeaveRange, type ScheduleSettings, type PlannedAssignment } from './schedule_engine.ts'
import { isoWeekKey, type RotaLane } from './rota_v2.ts'

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** What one watch-day adds to a crew member's weighted burden. */
export const dayWeight = (date: string) => {
  const wd = isoWeekday(date)
  return wd >= 6 ? W_WEEKEND : wd === 5 ? W_FRIDAY : W_WEEKDAY
}

export interface AuditSwap {
  /** Crew and date currently assigned, and what they would exchange for. */
  from: { crew_id: string; watch_date: string; lane_id: string }
  to: { crew_id: string; watch_date: string; lane_id: string }
  /** How much the spread falls. Positive means fairer. */
  gain: number
}

export interface AuditPattern { code: string; detail: Record<string, unknown> }

export interface AuditResult {
  /** Spread of the burden rate across rated crew — lower is fairer. */
  spread: number
  /** Legal swaps that would reduce the spread, best first. Empty = locally optimal. */
  improvable: AuditSwap[]
  /** Emergent shapes no per-day rule can see. Advisory, never blocking. */
  patterns: AuditPattern[]
  /** Weekday-to-weekday pairs actually examined, so "none found" has a denominator. */
  considered: number
}

/**
 * Burden rate re-expressed at the mean opportunity count — identical to the
 * measure `computeFairnessScore` uses, so the audit and the dashboard agree on
 * what "fairer" means. Kept here rather than imported because the audit needs
 * to recompute it a few thousand times with one counter changed.
 */
function rateOf(b: number, opp: number, meanOpp: number) {
  return opp === meanOpp ? b : (b * meanOpp) / opp
}

export function auditRota(input: {
  assignments: PlannedAssignment[]
  ledger: Ledger
  crew: Crew[]
  lanes: RotaLane[]
  settings: ScheduleSettings
  leave?: LeaveRange[]
  /** Weeks a crew member already spent a weekday watch in, outside this window. */
  weekdayWeeks?: string[]
  /** `last_weekend_date` as it stood BEFORE the window — rule 2's only fixed anchor. */
  baseWeekend?: Record<string, string | null>
  /** Cap on pairs examined, so a 3-lane quarter cannot stall a generation. */
  maxPairs?: number
}): AuditResult {
  const structure = input.settings.weekend_structure ?? 'per_day'
  const available = makeAvailability(input.crew, input.leave ?? [])
  const laneById = new Map(input.lanes.map(l => [l.id, l]))
  const deptOf = new Map(input.crew.map(c => [c.id, c.department]))
  const eligible = new Map(input.crew.map(c => [c.id, c.eligible]))
  const weekdayWeeks = new Set(input.weekdayWeeks ?? [])
  const baseWeekend = input.baseWeekend ?? {}

  // date -> lane -> crew, for the rule checks.
  const held = new Map<string, Map<string, string>>()
  for (const a of input.assignments) {
    const at = held.get(a.watch_date) ?? new Map<string, string>()
    at.set(a.lane_id, a.crew_id)
    held.set(a.watch_date, at)
  }
  const standsOn = (id: string, d: string) => {
    for (const who of held.get(d)?.values() ?? []) if (who === id) return true
    return false
  }

  // ---- the objective -------------------------------------------------------
  const rated = Object.values(input.ledger)
    .filter(e => e.weekday_opportunities + e.weekend_opportunities > 0)
    .sort((a, b) => cmp(a.crew_id, b.crew_id))
  const oppOf = (e: LedgerEntry) => e.weekday_opportunities + e.weekend_opportunities
  const meanOpp = rated.length ? rated.reduce((s, e) => s + oppOf(e), 0) / rated.length : 0
  const burdenOf = new Map(rated.map(e => [e.crew_id, burden(e)]))
  const rateFor = (id: string, b: number) => {
    const e = input.ledger[id]
    return e ? rateOf(b, oppOf(e), meanOpp) : 0
  }
  // Running sums let a candidate swap be scored in constant time: only two
  // crew members' burdens move, so the spread is adjusted rather than rebuilt.
  let sum = 0, sumSq = 0
  for (const e of rated) { const r = rateFor(e.crew_id, burdenOf.get(e.crew_id)!); sum += r; sumSq += r * r }
  const n = rated.length
  const spreadOf = (s: number, sq: number) => n ? Math.sqrt(Math.max(0, sq / n - (s / n) ** 2)) : 0
  const spread = spreadOf(sum, sumSq)

  // ---- would placing `id` on `date` break a rule? --------------------------
  // Only the two NEW placements need checking: removing a watch can never
  // create a violation. Every rule is local to a few days or the ISO week.
  const wouldViolate = (id: string, date: string, laneId: string, after: Map<string, Map<string, string>>) => {
    const lane = laneById.get(laneId)
    const dept = deptOf.get(id)
    if (!eligible.get(id) || !dept || !lane?.departments.includes(dept)) return true
    if (!available(id, date)) return true
    const wd = isoWeekday(date)
    const on = (d: string) => {
      for (const [l, who] of after.get(d) ?? []) if (who === id && !(d === date && l === laneId)) return true
      return false
    }
    if (on(date)) return true                                   // already standing elsewhere that day
    if (wd === 1 && (on(addDays(date, -1)) || on(addDays(date, -2))
      || baseWeekend[id] === addDays(date, -1) || baseWeekend[id] === addDays(date, -2))) return true  // rule 2
    if (structure !== 'fri_sat_sun_block') {
      if (wd === 5 && (on(addDays(date, 1)) || on(addDays(date, 2)))) return true                      // rule 1b
      if (wd >= 6 && on(addDays(date, wd === 6 ? -1 : -2))) return true                                // rule 1b, other side
    }
    if (wd < 6) {                                                                                      // rule 1c
      const week = isoWeekKey(date)
      if (weekdayWeeks.has(id + ':' + week)) return true
      for (let i = 0; i < 7; i++) {
        const d = addDays(week, i)
        if (d !== date && isoWeekday(d) < 6 && on(d)) return true
      }
    }
    return false
  }

  // ---- pairwise weekday swaps ---------------------------------------------
  // Scoped to weekday<->weekday. Weekend days move as whole blocks under
  // sat_sun_block / fri_sat_sun_block, so exchanging one of them would split a
  // block the engine placed atomically; the weekend is its own rotation in any
  // case. Fridays ARE weekdays here, which is the case that matters.
  // Friday is a ROTATION (fairness.md Step B): everyone takes a turn before
  // anyone takes a second. Weighted balance and rotation are different
  // objectives and they do not always agree — a swap can flatten the burden
  // spread by handing someone a second Friday while a colleague has none. That
  // is not an improvement, it is a trade of one kind of fairness for another,
  // and the rota the product promises is the rotation. Such swaps are rejected
  // rather than offered, so "no improving swap" stays a claim worth making.
  const fridayCount = new Map<string, number>()
  for (const a of input.assignments) if (isoWeekday(a.watch_date) === 5) fridayCount.set(a.crew_id, (fridayCount.get(a.crew_id) ?? 0) + 1)
  for (const c of input.crew) if (c.eligible && !fridayCount.has(c.id)) fridayCount.set(c.id, 0)
  const fridayVariance = (adjust?: { id: string; by: number }[]) => {
    const vals = [...fridayCount].map(([id, n]) => n + (adjust?.find(a => a.id === id)?.by ?? 0))
    const m = vals.reduce((x, y) => x + y, 0) / (vals.length || 1)
    return vals.reduce((x, y) => x + (y - m) ** 2, 0) / (vals.length || 1)
  }
  const fridayVarianceNow = fridayVariance()

  const weekdays = input.assignments
    .filter(a => isoWeekday(a.watch_date) < 6)
    .sort((x, y) => cmp(x.watch_date, y.watch_date) || cmp(x.lane_id, y.lane_id))
  const improvable: AuditSwap[] = []
  const maxPairs = input.maxPairs ?? 200_000
  let considered = 0

  outer:
  for (let i = 0; i < weekdays.length; i++) {
    for (let j = i + 1; j < weekdays.length; j++) {
      if (considered >= maxPairs) break outer
      const A = weekdays[i], B = weekdays[j]
      if (A.crew_id === B.crew_id) continue
      considered++
      const wA = dayWeight(A.watch_date), wB = dayWeight(B.watch_date)
      // Same weight on both days means the burdens are unchanged and the swap
      // is fairness-neutral by construction; nothing to find.
      if (wA === wB) continue

      const bA = burdenOf.get(A.crew_id), bB = burdenOf.get(B.crew_id)
      if (bA === undefined || bB === undefined) continue
      const oldA = rateFor(A.crew_id, bA), oldB = rateFor(B.crew_id, bB)
      const newA = rateFor(A.crew_id, bA - wA + wB), newB = rateFor(B.crew_id, bB - wB + wA)
      const after = spreadOf(sum - oldA - oldB + newA + newB, sumSq - oldA * oldA - oldB * oldB + newA * newA + newB * newB)
      const gain = spread - after
      if (gain <= 1e-9) continue
      // Would this flatten the burden by unbalancing the Friday rotation?
      const fA = isoWeekday(A.watch_date) === 5, fB = isoWeekday(B.watch_date) === 5
      if (fA !== fB) {
        const giver = fA ? A.crew_id : B.crew_id, taker = fA ? B.crew_id : A.crew_id
        if (fridayVariance([{ id: giver, by: -1 }, { id: taker, by: 1 }]) > fridayVarianceNow + 1e-9) continue
      }

      // Only now, once it is known to be an improvement, pay for the rule check.
      const trial = new Map([...held].map(([d, m]) => [d, new Map(m)]))
      trial.get(A.watch_date)!.set(A.lane_id, B.crew_id)
      trial.get(B.watch_date)!.set(B.lane_id, A.crew_id)
      if (wouldViolate(B.crew_id, A.watch_date, A.lane_id, trial)) continue
      if (wouldViolate(A.crew_id, B.watch_date, B.lane_id, trial)) continue

      improvable.push({
        from: { crew_id: A.crew_id, watch_date: A.watch_date, lane_id: A.lane_id },
        to: { crew_id: B.crew_id, watch_date: B.watch_date, lane_id: B.lane_id },
        gain,
      })
    }
  }
  // Deterministic: by gain, then by the dates and crew involved.
  improvable.sort((x, y) => y.gain - x.gain
    || cmp(x.from.watch_date, y.from.watch_date) || cmp(x.to.watch_date, y.to.watch_date)
    || cmp(x.from.crew_id, y.from.crew_id) || cmp(x.to.crew_id, y.to.crew_id))

  return { spread, improvable: improvable.slice(0, 20), patterns: findPatterns(input.assignments, structure, input.ledger), considered }
}

/**
 * Shapes a captain notices that no per-day rule can see, because each is a
 * property of the finished month rather than of any one decision.
 */
export function findPatterns(assignments: PlannedAssignment[], structure: string, ledger?: Ledger): AuditPattern[] {
  const out: AuditPattern[] = []
  const byCrew = new Map<string, string[]>()
  for (const a of [...assignments].sort((x, y) => cmp(x.watch_date, y.watch_date))) {
    const arr = byCrew.get(a.crew_id) ?? []; arr.push(a.watch_date); byCrew.set(a.crew_id, arr)
  }
  const people = [...byCrew.keys()].sort(cmp)

  // Fridays landing unevenly. Counted CUMULATIVELY from the ledger, never from
  // this window alone: a crew member who stood their Friday last month has had
  // their turn, and judging the window in isolation reports a concentration
  // that does not exist. Eight Fridays across six people is 2,2,1,1,1,1 — the
  // only distribution there is — and must not be flagged as a defect.
  const fridays = assignments.filter(a => isoWeekday(a.watch_date) === 5)
  if (fridays.length > 1) {
    const windowCount = new Map<string, number>()
    for (const f of fridays) windowCount.set(f.crew_id, (windowCount.get(f.crew_id) ?? 0) + 1)
    const cumulative = new Map<string, number>()
    for (const id of people) cumulative.set(id, ledger?.[id]?.friday_watches ?? windowCount.get(id) ?? 0)
    const counts = [...cumulative.values()]
    const lo = Math.min(...counts), hi = Math.max(...counts)
    // One apart is unavoidable whenever the Fridays do not divide evenly.
    if (hi - lo >= 2) {
      out.push({ code: 'friday_concentration', detail: {
        fridays: fridays.length, basis: ledger ? 'cumulative' : 'window',
        ahead: [...cumulative].filter(([, c]) => c === hi).map(([crew_id]) => crew_id).sort(cmp),
        behind: [...cumulative].filter(([, c]) => c === lo).map(([crew_id]) => crew_id).sort(cmp),
        spread: hi - lo,
      } })
    }
  }

  // The same person on the same weekday, week after week. Fair by the numbers,
  // monotonous in the cabin — and the kind of thing a crew notices first.
  for (const id of people) {
    const dows = new Map<number, number>()
    for (const d of byCrew.get(id)!) { const w = isoWeekday(d); if (w < 6) dows.set(w, (dows.get(w) ?? 0) + 1) }
    for (const [dow, n] of [...dows].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      if (n >= 3) out.push({ code: 'repeated_weekday', detail: { crew_id: id, iso_weekday: dow, times: n } })
    }
  }

  // Back-to-back weekends. The engine balances weekend COUNT over the horizon,
  // which permits two in a row so long as the total comes out even.
  const weekendLead = structure === 'fri_sat_sun_block' ? 5 : 6
  for (const id of people) {
    const leads = byCrew.get(id)!.filter(d => isoWeekday(d) === weekendLead).sort(cmp)
    let run = 1
    for (let i = 1; i < leads.length; i++) {
      if (addDays(leads[i - 1], 7) === leads[i]) run++
      else run = 1
      if (run >= 2) { out.push({ code: 'consecutive_weekends', detail: { crew_id: id, from: leads[i - 1], to: leads[i] } }) }
    }
  }

  return out.sort((a, b) => cmp(a.code, b.code) || cmp(JSON.stringify(a.detail), JSON.stringify(b.detail)))
}
