import { handlePreflight, json } from '../_shared/cors.ts'
import { rotaContext, loadRotaInputs, loadGlobalBase } from '../_shared/rota_data.ts'
import { validateLanes } from '../_shared/rota_v2.ts'
import { recommendHorizon } from '../_shared/horizon_recommender.ts'

Deno.serve(async req => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const { admin, vesselId, tier } = await rotaContext(req)
    const { data: settings, error } = await admin.from('watch_settings').select('*').eq('vessel_id', vesselId).single()
    if (error || !settings) throw new Error('Configure your watch lanes before asking for a recommendation.')
    const inputs = await loadRotaInputs(admin, vesselId)
    validateLanes(inputs.lanes, tier)
    const today = new Date().toISOString().slice(0, 10)
    const { data: existing } = await admin.from('schedules').select('id').eq('vessel_id', vesselId).limit(1)
    const startDate = existing?.length ? today : settings.schedule_start_date
    const base = await loadGlobalBase(admin, vesselId, startDate, inputs)
    return json(req, recommendHorizon({ startDate, settings, lanes: inputs.lanes, crew: inputs.crew, base: base.ledger, leave: inputs.leave, charters: inputs.charters }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not calculate a horizon recommendation.'
    return json(req, { error: message }, message === 'Unauthorized' ? 401 : 400)
  }
})
