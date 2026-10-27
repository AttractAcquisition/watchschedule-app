// V2: lane membership restricts candidacy; one vessel-wide ledger tracks service.
import { addDays, isoWeekday, zeroEntry, updateLedger, selectionCost, computeFairnessScore, type Ledger, type LedgerEntry } from './fairness_engine.ts'
import { makeAvailability, type Crew, type LeaveRange, type CharterRange, type ScheduleSettings, type PlannedAssignment } from './schedule_engine.ts'
import { pinnedCrewForBlock, type EnginePin } from './watch_pins.ts'

export const DEPARTMENTS = ['deck', 'interior', 'engineering', 'officer'] as const
export interface RotaLane { id: string; label: string; departments: string[]; position: number }
export interface Opportunity { crew_id: string; watch_date: string; estimated?: boolean }
export interface ScheduleVersion { id: string; start_date: string; end_date: string; generated_at: string; engine_version?: number }
export interface HistoricalAssignment extends PlannedAssignment { schedule_id: string }
export interface HistoricalOpportunity extends Opportunity { schedule_id: string }
export interface SeedRecord { crew_id: string; watch_date: string; assigned: boolean }
export function seedHistory(records: SeedRecord[], before: string) {
  const unique = new Map<string, SeedRecord>()
  for (const record of records) {
    if (record.watch_date >= before) continue
    const key = record.crew_id + ':' + record.watch_date
    unique.set(key, { ...record, assigned: record.assigned || !!unique.get(key)?.assigned })
  }
  const opportunities: Opportunity[] = [...unique.values()]
  const assignments: PlannedAssignment[] = [...unique.values()].filter(r => r.assigned).map(r => ({
    crew_id: r.crew_id, watch_date: r.watch_date, lane_id: 'import',
    day_type: isoWeekday(r.watch_date) >= 6 ? 'weekend' : 'weekday',
    is_friday: isoWeekday(r.watch_date) === 5,
  }))
  return { opportunities, assignments }
}
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000)
export const MAX_WINDOW_DAYS = 91
// schedule.md §5.1 — one cap in every shape. An explicit endDate wins over
// horizon_weeks; both are clamped here, so stored dates are never trusted.
export function generationEnd(startDate: string, horizonWeeks: number, endDate?: string | null) {
  const weeks = Math.max(1, Math.min(13, Math.trunc(horizonWeeks) || 1))
  const capped = addDays(startDate, MAX_WINDOW_DAYS - 1)
  const end = endDate ? (endDate < startDate ? startDate : endDate) : addDays(startDate, weeks * 7 - 1)
  return end > capped ? capped : end
}
export const spanWeeks = (startDate: string, end: string) =>
  Math.max(1, Math.min(13, Math.ceil((dayDiff(startDate, end) + 1) / 7)))

export interface WindowSettings {
  generation_mode?: 'weeks' | 'month' | 'range' | null
  generation_start_date?: string | null
  generation_end_date?: string | null
  schedule_start_date: string
}
// schedule.md §5.1. firstRun = no schedule exists yet and this is not an
// explicit regenerate, the only case that honours schedule_start_date. A month
// or range is taken as given, except that a window already begun clamps to
// today: no regeneration ever rewrites duty already stood. Starting in the
// future is allowed — that is planning ahead, not an error.
export function generationWindow(settings: WindowSettings, today: string, firstRun: boolean) {
  if ((settings.generation_mode ?? 'weeks') === 'weeks') {
    return { start: firstRun ? settings.schedule_start_date : today, endDate: null as string | null }
  }
  const from = settings.generation_start_date
  const to = settings.generation_end_date
  if (!from || !to) throw new Error('Set a start and end date for the generation window.')
  if (to < today) throw new Error('That generation window has already passed. Pick one that ends today or later.')
  return { start: from < today ? today : from, endDate: to }
}
export const laneLimit = (tier: string) => ({ solo: 1, dual: 2, triple: 3 })[tier] ?? 0

export function validateLanes(lanes: RotaLane[], tier: string) {
  if (!lanes.length || lanes.length > laneLimit(tier)) throw new Error('Active lane count exceeds your subscription or is empty.')
  if (new Set(lanes.map(l => l.id)).size !== lanes.length) throw new Error('Duplicate lane.')
  for (const lane of lanes) {
    if (!lane.departments.length || new Set(lane.departments).size !== lane.departments.length || lane.departments.some(d => !(DEPARTMENTS as readonly string[]).includes(d))) throw new Error('Every lane needs a valid department pool.')
  }
}

