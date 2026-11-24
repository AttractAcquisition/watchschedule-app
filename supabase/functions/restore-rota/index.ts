// restore-rota — clear the calendar, put it back, or make an older generation
// live again (docs/calendar-restore.md).
//
// Three operations that share a shape: set some rota state, then rewrite
// fairness from the ordinary replay. Nothing here deletes a watch — a clear is
// a reversible marker, and a restore COPIES a version forward rather than
// rewriting an old row's timestamp to win the per-date winner rule.
//
// Invariants kept: vessel_id re-derived from the JWT; the schedule and fairness
// tables written only through the service-role RPC; fairness is the ordinary
// replay (rota_data + rota_v2), never a second formula.
import { handlePreflight, json } from '../_shared/cors.ts'
import { rotaContext, loadRotaInputs, loadGlobalBase, type RotaPatch } from '../_shared/rota_data.ts'
import { globalScores, type HistoricalAssignment } from '../_shared/rota_v2.ts'
import { FAR_FUTURE } from '../_shared/manual_override.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Action = 'clear_calendar' | 'restore_calendar' | 'restore_version'

Deno.serve(async req => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const { admin, vesselId, revision } = await rotaContext(req)
    const body = await req.json().catch(() => ({})) as { action?: Action; source_schedule_id?: string }
    const action = body.action
    if (action !== 'clear_calendar' && action !== 'restore_calendar' && action !== 'restore_version') {
      throw new Error('Unknown action.')
    }

    const source = body.source_schedule_id ?? ''
    if (action === 'restore_version') {
      if (!UUID.test(source)) throw new Error('Pick a schedule version to restore.')
      const { data: version, error } = await admin.from('schedules')
        .select('id,start_date,end_date,is_current').eq('vessel_id', vesselId).eq('id', source).maybeSingle()
      if (error) throw error
      if (!version) throw new Error('That schedule version is not on this vessel.')
      if (version.is_current) throw new Error('That version is already the live schedule.')
    }

    // Fairness after the change. A clear leaves nothing to score, so the plan
    // carries no scores and the RPC empties the table instead.
    let scores: unknown[] = []
    let estimated = false
    if (action !== 'clear_calendar') {
      const inputs = await loadRotaInputs(admin, vesselId)
      // Both operations lift the clear marker, so the replay prices the rota it
      // is about to produce rather than the empty one the marker still
      // describes. Nothing is written until the RPC runs.
      const patch: RotaPatch = { liftCalendarClear: true }
      if (action === 'restore_version') {
        // Price the copy before it exists: the restored version is about to own
        // its dates, so the replay needs its rows under a pending id.
        const [{ data: rows, error: re }, { data: v, error: se }] = await Promise.all([
          admin.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday').eq('schedule_id', source).eq('vessel_id', vesselId),
          admin.from('schedules').select('start_date,end_date,rota_snapshot').eq('id', source).single(),
        ])
        if (re) throw re
        if (se) throw se
        const pending = 'pending-restore'
        patch.versions = existing => [
          ...existing,
          { id: pending, start_date: v.start_date, end_date: v.end_date, generated_at: new Date().toISOString() },
        ]
        patch.assignments = existing => [
          ...existing,
          ...((rows ?? []) as Omit<HistoricalAssignment, 'schedule_id'>[]).map(r => ({ ...r, schedule_id: pending })),
        ]
      }
      const base = await loadGlobalBase(admin, vesselId, FAR_FUTURE, inputs, patch)
      const participants = [...new Set(
        inputs.lanes.flatMap(l => inputs.crew.filter(c => c.eligible && c.department && l.departments.includes(c.department)).map(c => c.id)),
      )]
      scores = globalScores(base.ledger, participants)
      estimated = base.estimated
    }

    const { data: result, error: applyError } = await admin.rpc('apply_rota_restore', {
      p_vessel: vesselId, p_revision: revision,
      p_plan: { action, source_schedule_id: action === 'restore_version' ? source : null, scores, history_estimated: estimated },
    })
    if (applyError) throw applyError
    return json(req, { applied: true, action, ...(result ?? {}), fairness: scores })
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Could not change the rota'
    return json(req, { error: message }, message === 'Unauthorized' ? 401 : 400)
  }
})
