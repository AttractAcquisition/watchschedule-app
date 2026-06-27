// schedule-chat (backend.md §6.7) — Claude Q&A grounded STRICTLY in the vessel's
// own current schedule + fairness data. JWT-auth; vessel_id RE-DERIVED from the
// JWT; loads ONLY this vessel's rows (server-side tenant scoping) — it never
// accepts schedule data from the client and never reads another vessel's data.
// The Anthropic key never leaves the function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'
import { claudeChat, type ChatTurn } from '../_shared/anthropic.ts'

const initials = (full: string) => {
  const t = full.trim().split(/\s+/).filter(Boolean)
  if (t.length === 0) return '—'
  if (t.length === 1) return t[0].slice(0, 2).toUpperCase()
  return (t[0][0] + t[t.length - 1][0]).toUpperCase()
}
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dow = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]

const SYSTEM_BASE = `You are WatchSchedule's assistant — a tool for superyacht captains.
Answer ONLY from the VESSEL DATA provided below. Rules:
- Be concise and factual. Cite specific dates, crew initials, scores and counts.
- Wrap every cited datum (a date, crew initials, a score, a count) in backticks.
- When asked WHY someone is on a watch, use the recorded fairness EVENT for that
  date/crew (its reason_code + detail) — explain the actual recorded reason; never invent one.
- If the question cannot be answered from this data (e.g. weather, other vessels,
  anything not present), say plainly that it is not in this schedule's data. Do NOT fabricate.
- You only ever have THIS vessel's data; you cannot access any other vessel.`

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json(req, { error: 'unauthorized' }, 401)
    const userId = userData.user.id

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: vessel } = await admin.from('vessels').select('id,name').eq('owner_id', userId).maybeSingle()
    if (!vessel) return json(req, { error: 'vessel not found for user' }, 400)
    const vesselId = vessel.id as string

    const { message, history } = (await req.json()) as { message?: string; history?: ChatTurn[] }
    if (!message || typeof message !== 'string') return json(req, { error: 'message required' }, 400)

    // --- load ONLY this vessel's data (server-side tenant scoping) ---
    const [{ data: crewRows }, { data: laneRows }, { data: sched }] = await Promise.all([
      admin.from('crew_members').select('id,full_name,position,department').eq('vessel_id', vesselId),
      admin.from('watch_lanes').select('id,label,department,active').eq('vessel_id', vesselId),
      admin.from('schedules').select('id,start_date,end_date').eq('vessel_id', vesselId).eq('is_current', true).maybeSingle(),
    ])
    const crewById = new Map((crewRows ?? []).map((c) => [c.id, c]))
    const laneById = new Map((laneRows ?? []).map((l) => [l.id, l]))
    const crewLabel = (id: string | null) => { const c = id ? crewById.get(id) : null; return c ? `${initials(c.full_name)} (${c.full_name})` : '—' }
    const laneLabel = (id: string) => laneById.get(id)?.label ?? '—'

    let assignments: unknown[] = []
    let events: unknown[] = []
    if (sched) {
      const [{ data: asg }, { data: ev }] = await Promise.all([
        admin.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday').eq('schedule_id', sched.id).order('watch_date'),
        admin.from('fairness_events').select('lane_id,crew_id,watch_date,reason_code,detail').eq('schedule_id', sched.id).order('watch_date'),
      ])
      assignments = (asg ?? []).map((a) => ({ date: a.watch_date, day: dow(a.watch_date), lane: laneLabel(a.lane_id), crew: crewLabel(a.crew_id), is_friday: a.is_friday, day_type: a.day_type }))
      events = (ev ?? []).map((e) => {
        const d = (e.detail ?? {}) as { candidates?: { crew_id: string; cost: number }[]; excluded?: { crew_id: string; reason: string }[] }
        return {
          date: e.watch_date, day: e.watch_date ? dow(e.watch_date) : null, lane: laneLabel(e.lane_id), crew: crewLabel(e.crew_id), reason_code: e.reason_code,
          candidates: (d.candidates ?? []).map((c) => ({ crew: crewLabel(c.crew_id), cost: c.cost })),
          excluded: (d.excluded ?? []).map((x) => ({ crew: crewLabel(x.crew_id), reason: x.reason })),
        }
      })
    }
    const { data: ledger } = await admin.from('fairness_ledger').select('lane_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,weekday_opportunities,weekend_opportunities,friday_opportunities,last_watch_date,consecutive_run,fairness_score').eq('vessel_id', vesselId)
    // C2 — include opportunity denominators so the assistant explains fairness from
    // honest RATES ("stood X of Y available weekends"), not absolute counts.
    const ledgerCtx = (ledger ?? []).map((l) => ({ lane: laneLabel(l.lane_id), crew: crewLabel(l.crew_id), total_watches: l.total_watches, weekday_watches: l.weekday_watches, weekend_watches: l.weekend_watches, friday_watches: l.friday_watches, weekday_opportunities: l.weekday_opportunities, weekend_opportunities: l.weekend_opportunities, friday_opportunities: l.friday_opportunities, last_watch_date: l.last_watch_date, consecutive_run: l.consecutive_run, fairness_score: l.fairness_score }))

    const context = {
      vessel_name: vessel.name,
      schedule: sched ? { start_date: sched.start_date, end_date: sched.end_date } : null,
      lanes: (laneRows ?? []).filter((l) => l.active).map((l) => ({ label: l.label, department: l.department })),
      crew: (crewRows ?? []).map((c) => ({ initials: initials(c.full_name), full_name: c.full_name, position: c.position, department: c.department })),
      assignments, fairness_ledger: ledgerCtx, fairness_events: events,
    }
    const system = `${SYSTEM_BASE}\n\n=== VESSEL DATA (JSON) ===\n${JSON.stringify(context)}`

    // history (sanitised) + current message
    const turns: ChatTurn[] = []
    for (const h of Array.isArray(history) ? history : []) {
      if ((h?.role === 'user' || h?.role === 'assistant') && typeof h.content === 'string') turns.push({ role: h.role, content: h.content })
    }
    turns.push({ role: 'user', content: message })

    const reply = await claudeChat({ system, messages: turns, maxTokens: 1024 })

    // optional persistence (so a conversation survives reloads)
    await admin.from('chat_messages').insert([
      { vessel_id: vesselId, role: 'user', content: message },
      { vessel_id: vesselId, role: 'assistant', content: reply },
    ])

    return json(req, { reply })
  } catch (err) {
    return json(req, { error: err instanceof Error ? err.message : 'unknown error' }, 500)
  }
})