export function addOpportunity(ledger: Ledger, o: Opportunity) {
  const e = ledger[o.crew_id] ?? (ledger[o.crew_id] = zeroEntry(o.crew_id))
  const wd = isoWeekday(o.watch_date)
  if (wd >= 6) e.weekend_opportunities++
  else { e.weekday_opportunities++; if (wd === 5) e.friday_opportunities++ }
}

export function replayGlobal(seed: Ledger, assignments: PlannedAssignment[], opportunities: Opportunity[]): Ledger {
  const ledger: Ledger = Object.fromEntries(Object.entries(seed).map(([id, e]) => [id, { ...e }]))
  const seen = new Set<string>()
  for (const o of opportunities) {
    const key = `${o.crew_id}:${o.watch_date}`
    if (!seen.has(key)) { addOpportunity(ledger, o); seen.add(key) }
  }
  seen.clear()
  for (const a of [...assignments].sort((a, b) => cmp(a.watch_date, b.watch_date) || cmp(a.crew_id, b.crew_id))) {
    const key = `${a.crew_id}:${a.watch_date}`
    if (seen.has(key)) continue
    seen.add(key)
    updateLedger({ id: a.lane_id, kind: 'dept', department: null, pool: [] }, a.crew_id, a.watch_date, a.day_type, a.is_friday, ledger)
  }
  return ledger
}

// A newer regeneration supersedes the older future, even if its horizon shrinks.
export function canonicalHistory(versions: ScheduleVersion[], assignments: HistoricalAssignment[], opportunities: HistoricalOpportunity[], before: string) {
  const ordered = [...versions].sort((a, b) => cmp(b.generated_at, a.generated_at) || cmp(b.id, a.id))
  const cache = new Map<string, string | null>()
  const winner = (date: string) => {
    if (!cache.has(date)) {
      const v = ordered.find(s => s.start_date <= date)
      cache.set(date, v && date <= v.end_date ? v.id : null)
    }
    return cache.get(date)
  }
  return {
    assignments: assignments.filter(a => a.watch_date < before && winner(a.watch_date) === a.schedule_id),
    opportunities: opportunities.filter(o => o.watch_date < before && winner(o.watch_date) === o.schedule_id),
  }
}

export function globalScores(ledger: Ledger, ids: string[]) {
  const entries = [...new Set(ids)].sort(cmp).map(id => ledger[id] ?? zeroEntry(id))
  return computeFairnessScore(entries).map(s => ({
    ...(ledger[s.crew_id] ?? zeroEntry(s.crew_id)),
    fairness_score: (ledger[s.crew_id]?.weekday_opportunities ?? 0) + (ledger[s.crew_id]?.weekend_opportunities ?? 0) > 0 ? s.score : null,
    deviation: s.deviation, balance: s.over ? 'over' : s.deviation < 0 ? 'under' : 'balanced',
  }))
}

