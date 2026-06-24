// seed-fairness  (alias: parse-past-schedule — ONE function) — backend.md §6.5,
// fairness.md §6. Seeds the PERSISTENT fairness ledger from uploaded past
// schedules so the first generated rota accounts for accumulated burden.
// Dual/Triple only. JWT-auth; vessel_id RE-DERIVED from the JWT; each object_path
// must live under the caller's vessel folder. Service-role reads the images and
// writes the seed. SET/replace (idempotent) — re-uploading recomputes & replaces.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { claudeMessages, parseJsonLoose } from '../_shared/anthropic.ts'
import { computeFairnessScore, zeroEntry, isoWeekday, type LedgerEntry } from '../_shared/fairness_engine.ts'

const MEDIA: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

const PROMPT = `You are extracting a historical superyacht watch schedule from an image.
Return ONLY JSON — no prose, no markdown, no code fences.
Shape exactly: {"records":[{"date":"YYYY-MM-DD","crew_name":"string","department":"deck|interior|engineering|officer|null"}]}
Each record = one crew member standing ONE watch on ONE date.
- Extract every visible (date, crew member) watch in the image. Use ISO dates (YYYY-MM-DD).
- If the crew member's department/role is shown, include it; otherwise null.
- Do NOT invent records that are not in the image.`

