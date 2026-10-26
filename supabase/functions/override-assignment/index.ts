// override-assignment — change who stands one lane's watch on one day, then
// recompute fairness from the amended rota (docs/manual-override.md).
//
// Two modes on one contract, so the browser never holds a copy of the rules:
//   { watch_date, lane_id }                      -> the pickable crew, each with
//                                                   the rules their selection breaks
//   { watch_date, lane_id, crew_id, acknowledge } -> apply (crew_id null clears)
//
// Invariants kept: vessel_id is re-derived from the JWT; the schedule and
// fairness tables are written only here, via the service-role RPC; the fairness
// numbers are the ordinary replay (rota_data + rota_v2), not a second formula.
import { handlePreflight, json } from '../_shared/cors.ts'
import { rotaContext, loadRotaInputs, loadGlobalBase, validISODate } from '../_shared/rota_data.ts'
import { canonicalHistory, globalScores, type HistoricalAssignment, type RotaLane, type ScheduleVersion } from '../_shared/rota_v2.ts'
import { isoWeekday } from '../_shared/fairness_engine.ts'
import { blockFor, checkOverride, FAR_FUTURE, type OverrideCrew, type Violation } from '../_shared/manual_override.ts'
import type { WeekendStructure } from '../_shared/schedule_engine.ts'

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Snapshot {
  lanes?: RotaLane[]
  scheduled_dates?: string[]
  weekend_structure?: WeekendStructure
}

