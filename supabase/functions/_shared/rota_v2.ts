// V2: lane membership restricts candidacy; one vessel-wide ledger tracks service.
import { addDays, isoWeekday, zeroEntry, updateLedger, selectionCost, computeFairnessScore, type Ledger, type LedgerEntry } from './fairness_engine.ts'
import { makeAvailability, type Crew, type LeaveRange, type CharterRange, type ScheduleSettings, type PlannedAssignment } from './schedule_engine.ts'

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

export function planGlobal(input: { startDate: string; settings: ScheduleSettings; lanes: RotaLane[]; crew: Crew[]; base: Ledger; leave?: LeaveRange[]; charters?: CharterRange[] }) {
  const lanes = [...input.lanes].sort((a, b) => a.position - b.position || cmp(a.id, b.id))
  const ledger: Ledger = Object.fromEntries(Object.entries(input.base).map(([id, e]) => [id, { ...e }]))
  const horizon = Math.max(1, Math.min(13, Math.trunc(input.settings.horizon_weeks)))
  const end = addDays(input.startDate, horizon * 7 - 1)
  const available = makeAvailability(input.crew, input.leave ?? [])
  const pools = lanes.map(l => input.crew.filter(c => c.eligible && c.department && l.departments.includes(c.department)).map(c => c.id).sort(cmp))
  const participants = [...new Set(pools.flat())]
  const assignments: PlannedAssignment[] = []
  const opportunities: Opportunity[] = []
  const events: { lane_id: string; crew_id: string | null; watch_date: string; reason_code: string; detail: unknown }[] = []
  const scheduled = (d: string) => d <= end && !(isoWeekday(d) >= 6 && !input.settings.include_weekends) && !(input.charters ?? []).some(c => c.start <= d && d <= c.end)
  const covered = new Set<string>()
  for (let date = input.startDate; date <= end; date = addDays(date, 1)) {
    if (!scheduled(date) || covered.has(date)) continue
    const wd = isoWeekday(date)
    const structure = input.settings.weekend_structure ?? 'per_day'
    const length = structure === 'fri_sat_sun_block' && wd === 5 ? 3 : structure !== 'per_day' && wd === 6 ? 2 : 1
    const days = Array.from({ length }, (_, i) => addDays(date, i)).filter(scheduled)
    const blockPools = pools.map(pool => pool.filter(id => days.every(d => available(id, d))))
    for (const id of new Set(blockPools.flat())) for (const d of days) {
      const o = { crew_id: id, watch_date: d }
      opportunities.push(o); addOpportunity(ledger, o)
    }
    const dayType = wd >= 6 ? 'weekend' : 'weekday'
    const flat = participants.every(id => !(ledger[id]?.[dayType === 'weekend' ? 'weekend_watches' : 'weekday_watches']))
    const anchor = flat ? (dayType === 'weekend' ? input.settings.weekend_rotation_anchor : input.settings.weekday_rotation_anchor) : 0
    const tieIds = [...participants].sort(cmp)
    const rotatedIds = [...tieIds.slice(anchor % (tieIds.length || 1)), ...tieIds.slice(0, anchor % (tieIds.length || 1))]
    const tieRank = new Map(rotatedIds.map((id, i) => [id, i]))
    type Candidate = { id: string; relaxed: number; cost: number; total: number; scarce: number; last: string; consecutive: number }
    const compare = (a: Candidate, b: Candidate) => a.relaxed - b.relaxed || a.cost - b.cost || a.total - b.total || a.scarce - b.scarce || cmp(a.last, b.last) || a.consecutive - b.consecutive || tieRank.get(a.id)! - tieRank.get(b.id)!
    const candidates = blockPools.map(pool => {
      const ranked = pool.map(id => {
        const e = ledger[id]
        return {
          id, relaxed: wd === 1 && (e.last_weekend_date === addDays(date, -1) || e.last_weekend_date === addDays(date, -2)) ? 1 : 0,
          cost: days.reduce((sum, d) => sum + selectionCost(e, d, isoWeekday(d) >= 6 ? 'weekend' : 'weekday', isoWeekday(d) === 5), 0),
          total: e.total_watches, scarce: wd >= 6 ? e.weekend_watches : wd === 5 ? e.friday_watches : 0,
          last: e.last_watch_date ?? '', consecutive: e.consecutive_run,
        }
      }).sort(compare)
      // With at most N lanes only N-1 people can be occupied elsewhere. Keeping
      // the N best in each constraint class preserves the optimal matching.
      return [0, 1].flatMap(relaxed => ranked.filter(c => c.relaxed === relaxed).slice(0, lanes.length))
    })
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
      for (const c of candidates[picks.length]) if (!used.has(c.id)) {
        used.add(c.id); picks.push(c); search(picks, used, relaxed + c.relaxed, cost + c.cost); picks.pop(); used.delete(c.id)
      }
      picks.push(null); search(picks, used, relaxed, cost); picks.pop()
    }
    search([], new Set(), 0, 0)
    const result = best as Match | null
    for (const d of days) {
      covered.add(d)
      lanes.forEach((lane, i) => {
        const c = result?.picks[i]
        if (c) {
          const a: PlannedAssignment = { lane_id: lane.id, crew_id: c.id, watch_date: d, day_type: isoWeekday(d) >= 6 ? 'weekend' : 'weekday', is_friday: isoWeekday(d) === 5 }
          assignments.push(a)
          updateLedger({ id: lane.id, kind: 'dept', department: null, pool: blockPools[i] }, c.id, d, a.day_type, a.is_friday, ledger)
        }
        events.push({ lane_id: lane.id, crew_id: c?.id ?? null, watch_date: d, reason_code: !c ? 'no_eligible_crew' : c.relaxed ? 'constraint_relaxed_monday_exclusion' : 'global_fairness_match', detail: { scope: 'vessel', block_days: days, pool: blockPools[i], candidates: candidates[i].map(c => ({ crew_id: c.id, cost: c.cost, monday_relaxed: !!c.relaxed })), selected_cost: c?.cost ?? null, matched_lanes: result?.filled, relaxed: !!c?.relaxed } })
      })
    }
  }
  return { start_date: input.startDate, end_date: end, horizon_weeks: horizon, assignments, opportunities, events, ledger, scores: globalScores(ledger, participants), gaps: events.filter(e => !e.crew_id) }
}