interface HistRecord { date: string; crew_name: string; department: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

// Fuzzy-match an extracted name to a crew member (best-effort): exact, surname,
// first name, or initials. Returns crew id or null.
function matchCrew(name: string, crew: { id: string; full_name: string }[]): string | null {
  const r = norm(name)
  if (!r) return null
  for (const c of crew) if (norm(c.full_name) === r) return c.id
  for (const c of crew) {
    const toks = norm(c.full_name).split(' ')
    const surname = toks[toks.length - 1]
    const initials = toks.map((t) => t[0]).join('')
    if (r === surname || r === toks[0] || r === initials) return c.id
    if (toks.includes(r)) return c.id
  }
  return null
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    const userId = userData.user.id

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    // reject Solo server-side
    const { data: profile } = await admin.from('profiles').select('product_tier').eq('id', userId).maybeSingle()
    if (!profile) return json({ error: 'profile not found' }, 400)
    if (profile.product_tier === 'solo') return json({ error: 'seeding is for Dual/Triple only' }, 403)

    const { data: vessel } = await admin.from('vessels').select('id').eq('owner_id', userId).maybeSingle()
    if (!vessel) return json({ error: 'vessel not found for user' }, 400)
    const vesselId = vessel.id as string

    const { object_paths } = (await req.json()) as { object_paths?: string[] }
    if (!Array.isArray(object_paths) || object_paths.length === 0) return json({ error: 'object_paths required' }, 400)
    for (const p of object_paths) {
      if (!p.startsWith(`${vesselId}/`)) return json({ error: 'object_path outside caller vessel' }, 403)
    }

    // --- Claude vision extraction across all images ---
    const records: HistRecord[] = []
    for (const path of object_paths) {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const mediaType = MEDIA[ext]
      if (!mediaType) return json({ error: `unsupported image type: .${ext}` }, 400)
      const { data: blob, error: dlErr } = await admin.storage.from('past-schedules').download(path)
      if (dlErr || !blob) return json({ error: `could not read image: ${dlErr?.message ?? 'not found'}` }, 400)
      const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))
      const reply = await claudeMessages({
        maxTokens: 8192,
        content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }, { type: 'text', text: PROMPT }],
      })
      const parsed = parseJsonLoose<{ records?: unknown[] }>(reply)
      for (const r of Array.isArray(parsed.records) ? parsed.records : []) {
        const o = (r ?? {}) as Record<string, unknown>
        const date = String(o.date ?? '').trim()
        const crew_name = String(o.crew_name ?? '').trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && crew_name) {
          records.push({ date, crew_name, department: typeof o.department === 'string' ? o.department : null })
        }
      }
    }

    // --- inputs for matching + lane mapping ---
    const { data: lanes } = await admin.from('watch_lanes').select('id,kind,department,active').eq('vessel_id', vesselId)
    const activeLanes = (lanes ?? []).filter((l) => l.active)
    const laneByDept = new Map<string, string>() // department -> lane_id
    for (const l of activeLanes) if (l.department) laneByDept.set(l.department, l.id)
    const { data: crewRows } = await admin.from('crew_members').select('id,full_name,department,eligible').eq('vessel_id', vesselId)
    const crew = (crewRows ?? []) as { id: string; full_name: string; department: string; eligible: boolean }[]

    // --- aggregate per (lane, crew) ---
    type Agg = { total: number; weekday: number; weekend: number; friday: number; dates: Set<string>; lastWeekend: string | null }
    const seed = new Map<string, Map<string, Agg>>() // lane_id -> crew_id -> agg
    const unmatchedSet = new Set<string>()
    for (const rec of records) {
      const crewId = matchCrew(rec.crew_name, crew)
      if (!crewId) { unmatchedSet.add(rec.crew_name); continue }
      const member = crew.find((c) => c.id === crewId)!
      const laneId = laneByDept.get(member.department)
      if (!laneId) continue // crew's department isn't a watched lane on this vessel
      const wd = isoWeekday(rec.date)
      const dayType = wd >= 6 ? 'weekend' : 'weekday'
      const isFriday = wd === 5
      if (!seed.has(laneId)) seed.set(laneId, new Map())
      const laneMap = seed.get(laneId)!
      if (!laneMap.has(crewId)) laneMap.set(crewId, { total: 0, weekday: 0, weekend: 0, friday: 0, dates: new Set(), lastWeekend: null })
      const a = laneMap.get(crewId)!
      a.total++; if (dayType === 'weekend') { a.weekend++; if (!a.lastWeekend || rec.date > a.lastWeekend) a.lastWeekend = rec.date } else { a.weekday++; if (isFriday) a.friday++ }
      a.dates.add(rec.date)
    }

    // consecutive_run (best-effort trailing run) + last_watch_date
    const trailingRun = (dates: Set<string>): { last: string; run: number } => {
      const sorted = [...dates].sort()
      const last = sorted[sorted.length - 1]
      let run = 1
      for (let i = sorted.length - 1; i > 0; i--) {
        const d = new Date(`${sorted[i]}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1)
        if (d.toISOString().slice(0, 10) === sorted[i - 1]) run++; else break
      }
      return { last, run }
    }

    // --- compute per-lane scores over the eligible pool, build rows ---
    const responseLanes: { lane_id: string; members: { crew_id: string; total_watches: number; weekend_watches: number; friday_watches: number; fairness_score: number }[] }[] = []
    const ledgerRows: Record<string, unknown>[] = []
    const nowISO = new Date().toISOString()
    for (const lane of activeLanes) {
      const laneMap = seed.get(lane.id) ?? new Map<string, Agg>()
      const pool = crew.filter((c) => c.eligible && c.department === lane.department)
      // entries for scoring: every pool member (seeded -> counts, else zero)
      const entries: LedgerEntry[] = pool.map((c) => {
        const a = laneMap.get(c.id)
        if (!a) return zeroEntry(c.id)
        const { last } = trailingRun(a.dates)
        return { crew_id: c.id, total_watches: a.total, weekday_watches: a.weekday, weekend_watches: a.weekend, friday_watches: a.friday, last_watch_date: last, last_weekend_date: a.lastWeekend, consecutive_run: trailingRun(a.dates).run }
      })
      const scores = new Map(computeFairnessScore(entries).map((s) => [s.crew_id, s.score]))
      const members: { crew_id: string; total_watches: number; weekend_watches: number; friday_watches: number; fairness_score: number }[] = []
      for (const c of pool) {
        const a = laneMap.get(c.id)
        if (!a) continue // only seed crew that have history
        const { last, run } = trailingRun(a.dates)
        const score = scores.get(c.id) ?? null
        ledgerRows.push({
          vessel_id: vesselId, lane_id: lane.id, crew_id: c.id,
          // live counters (pre-generation display == seed)
          total_watches: a.total, weekday_watches: a.weekday, weekend_watches: a.weekend, friday_watches: a.friday,
          last_watch_date: last, last_weekend_date: a.lastWeekend, consecutive_run: run,
          // immutable seed base
          seed_total_watches: a.total, seed_weekday_watches: a.weekday, seed_weekend_watches: a.weekend, seed_friday_watches: a.friday,
          seed_last_watch_date: last, seed_last_weekend_date: a.lastWeekend, seed_consecutive_run: run,
          fairness_score: score, updated_at: nowISO,
        })
        members.push({ crew_id: c.id, total_watches: a.total, weekend_watches: a.weekend, friday_watches: a.friday, fairness_score: score as number })
      }
      responseLanes.push({ lane_id: lane.id, members })
    }

    // --- SET/replace: clear the vessel's seed ledger, then insert (idempotent) ---
    await admin.from('fairness_ledger').delete().eq('vessel_id', vesselId)
    if (ledgerRows.length) {
      const ins = await admin.from('fairness_ledger').insert(ledgerRows)
      if (ins.error) return json({ error: `seed insert failed: ${ins.error.message}` }, 500)
    }

    // mark uploads parsed (replace prior past_schedule rows for idempotency)
    await admin.from('storage_uploads').delete().eq('vessel_id', vesselId).eq('kind', 'past_schedule')
    await admin.from('storage_uploads').insert(object_paths.map((p) => ({ vessel_id: vesselId, bucket: 'past-schedules', object_path: p, kind: 'past_schedule', parsed: true })))

    return json({ seeded: true, lanes: responseLanes, unmatched: [...unmatchedSet], records_extracted: records.length })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unknown error' }, 500)
  }
})