Deno.serve(async req => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const { admin, vesselId, revision } = await rotaContext(req)
    const body = await req.json().catch(() => ({})) as {
      watch_date?: string; lane_id?: string; crew_id?: string | null; acknowledge?: string[]; apply?: boolean
    }
    const watchDate = body.watch_date ?? ''
    const laneId = body.lane_id ?? ''
    if (!validISODate(watchDate) || !UUID.test(laneId)) throw new Error('Pick a day and a watch lane to change.')

    const { data: schedule, error: se } = await admin.from('schedules')
      .select('id,start_date,end_date,rota_snapshot').eq('vessel_id', vesselId).eq('is_current', true).maybeSingle()
    if (se) throw se
    if (!schedule) throw new Error('Generate a schedule before changing it.')

    const inputs = await loadRotaInputs(admin, vesselId)
    const snapshot = (schedule.rota_snapshot ?? {}) as Snapshot
    const lane = (snapshot.lanes?.length ? snapshot.lanes : inputs.lanes).find(l => l.id === laneId)
    if (!lane) throw new Error('That watch lane is not part of the current schedule.')

    const { data: scheduleRows, error: ae } = await admin.from('watch_assignments')
      .select('schedule_id,lane_id,crew_id,watch_date').eq('schedule_id', schedule.id)
    if (ae) throw ae
    const dated = new Set<string>(snapshot.scheduled_dates ?? scheduleRows.map(r => r.watch_date as string))
    // A charter booked after generation pauses the rota; those days are no
    // longer stood and must not be editable.
    const paused = (d: string) => inputs.charters.some(c => c.start <= d && d <= c.end)
    const scheduled = (d: string) => dated.has(d) && !paused(d)

    // The whole block moves together: a weekend block has one watchkeeper by
    // construction, so reassigning half of it is not a rota the engine can produce.
    const structure: WeekendStructure = snapshot.weekend_structure ?? 'per_day'
    const days = blockFor(watchDate, schedule.start_date, schedule.end_date, structure, scheduled)
    if (!days.length) throw new Error('That day is not part of the current schedule.')

    // Who stands what around the block, across EVERY schedule version (the same
    // per-date winner rule as the fairness replay) plus any imported history —
    // minus the rows this change replaces.
    const from = addDays(days[0], -9)
    const to = addDays(days[days.length - 1], 9)
    const [near, versions, seed] = await Promise.all([
      admin.from('watch_assignments').select('schedule_id,lane_id,crew_id,watch_date').eq('vessel_id', vesselId).gte('watch_date', from).lte('watch_date', to),
      admin.from('schedules').select('id,start_date,end_date,generated_at').eq('vessel_id', vesselId),
      admin.from('rota_seed').select('records').eq('vessel_id', vesselId).maybeSingle(),
    ])
    for (const r of [near, versions, seed]) if (r.error) throw r.error
    const replaced = new Set(days.map(d => `${laneId}:${d}`))
    const canonical = canonicalHistory(
      (versions.data ?? []) as ScheduleVersion[], (near.data ?? []) as HistoricalAssignment[], [], FAR_FUTURE,
    ).assignments.filter(a => !(a.schedule_id === schedule.id && replaced.has(`${a.lane_id}:${a.watch_date}`)))
    const standing = new Set(canonical.map(a => `${a.crew_id}:${a.watch_date}`))
    for (const r of (seed.data?.records ?? []) as { crew_id: string; watch_date: string; assigned: boolean }[]) {
      if (r.assigned && r.watch_date >= from && r.watch_date <= to && !dated.has(r.watch_date)) standing.add(`${r.crew_id}:${r.watch_date}`)
    }
    const stood = (crewId: string, date: string) => standing.has(`${crewId}:${date}`)

    const current = scheduleRows.find(r => r.lane_id === laneId && r.watch_date === days[0])?.crew_id as string | undefined
    const check = (crew: OverrideCrew) => checkOverride({
      crew, days, laneDepartments: lane.departments, laneLabel: lane.label, structure,
      leave: inputs.leave, scheduled, stood,
    })
    const context = {
      schedule_id: schedule.id, lane_id: laneId, lane_label: lane.label, lane_departments: lane.departments,
      days, current_crew_id: current ?? null,
    }

    // --- Mode 1: what can this cell become? -------------------------------
    if (!('crew_id' in body) && !body.apply) {
      const pool = new Set(inputs.crew.filter(c => c.department && lane.departments.includes(c.department)).map(c => c.id))
      const options = (inputs.crew as OverrideCrew[])
        .map(crew => ({ crew_id: crew.id, full_name: crew.full_name, in_lane: pool.has(crew.id), ...check(crew) }))
        .sort((a, b) => Number(b.in_lane) - Number(a.in_lane)
          || a.blockers.length - b.blockers.length
          || a.violations.length - b.violations.length
          || a.full_name.localeCompare(b.full_name))
      return json(req, { ...context, options })
    }

    // --- Mode 2: apply ----------------------------------------------------
    const crewId = body.crew_id ?? null
    if (crewId !== null && !UUID.test(crewId)) throw new Error('Pick a crew member.')
    const crew = crewId ? (inputs.crew as OverrideCrew[]).find(c => c.id === crewId) : null
    if (crewId && !crew) throw new Error('That crew member is not on this vessel.')
    if (crewId === (current ?? null)) throw new Error(crewId ? 'That is already who stands this watch.' : 'That watch is already unassigned.')

    let violations: Violation[] = []
    if (crew) {
      const result = check(crew)
      // Consent and refusal are ordinary answers, not transport failures: the
      // browser needs the detail, so they come back 200 with a flag.
      if (result.blockers.length) return json(req, { ...context, blocked: true, crew_id: crewId, blockers: result.blockers })
      violations = result.violations
      const acknowledged = new Set(body.acknowledge ?? [])
      if (violations.some(v => !acknowledged.has(v.code))) {
        return json(req, { ...context, requires_consent: true, crew_id: crewId, violations })
      }
    }

    // Replay the amended rota exactly as generation would: the overridden days
    // carry the new watchkeeper, and the crew taking them gains the opportunity
    // for those days (they were available to stand them).
    const assignments = crewId
      ? days.map(d => ({
          schedule_id: schedule.id, lane_id: laneId, crew_id: crewId, watch_date: d,
          day_type: isoWeekday(d) >= 6 ? 'weekend' as const : 'weekday' as const, is_friday: isoWeekday(d) === 5,
        }))
      : []
    const patched = await loadGlobalBase(admin, vesselId, FAR_FUTURE, inputs, {
      assignments: rows => [
        ...rows.filter(r => !(r.schedule_id === schedule.id && replaced.has(`${r.lane_id}:${r.watch_date}`))),
        ...assignments,
      ],
      opportunities: crewId ? days.map(d => ({ crew_id: crewId, watch_date: d, schedule_id: schedule.id })) : [],
    })
    // The scored population is the engine's: everyone an active lane can draw
    // on, plus anyone standing a watch in the schedule being edited.
    const participants = [...new Set([
      ...inputs.lanes.flatMap(l => inputs.crew.filter(c => c.eligible && c.department && l.departments.includes(c.department)).map(c => c.id)),
      ...scheduleRows.filter(r => !replaced.has(`${r.lane_id}:${r.watch_date}`)).map(r => r.crew_id as string),
      ...assignments.map(a => a.crew_id),
    ])]
    const scores = globalScores(patched.ledger, participants)

    const { error: applyError } = await admin.rpc('apply_manual_override', {
      p_vessel: vesselId, p_revision: revision,
      p_plan: {
        schedule_id: schedule.id, lane_id: laneId, dates: days, crew_id: crewId,
        assignments, scores, history_estimated: patched.estimated,
        detail: {
          previous_crew_id: current ?? null, new_crew_id: crewId, block_days: days,
          lane_label: lane.label, acknowledged: violations.map(v => v.code), violations,
        },
      },
    })
    if (applyError) throw applyError
    return json(req, { ...context, applied: true, crew_id: crewId, acknowledged: violations.map(v => v.code), fairness: scores })
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Could not change that watch'
    return json(req, { error: message }, message === 'Unauthorized' ? 401 : 400)
  }
})
