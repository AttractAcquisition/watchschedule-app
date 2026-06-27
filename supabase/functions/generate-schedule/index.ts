// generate-schedule (backend.md §6.6 + schedule.md)
// Runs the generation engine and persists the rota. JWT-auth; vessel_id is
// RE-DERIVED from the JWT (never trusted from the client). All writes use the
// service-role client (schedules / watch_assignments / fairness_ledger /
// fairness_events are SELECT-only for clients — Phase 1). First generation
// completes onboarding.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'
import {
  planSchedule, replayLedgers, type Crew, type LaneRow, type PlannedAssignment,
} from '../_shared/schedule_engine.ts'
import { type Ledger, type LedgerEntry } from '../_shared/fairness_engine.ts'

const todayUTC = () => new Date().toISOString().slice(0, 10)
const DEPT_LABEL: Record<string, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json(req, { error: 'unauthorized' }, 401)
    const userId = userData.user.id

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    const { data: vessel } = await admin.from('vessels').select('id').eq('owner_id', userId).maybeSingle()
    if (!vessel) return json(req, { error: 'vessel not found for user' }, 400)
    const vesselId = vessel.id as string

    const body = (await req.json().catch(() => ({}))) as { from_date?: string; regenerate?: boolean }
    const regenerate = body.regenerate === true

    // --- inputs ---
    const { data: settings } = await admin.from('watch_settings').select('*').eq('vessel_id', vesselId).maybeSingle()
    if (!settings) return json(req, { error: 'watch_settings not configured' }, 400)

    // active lanes only; derive + insert if none exist yet (defensive)
    let { data: lanes } = await admin.from('watch_lanes').select('id,kind,department,active').eq('vessel_id', vesselId)
    let activeLanes = (lanes ?? []).filter((l: LaneRow) => l.active)
    if (activeLanes.length === 0) {
      const desired = settings.tier === 'solo'
        ? [{ vessel_id: vesselId, kind: 'solo', department: null, label: 'Watch', active: true }]
        : (settings.selected_departments as string[]).map((d) => ({ vessel_id: vesselId, kind: 'dept', department: d, label: DEPT_LABEL[d] ?? d, active: true }))
      await admin.from('watch_lanes').insert(desired)
      lanes = (await admin.from('watch_lanes').select('id,kind,department,active').eq('vessel_id', vesselId)).data
      activeLanes = (lanes ?? []).filter((l: LaneRow) => l.active)
    }
    const activeLaneIds = activeLanes.map((l: LaneRow) => l.id)

    const { data: crewRows } = await admin.from('crew_members').select('id,department,eligible,available_from').eq('vessel_id', vesselId)
    const crew = (crewRows ?? []) as Crew[]

    // prior current schedule + its assignments (for is_current flip + replay)
    const { data: prior } = await admin.from('schedules').select('id').eq('vessel_id', vesselId).eq('is_current', true).maybeSingle()
    let priorAssignments: PlannedAssignment[] = []
    if (prior) {
      const { data: pa } = await admin.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday').eq('schedule_id', prior.id)
      priorAssignments = (pa ?? []) as PlannedAssignment[]
    }

    // resolve start (schedule.md §5/§7)
    const fromDate = body.from_date ?? (regenerate ? todayUTC() : settings.schedule_start_date)

    // SEED base = the immutable seed_* columns set by seed-fairness (Phase 8).
    // Never overwritten by generation, so it survives every regeneration intact
    // (schedule.md §7.1). Empty/zero when unseeded -> identical to Phase-7 behaviour.
    const { data: seedRows } = await admin
      .from('fairness_ledger')
      .select('lane_id,crew_id,seed_total_watches,seed_weekday_watches,seed_weekend_watches,seed_friday_watches,seed_last_watch_date,seed_last_weekend_date,seed_consecutive_run,seed_weekday_opportunities,seed_weekend_opportunities,seed_friday_opportunities')
      .eq('vessel_id', vesselId)
    const seed: Record<string, Ledger> = {}
    for (const r of seedRows ?? []) {
      const entry: LedgerEntry = {
        crew_id: r.crew_id, total_watches: r.seed_total_watches, weekday_watches: r.seed_weekday_watches,
        weekend_watches: r.seed_weekend_watches, friday_watches: r.seed_friday_watches,
        last_watch_date: r.seed_last_watch_date, last_weekend_date: r.seed_last_weekend_date, consecutive_run: r.seed_consecutive_run,
        // C2 — seeded opportunity base for the rate denominator (0 for unseeded vessels).
        weekday_opportunities: r.seed_weekday_opportunities, weekend_opportunities: r.seed_weekend_opportunities, friday_opportunities: r.seed_friday_opportunities,
      }
      ;(seed[r.lane_id] ??= {})[r.crew_id] = entry
    }

    // C2 — pools + available_from so replay tallies OPPORTUNITIES for the replayed
    // history consistently with the run (same bumpOpportunities). poolByLane mirrors
    // schedule_engine.eligiblePool (eligible crew in the lane).
    const availMap = new Map(crew.map((c) => [c.id, c.available_from]))
    const poolByLane = new Map<string, string[]>()
    for (const l of activeLanes as LaneRow[]) {
      const base = crew.filter((c) => c.eligible)
      const inLane = l.kind === 'solo' ? base : base.filter((c) => c.department === l.department)
      poolByLane.set(l.id, inLane.map((c) => c.id).sort())
    }

    // base = SEED + replay(already-stood assignments < fromDate). Avoids double-
    // counting the replaced forward portion on regenerate.
    const keptPast = priorAssignments.filter((a) => a.watch_date < fromDate)
    const baseLedgers = replayLedgers(activeLaneIds, keptPast, seed, poolByLane, availMap)

    // B7 — booked charter windows pause the rotation within their range (cancelled
    // charters are retained for history but do NOT affect generation).
    const { data: charterRows } = await admin
      .from('charter_periods').select('start_date,end_date').eq('vessel_id', vesselId).eq('status', 'booked')
    const charters = (charterRows ?? []).map((c) => ({ start: c.start_date, end: c.end_date }))

    const plan = planSchedule({
      startDate: fromDate,
      settings: {
        horizon_weeks: settings.horizon_weeks,
        include_weekends: settings.include_weekends,
        weekday_rotation_anchor: settings.weekday_rotation_anchor ?? 0,
        weekend_rotation_anchor: settings.weekend_rotation_anchor ?? 0,
        weekend_structure: settings.weekend_structure ?? 'per_day', // B6
      },
      crew,
      lanes: activeLanes as LaneRow[],
      baseLedgers,
      charters,
    })

    // --- persist (service-role) ---
    // flip any prior current schedule
    await admin.from('schedules').update({ is_current: false }).eq('vessel_id', vesselId).eq('is_current', true)

    const { data: sched, error: schedErr } = await admin.from('schedules').insert({
      vessel_id: vesselId, start_date: plan.start_date, end_date: plan.end_date, horizon_weeks: plan.horizon_weeks, is_current: true,
    }).select('id').single()
    if (schedErr || !sched) return json(req, { error: `schedule insert failed: ${schedErr?.message}` }, 500)
    const scheduleId = sched.id as string

    if (plan.assignments.length) {
      const rows = plan.assignments.map((a) => ({ schedule_id: scheduleId, vessel_id: vesselId, lane_id: a.lane_id, crew_id: a.crew_id, watch_date: a.watch_date, day_type: a.day_type, is_friday: a.is_friday }))
      const ins = await admin.from('watch_assignments').insert(rows)
      if (ins.error) return json(req, { error: `assignments insert failed: ${ins.error.message}` }, 500)
    }

    // fairness_ledger upsert (final cumulative state + score)
    const scoreMap = new Map<string, Map<string, number>>()
    for (const ls of plan.scores) scoreMap.set(ls.lane_id, new Map(ls.members.map((m) => [m.crew_id, m.fairness_score])))
    const ledgerRows: Record<string, unknown>[] = []
    for (const [laneId, led] of Object.entries(plan.ledgers)) {
      for (const e of Object.values(led)) {
        ledgerRows.push({
          vessel_id: vesselId, lane_id: laneId, crew_id: e.crew_id,
          total_watches: e.total_watches, weekday_watches: e.weekday_watches, weekend_watches: e.weekend_watches, friday_watches: e.friday_watches,
          last_watch_date: e.last_watch_date, last_weekend_date: e.last_weekend_date, consecutive_run: e.consecutive_run,
          // C2 — persist opportunity denominators (one source of truth for the rate + honest chatbot "X of Y").
          weekday_opportunities: e.weekday_opportunities, weekend_opportunities: e.weekend_opportunities, friday_opportunities: e.friday_opportunities,
          fairness_score: scoreMap.get(laneId)?.get(e.crew_id) ?? null, updated_at: new Date().toISOString(),
        })
      }
    }
    if (ledgerRows.length) {
      const up = await admin.from('fairness_ledger').upsert(ledgerRows, { onConflict: 'lane_id,crew_id' })
      if (up.error) return json(req, { error: `ledger upsert failed: ${up.error.message}` }, 500)
    }

    if (plan.events.length) {
      const evRows = plan.events.map((ev) => ({ vessel_id: vesselId, schedule_id: scheduleId, lane_id: ev.lane_id, crew_id: ev.crew_id, watch_date: ev.watch_date, reason_code: ev.reason_code, detail: ev.detail }))
      const ev = await admin.from('fairness_events').insert(evRows)
      if (ev.error) return json(req, { error: `events insert failed: ${ev.error.message}` }, 500)
    }

    // first generation completes onboarding
    const { data: profile } = await admin.from('profiles').select('onboarding_complete').eq('id', userId).maybeSingle()
    if (profile && !profile.onboarding_complete) {
      await admin.from('profiles').update({ onboarding_complete: true, onboarding_step: 'complete' }).eq('id', userId)
    }

    return json(req, {
      schedule_id: scheduleId, start_date: plan.start_date, end_date: plan.end_date,
      assignments_count: plan.assignments.length, gaps: plan.gaps.length, fairness: plan.scores,
    })
  } catch (err) {
    return json(req, { error: err instanceof Error ? err.message : 'unknown error' }, 500)
  }
})
