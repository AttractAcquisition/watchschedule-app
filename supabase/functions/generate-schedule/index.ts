import { handlePreflight, json } from '../_shared/cors.ts'
import { rotaContext, loadRotaInputs, loadGlobalBase, validISODate } from '../_shared/rota_data.ts'
import { generationEnd, generationWindow, planGlobal, validateLanes } from '../_shared/rota_v2.ts'
import { isoWeekday } from '../_shared/fairness_engine.ts'
import { checkPins, enginePins, pinsNeedingConsent } from '../_shared/watch_pins.ts'

Deno.serve(async req => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const { admin, vesselId, revision, tier } = await rotaContext(req)
    const { data: settings, error } = await admin.from('watch_settings').select('*').eq('vessel_id', vesselId).single()
    if (error || !settings) throw new Error('Configure your watch lanes before generating.')
    const body = await req.json().catch(() => ({}))
    const today = new Date().toISOString().slice(0, 10)
    const { data: existing, error: ee } = await admin.from('schedules').select('id').eq('vessel_id', vesselId).limit(1)
    if (ee) throw ee
    // schedule.md §5.1 — weeks, a month, or an explicit range.
    const { start, endDate } = generationWindow(settings, today, !existing?.length && !body.regenerate)
    if (!validISODate(start) || (endDate && !validISODate(endDate))) throw new Error('Invalid generation window')
    const inputs = await loadRotaInputs(admin, vesselId)
    validateLanes(inputs.lanes, tier)
    const base = await loadGlobalBase(admin, vesselId, start, inputs)

    // docs/fixed-watches.md — the captain's pins, evaluated against the window
    // this run will build. The neighbour rules see facts only: another pin, or
    // a watch stood before `start`. Days this run has yet to plan are not facts.
    const end = generationEnd(start, settings.horizon_weeks, endDate)
    const scheduledDay = (d: string) =>
      !(isoWeekday(d) >= 6 && !settings.include_weekends) &&
      !inputs.charters.some(c => c.start <= d && d <= c.end)
    const pins = checkPins({
      pins: inputs.pins, crew: inputs.crew, lanes: inputs.lanes,
      structure: settings.weekend_structure ?? 'per_day', leave: inputs.leave,
      start, end, scheduled: scheduledDay,
      stoodBefore: (crewId, date) => base.stoodBefore.has(crewId + ':' + date),
    })
    // A read-only look at what generation would do with them, for the Advanced
    // panel and the regenerate dialog. Writes nothing.
    if (body.preview_pins) return json(req, { preview: true, start_date: start, end_date: end, pins })
    // Consent and refusal are answers, not transport failures.
    if (pinsNeedingConsent(pins).length) return json(req, { requires_pin_consent: true, pins })

    const plan = planGlobal({ startDate: start, endDate, settings, crew: inputs.crew, lanes: inputs.lanes, base: base.ledger, leave: inputs.leave, charters: inputs.charters, pins: enginePins(pins) })
    const { data: scheduleId, error: publishError } = await admin.rpc('publish_rota', {
      p_vessel: vesselId, p_revision: revision,
      p_plan: { ...plan, ledger: undefined, legacy_snapshots: base.legacySnapshots, snapshot: { lanes: inputs.lanes, opportunities: plan.opportunities, scheduled_dates: [...new Set(plan.events.map(e => e.watch_date))], weekend_structure: settings.weekend_structure ?? 'per_day', history_estimated: base.estimated }, history_estimated: base.estimated },
    })
    if (publishError) throw publishError
    return json(req, { schedule_id: scheduleId, start_date: plan.start_date, end_date: plan.end_date, assignments_count: plan.assignments.length, gaps: plan.gaps.length, fairness: plan.scores, engine_version: 2 })
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Could not generate schedule'
    return json(req, { error: message }, message === 'Unauthorized' ? 401 : 400)
  }
})
