import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isoWeekday, type Ledger } from './fairness_engine.ts'
import { makeAvailability, type Crew, type LeaveRange } from './schedule_engine.ts'
import { seedHistory, isoWeekKey, type SeedRecord, canonicalHistory, replayGlobal, type HistoricalAssignment, type HistoricalOpportunity, type Opportunity, type RotaLane, type ScheduleVersion } from './rota_v2.ts'
import type { WatchPin } from './watch_pins.ts'

export async function rotaContext(req: Request) {
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) throw new Error('Unauthorized')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: profile, error: pe } = await admin.from('profiles').select('vessel_id,product_tier,payment_status').eq('id', data.user.id).single()
  if (pe || !profile?.vessel_id || profile.payment_status !== 'active') throw new Error('Active subscription required')
  const { data: vessel, error: ve } = await admin.from('vessels').select('id,rota_revision').eq('id', profile.vessel_id).eq('owner_id', data.user.id).single()
  if (ve || !vessel) throw new Error('Vessel not found')
  return { admin, vesselId: vessel.id as string, revision: vessel.rota_revision as number, tier: profile.product_tier as string }
}
export type Admin = Awaited<ReturnType<typeof rotaContext>>['admin']
// Paginate so the history never silently stops at PostgREST's row limit.
export async function readAll(admin: Admin, table: string, vesselId: string) {
  const rows: Record<string, any>[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select('*').eq('vessel_id', vesselId).order('id').range(offset, offset + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}
export async function loadRotaInputs(admin: Admin, vesselId: string) {
  const [crewRows, laneRows, deptRows, leaveRows, charterRows, pinRows] = await Promise.all([
    readAll(admin, 'crew_members', vesselId), readAll(admin, 'watch_lanes', vesselId), readAll(admin, 'lane_departments', vesselId),
    readAll(admin, 'crew_leave', vesselId), readAll(admin, 'charter_periods', vesselId), readAll(admin, 'watch_pins', vesselId),
  ])
  const crew = crewRows as (Crew & { full_name: string })[]
  const lanes: RotaLane[] = laneRows.filter(l => l.active).map(l => ({
    id: l.id, label: l.label, position: l.position,
    departments: deptRows.filter(d => d.lane_id === l.id).map(d => d.department),
  }))
  const leave: LeaveRange[] = leaveRows.filter(l => l.status === 'booked').map(l => ({ crew_id: l.crew_member_id, start: l.start_date, end: l.end_date }))
  const charters = charterRows.filter(c => c.status === 'booked').map(c => ({ start: c.start_date, end: c.end_date }))
  // docs/fixed-watches.md — captain-set pins, a configuration input like leave.
  const pins: WatchPin[] = pinRows.map(p => ({
    id: p.id, crew_member_id: p.crew_member_id, lane_id: p.lane_id,
    watch_date: p.watch_date, acknowledged: p.acknowledged ?? [],
  }))
  return { crew, lanes, laneRows, leave, charters, pins }
}

// A pending amendment to the stored rota, replayed as if it were already saved.
// The manual-override function uses this to score a change BEFORE persisting it,
// so the ledger it writes is the ordinary replay of the amended assignments —
// never a second, parallel fairness calculation.
export interface RotaPatch {
  assignments?: (rows: HistoricalAssignment[]) => HistoricalAssignment[]
  opportunities?: HistoricalOpportunity[]
  /**
   * Schedule versions that do not exist in the database yet. The per-date
   * winner rule only keeps an assignment whose `schedule_id` owns its date, so
   * rows bound for a version still being created would otherwise be dropped
   * from the replay and the import would score as nothing. Used by
   * import-watch-history to price a pending historical row before writing it.
   */
  versions?: (rows: ScheduleVersion[]) => ScheduleVersion[]
  /**
   * Replay as if the calendar-clear marker were already lifted. A restore
   * clears the marker in the same transaction that writes the scores, so the
   * replay must price the rota it is about to produce — not the empty one the
   * marker currently describes. Without this the caller would have to null the
   * marker in the database first and put it back afterwards, which loses it
   * outright if the call fails in between.
   */
  liftCalendarClear?: boolean
}

export async function loadGlobalBase(admin: Admin, vesselId: string, before: string, inputs: Awaited<ReturnType<typeof loadRotaInputs>>, patch?: RotaPatch, windowEnd?: string) {
  const [scheduleRows, assignmentRows, seedResult, vesselResult] = await Promise.all([
    readAll(admin, 'schedules', vesselId), readAll(admin, 'watch_assignments', vesselId),
    admin.from('rota_seed').select('*').eq('vessel_id', vesselId).maybeSingle(),
    admin.from('vessels').select('fairness_reset_at,calendar_cleared_at').eq('id', vesselId).single(),
  ])
  if (seedResult.error) throw seedResult.error
  if (vesselResult.error) throw vesselResult.error
  const seed = seedResult.data
  // Two markers can hide earlier generations: a fairness reset (scores only,
  // the calendar keeps its watches) and a calendar clear (both). The later one
  // wins — each only ever moves the cut-off forward.
  const fairnessResetAt = vesselResult.data.fairness_reset_at as string | null
  const clearedAt = patch?.liftCalendarClear ? null : vesselResult.data.calendar_cleared_at as string | null
  const resetAt = [fairnessResetAt, clearedAt].filter(Boolean).sort().pop() ?? null
  const stored = (scheduleRows as (ScheduleVersion & { rota_snapshot: { lanes?: RotaLane[]; opportunities?: Opportunity[]; history_estimated?: boolean } | null })[])
    .filter(s => !resetAt || s.generated_at > resetAt)
  const versions = patch?.versions ? patch.versions(stored) as typeof stored : stored
  const assignments = patch?.assignments ? patch.assignments(assignmentRows as HistoricalAssignment[]) : assignmentRows as HistoricalAssignment[]
  const opportunities: HistoricalOpportunity[] = [...(patch?.opportunities ?? [])]
  const legacySnapshots: { id: string; snapshot: unknown }[] = []
  let estimated = !!seed?.history_estimated
  const available = makeAvailability(inputs.crew, inputs.leave)
  const legacyLanes = new Map(inputs.laneRows.map(l => [l.id, l]))
  for (const s of versions) {
    if (Array.isArray(s.rota_snapshot?.opportunities)) {
      for (const o of s.rota_snapshot?.opportunities ?? []) opportunities.push({ ...o, schedule_id: s.id })
      continue
    }
    const oldAssignments = assignments.filter(a => a.schedule_id === s.id)
    const savedLanes = new Map((s.rota_snapshot?.lanes ?? []).map(l => [l.id, l]))
    const startIndex = opportunities.length
    // Retired legacy groups lost their junctions. Retained labels and assigned
    // crew departments supply an explicitly estimated historical pool.
    for (const date of new Set(oldAssignments.map(a => a.watch_date))) {
      const dayAssignments = oldAssignments.filter(a => a.watch_date === date)
      const departments = new Set<string>()
      let all = false
      for (const id of new Set(dayAssignments.map(a => a.lane_id))) {
        const l = legacyLanes.get(id)
        const saved = savedLanes.get(id)
        for (const d of saved?.departments ?? []) departments.add(d)
        if (l?.kind === 'solo') all = true
        for (const d of ['deck', 'interior', 'engineering', 'officer']) if (l?.label?.toLowerCase().includes(d) || l?.department === d) departments.add(d)
        for (const a of oldAssignments.filter(a => a.lane_id === id)) {
          const c = inputs.crew.find(c => c.id === a.crew_id)
          if (c?.department) departments.add(c.department)
        }
      }
      const assigned = new Set(dayAssignments.map(a => a.crew_id))
      for (const c of inputs.crew) if (assigned.has(c.id) || (c.eligible && (all || !!c.department && departments.has(c.department)) && available(c.id, date))) {
        opportunities.push({ crew_id: c.id, watch_date: date, schedule_id: s.id, estimated: true })
      }
    }
    legacySnapshots.push({ id: s.id, snapshot: { ...s.rota_snapshot, opportunities: opportunities.slice(startIndex).map(({ schedule_id: _s, ...o }) => o), history_estimated: true } })
  }
  const past = canonicalHistory(versions, assignments, opportunities, before, windowEnd)
  const currentCrew = new Set(inputs.crew.map(c => c.id))
  const unpaused = (r: Opportunity) => !inputs.charters.some(c => c.start <= r.watch_date && r.watch_date <= c.end)
  past.assignments = past.assignments.filter(unpaused)
  past.opportunities = past.opportunities.filter(unpaused)
  // Days beyond this window that an older generation still covers. Rostered,
  // not re-planned — generation scores them so a narrowed window does not erase
  // its own tail from the ledger (docs/schedule.md §5.4).
  const retained = {
    assignments: past.retainedAssignments.filter(unpaused).filter(a => currentCrew.has(a.crew_id)),
    opportunities: past.retainedOpportunities.filter(unpaused).filter(o => currentCrew.has(o.crew_id)),
  }
  estimated ||= past.opportunities.some(o => o.estimated)
  const generatedDates = new Set(past.opportunities.map(o => o.watch_date))
  for (const a of past.assignments) generatedDates.add(a.watch_date)
  const imported = seedHistory((seed?.records ?? []).filter((r: SeedRecord) => !generatedDates.has(r.watch_date)), before)
  const baseline: Ledger = seed?.baseline ?? {}
  const beyondSeed = (r: Opportunity) => !baseline[r.crew_id]?.last_watch_date || r.watch_date > baseline[r.crew_id].last_watch_date!
  const ledger = replayGlobal(
    Object.fromEntries(Object.entries(baseline).filter(([id]) => currentCrew.has(id))),
    [...imported.assignments, ...past.assignments.filter(beyondSeed)].filter(a => currentCrew.has(a.crew_id)),
    [...imported.opportunities, ...past.opportunities.filter(beyondSeed)].filter(o => currentCrew.has(o.crew_id)),
  )
  // Watches standing BEFORE the window — the only history the fixed-watch
  // neighbour rules may treat as fact (docs/fixed-watches.md). Everything from
  // the window start onwards is about to be re-planned, so it is not yet a fact.
  const stoodBefore = new Set<string>()
  for (const a of [...imported.assignments, ...past.assignments]) stoodBefore.add(a.crew_id + ':' + a.watch_date)
  // fairness.md rule 1c needs the ISO weeks a crew member has ALREADY spent a
  // weekday watch in, for the weeks the generation window covers only part of.
  // Both directions count, because both are rostered fact: history behind the
  // window, and the retained tail ahead of it (schedule.md 7.2) which this run
  // will not re-plan. Day type is taken from the date, not the stored column,
  // so it matches the engine's own definition for every source.
  const weekdayWeeks = new Set<string>()
  for (const a of [...imported.assignments, ...past.assignments, ...retained.assignments]) {
    if (isoWeekday(a.watch_date) < 6) weekdayWeeks.add(a.crew_id + ':' + isoWeekKey(a.watch_date))
  }
  // fairness.md Step B — a rota sends you to the BACK of the queue once you
  // have stood your turn. Counting turns alone is not enough: when everyone is
  // level the count ties, and whoever is marginally cheapest can take two
  // Fridays running. The date of each crew member's last Friday breaks that
  // tie, so the queue orders itself. Taken from history, then carried forward
  // by the run. A crew member who has never stood one sorts first.
  const lastFriday: Record<string, string> = {}
  for (const a of [...imported.assignments, ...past.assignments, ...retained.assignments]) {
    if (isoWeekday(a.watch_date) !== 5) continue
    if (!lastFriday[a.crew_id] || a.watch_date > lastFriday[a.crew_id]) lastFriday[a.crew_id] = a.watch_date
  }
  return { ledger, estimated, legacySnapshots, stoodBefore, retained, weekdayWeeks: [...weekdayWeeks].sort(), lastFriday }
}

/**
 * The generations the rota currently consists of.
 *
 * A calendar clear hides every generation at or before its marker: the replay
 * skips them and the calendar does not draw them. Anything resolving which
 * version OWNS a date has to skip them too, or it writes into a version nobody
 * can see — an imported watch would vanish the moment it was recorded.
 *
 * A fairness reset is deliberately NOT a reason to hide a version: that reset
 * keeps the rota on screen and only restarts the scores.
 */
export async function visibleVersions<T extends { generated_at: string }>(admin: Admin, vesselId: string, rows: T[]): Promise<T[]> {
  const { data, error } = await admin.from('vessels').select('calendar_cleared_at').eq('id', vesselId).single()
  if (error) throw error
  const clearedAt = data.calendar_cleared_at as string | null
  return clearedAt ? rows.filter(r => r.generated_at > clearedAt) : rows
}

export function validISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export { seedHistory, type SeedRecord } from './rota_v2.ts'