export function planGlobal(input: { startDate: string; settings: ScheduleSettings; lanes: RotaLane[]; crew: Crew[]; base: Ledger; leave?: LeaveRange[]; charters?: CharterRange[]; endDate?: string | null; pins?: EnginePin[] }) {
  const lanes = [...input.lanes].sort((a, b) => a.position - b.position || cmp(a.id, b.id))
  const ledger: Ledger = Object.fromEntries(Object.entries(input.base).map(([id, e]) => [id, { ...e }]))
  const end = generationEnd(input.startDate, input.settings.horizon_weeks, input.endDate)
  // Derived descriptor of the span for the schedules row; start/end are authoritative.
  const horizon = spanWeeks(input.startDate, end)
  const available = makeAvailability(input.crew, input.leave ?? [])
  const pools = lanes.map(l => input.crew.filter(c => c.eligible && c.department && l.departments.includes(c.department)).map(c => c.id).sort(cmp))
  // docs/fixed-watches.md — a pinned crew member stands a watch, so they are
  // scored even when no lane pool would have drawn on them. Same reasoning as
  // the manual override's consented out-of-pool assignee.
  const crewIds = new Set(input.crew.map(c => c.id))
  const pins = (input.pins ?? []).filter(p => crewIds.has(p.crew_id) && lanes.some(l => l.id === p.lane_id))
  const participants = [...new Set([...pools.flat(), ...pins.map(p => p.crew_id)])].sort(cmp)
  const assignments: PlannedAssignment[] = []
  const opportunities: Opportunity[] = []
  const events: { lane_id: string; crew_id: string | null; watch_date: string; reason_code: string; detail: unknown }[] = []
  const scheduled = (d: string) => d <= end && !(isoWeekday(d) >= 6 && !input.settings.include_weekends) && !(input.charters ?? []).some(c => c.start <= d && d <= c.end)
  const covered = new Set<string>()
  // Who stood which date in THIS run — carries the Friday-to-weekend exclusion
  // across the block loop; dates before the window come from the ledger instead.
  const stood = new Set<string>()
  for (let date = input.startDate; date <= end; date = addDays(date, 1)) {
    if (!scheduled(date) || covered.has(date)) continue
    const wd = isoWeekday(date)
    const structure = input.settings.weekend_structure ?? 'per_day'
    const length = structure === 'fri_sat_sun_block' && wd === 5 ? 3 : structure !== 'per_day' && wd === 6 ? 2 : 1
    const days = Array.from({ length }, (_, i) => addDays(date, i)).filter(scheduled)
    const blockPools = pools.map(pool => pool.filter(id => days.every(d => available(id, d))))
    // Who the captain fixed to each lane for this block. A pin overrides pool
    // membership and availability — it was made deliberately, and anything it
    // breaks has already been consented to before generation was allowed to run.
    const blockPins = lanes.map(lane => pinnedCrewForBlock(pins, lane.id, days))
    const pinnedHere = blockPins.filter((id): id is string => !!id)
    // The pinned crew member gains the opportunity too: they were available to
    // stand it, and without the denominator the burden rate is meaningless.
    for (const id of new Set([...blockPools.flat(), ...pinnedHere])) for (const d of days) {
      const o = { crew_id: id, watch_date: d }
      opportunities.push(o); addOpportunity(ledger, o)
    }
    const dayType = wd >= 6 ? 'weekend' : 'weekday'
    const flat = participants.every(id => !(ledger[id]?.[dayType === 'weekend' ? 'weekend_watches' : 'weekday_watches']))
    const anchor = flat ? (dayType === 'weekend' ? input.settings.weekend_rotation_anchor : input.settings.weekday_rotation_anchor) : 0
    const tieIds = [...participants].sort(cmp)
    const rotatedIds = [...tieIds.slice(anchor % (tieIds.length || 1)), ...tieIds.slice(0, anchor % (tieIds.length || 1))]
    const tieRank = new Map(rotatedIds.map((id, i) => [id, i]))
    // fairness.md rule 1b: nobody stands a Fri -> Sun run. The Friday of this
    // weekend is date-1 (Sat) or date-2 (Sun); fri_sat_sun_block is exempt,
    // since there the Friday is the block's own lead day.
    const weekendFriday = structure !== 'fri_sat_sun_block' && wd >= 6 ? addDays(date, wd === 6 ? -1 : -2) : null
    const stoodWeekendFriday = (id: string) =>
      !!weekendFriday && (stood.has(id + ':' + weekendFriday) || ledger[id]?.last_watch_date === weekendFriday)
    type Candidate = { id: string; relaxed: number; relaxedKind: 'monday' | 'friday' | null; cost: number; total: number; scarce: number; last: string; consecutive: number }
    const compare = (a: Candidate, b: Candidate) => a.relaxed - b.relaxed || a.cost - b.cost || a.total - b.total || a.scarce - b.scarce || cmp(a.last, b.last) || a.consecutive - b.consecutive || tieRank.get(a.id)! - tieRank.get(b.id)!
    const rank = (id: string): Candidate => {
      const e = ledger[id] ?? zeroEntry(id)
      // At most one exclusion is ever in force: a Monday is never a weekend day.
      const mondayAfterWeekend = wd === 1 && (e.last_weekend_date === addDays(date, -1) || e.last_weekend_date === addDays(date, -2))
      const fridayIntoWeekend = stoodWeekendFriday(id)
      return {
        id, relaxed: mondayAfterWeekend || fridayIntoWeekend ? 1 : 0,
        relaxedKind: mondayAfterWeekend ? 'monday' as const : fridayIntoWeekend ? 'friday' as const : null,
        cost: days.reduce((sum, d) => sum + selectionCost(e, d, isoWeekday(d) >= 6 ? 'weekend' : 'weekday', isoWeekday(d) === 5), 0),
        total: e.total_watches, scarce: wd >= 6 ? e.weekend_watches : wd === 5 ? e.friday_watches : 0,
        last: e.last_watch_date ?? '', consecutive: e.consecutive_run,
      }
    }
    const candidates = blockPools.map(pool => {
      const ranked = pool.map(rank).sort(compare)
      // With at most N lanes only N-1 people can be occupied elsewhere. Keeping
      // the N best in each constraint class preserves the optimal matching.
      return [0, 1].flatMap(relaxed => ranked.filter(c => c.relaxed === relaxed).slice(0, lanes.length))
    })
    const forced = blockPins.map(id => (id ? rank(id) : null))
    type Match = { picks: (Candidate | null)[]; filled: number; relaxed: number; cost: number }
    let best: Match | null = null
    const better = (a: Match, b: Match) => {
      if (a.filled !== b.filled) return a.filled > b.filled
      if (a.relaxed !== b.relaxed) return a.relaxed < b.relaxed
      if (Math.abs(a.cost - b.cost) > 1e-9) return a.cost < b.cost
      for (let i = 0; i < a.picks.length; i++) {
        const ac = a.picks[i], bc = b.picks[i]
        if (!ac || !bc) { if (ac !== bc) return !!ac; continue }
        const diff = compare(ac, bc)
        if (diff) return diff < 0
      }
      return false
    }
    const search = (picks: (Candidate | null)[], used: Set<string>, relaxed: number, cost: number) => {
      if (picks.length === lanes.length) {
        const match = { picks: [...picks], filled: used.size, relaxed, cost }
        if (!best || better(match, best)) best = match
        return
      }
      // A pinned lane is not searched: the captain already chose.
      const pin = forced[picks.length]
      if (pin) {
        picks.push(pin); search(picks, used, relaxed + pin.relaxed, cost + pin.cost); picks.pop()
        return
      }
      for (const c of candidates[picks.length]) if (!used.has(c.id)) {
        used.add(c.id); picks.push(c); search(picks, used, relaxed + c.relaxed, cost + c.cost); picks.pop(); used.delete(c.id)
      }
      picks.push(null); search(picks, used, relaxed, cost); picks.pop()
    }
    // Pinned crew are reserved vessel-wide for the block before the search
    // begins, so no other lane can take them that day.
    search([], new Set(pinnedHere), 0, 0)
    const result = best as Match | null
    for (const d of days) {
      covered.add(d)
      lanes.forEach((lane, i) => {
        const c = result?.picks[i]
        if (c) {
          const a: PlannedAssignment = { lane_id: lane.id, crew_id: c.id, watch_date: d, day_type: isoWeekday(d) >= 6 ? 'weekend' : 'weekday', is_friday: isoWeekday(d) === 5 }
          assignments.push(a)
          stood.add(c.id + ':' + d)
          updateLedger({ id: lane.id, kind: 'dept', department: null, pool: blockPools[i] }, c.id, d, a.day_type, a.is_friday, ledger)
        }
        events.push({ lane_id: lane.id, crew_id: c?.id ?? null, watch_date: d, reason_code: !c ? 'no_eligible_crew' : blockPins[i] ? 'fixed_watch' : c.relaxedKind ? `constraint_relaxed_${c.relaxedKind}_exclusion` : 'global_fairness_match', detail: { scope: 'vessel', block_days: days, pool: blockPools[i], pinned: !!blockPins[i], candidates: candidates[i].map(c => ({ crew_id: c.id, cost: c.cost, monday_relaxed: c.relaxedKind === 'monday', friday_relaxed: c.relaxedKind === 'friday' })), selected_cost: c?.cost ?? null, matched_lanes: result?.filled, relaxed: !!c?.relaxed } })
      })
    }
  }
  return { start_date: input.startDate, end_date: end, horizon_weeks: horizon, assignments, opportunities, events, ledger, scores: globalScores(ledger, participants), gaps: events.filter(e => !e.crew_id) }
}
