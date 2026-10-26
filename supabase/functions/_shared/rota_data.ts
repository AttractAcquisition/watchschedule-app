import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { type Ledger } from './fairness_engine.ts'
import { makeAvailability, type Crew, type LeaveRange } from './schedule_engine.ts'
import { seedHistory, type SeedRecord, canonicalHistory, replayGlobal, type HistoricalAssignment, type HistoricalOpportunity, type Opportunity, type RotaLane, type ScheduleVersion } from './rota_v2.ts'

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
  const [crewRows, laneRows, deptRows, leaveRows, charterRows] = await Promise.all([
    readAll(admin, 'crew_members', vesselId), readAll(admin, 'watch_lanes', vesselId), readAll(admin, 'lane_departments', vesselId),
    readAll(admin, 'crew_leave', vesselId), readAll(admin, 'charter_periods', vesselId),
  ])
  const crew = crewRows as (Crew & { full_name: string })[]
  const lanes: RotaLane[] = laneRows.filter(l => l.active).map(l => ({
    id: l.id, label: l.label, position: l.position,
    departments: deptRows.filter(d => d.lane_id === l.id).map(d => d.department),
  }))
  const leave: LeaveRange[] = leaveRows.filter(l => l.status === 'booked').map(l => ({ crew_id: l.crew_member_id, start: l.start_date, end: l.end_date }))
  const charters = charterRows.filter(c => c.status === 'booked').map(c => ({ start: c.start_date, end: c.end_date }))
  return { crew, lanes, laneRows, leave, charters }
}

export async function loadGlobalBase(admin: Admin, vesselId: string, before: string, inputs: Awaited<ReturnType<typeof loadRotaInputs>>) {
  const [scheduleRows, assignmentRows, seedResult, vesselResult] = await Promise.all([
    readAll(admin, 'schedules', vesselId), readAll(admin, 'watch_assignments', vesselId),
    admin.from('rota_seed').select('*').eq('vessel_id', vesselId).maybeSingle(),
    admin.from('vessels').select('fairness_reset_at').eq('id', vesselId).single(),
  ])
  if (seedResult.error) throw seedResult.error
  if (vesselResult.error) throw vesselResult.error
  const seed = seedResult.data
  const resetAt = vesselResult.data.fairness_reset_at as string | null
  const versions = (scheduleRows as (ScheduleVersion & { rota_snapshot: { lanes?: RotaLane[]; opportunities?: Opportunity[]; history_estimated?: boolean } | null })[])
    .filter(s => !resetAt || s.generated_at > resetAt)
  const assignments = assignmentRows as HistoricalAssignment[]
  const opportunities: HistoricalOpportunity[] = []
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
  const past = canonicalHistory(versions, assignments, opportunities, before)
  const unpaused = (r: Opportunity) => !inputs.charters.some(c => c.start <= r.watch_date && r.watch_date <= c.end)
  past.assignments = past.assignments.filter(unpaused)
  past.opportunities = past.opportunities.filter(unpaused)
  estimated ||= past.opportunities.some(o => o.estimated)
  const generatedDates = new Set(past.opportunities.map(o => o.watch_date))
  for (const a of past.assignments) generatedDates.add(a.watch_date)
  const imported = seedHistory((seed?.records ?? []).filter((r: SeedRecord) => !generatedDates.has(r.watch_date)), before)
  const baseline: Ledger = seed?.baseline ?? {}
  const beyondSeed = (r: Opportunity) => !baseline[r.crew_id]?.last_watch_date || r.watch_date > baseline[r.crew_id].last_watch_date!
  const currentIds = new Set(inputs.crew.map(c => c.id))
  const ledger = replayGlobal(
    Object.fromEntries(Object.entries(baseline).filter(([id]) => currentIds.has(id))),
    [...imported.assignments, ...past.assignments.filter(beyondSeed)].filter(a => currentIds.has(a.crew_id)),
    [...imported.opportunities, ...past.opportunities.filter(beyondSeed)].filter(o => currentIds.has(o.crew_id)),
  )
  return { ledger, estimated, legacySnapshots }
}

export function validISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export { seedHistory, type SeedRecord } from './rota_v2.ts'
