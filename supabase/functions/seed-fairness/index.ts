// Historical service is imported once per person/date, independent of lanes.
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { claudeMessages, parseJsonLoose } from '../_shared/anthropic.ts'
import { makeAvailability } from '../_shared/schedule_engine.ts'
import { globalScores, replayGlobal } from '../_shared/rota_v2.ts'
import { rotaContext, loadRotaInputs, seedHistory, validISODate, type SeedRecord } from '../_shared/rota_data.ts'
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


function matchCrew(name: string, crew: { id: string; full_name: string }[]): string | null {
  const r = norm(name)
  if (!r) return null
  const exact = crew.filter(c => norm(c.full_name) === r)
  if (exact.length) return exact.length === 1 ? exact[0].id : null
  const partial = crew.filter(c => {
    const tokens = norm(c.full_name).split(' ')
    return tokens.includes(r) || tokens.map(t => t[0]).join('') === r
  })
  return partial.length === 1 ? partial[0].id : null
}
Deno.serve(async req => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const { admin, vesselId, revision, tier } = await rotaContext(req)
    if (tier === 'solo') return json(req, { error: 'History import is included with Dual and Triple.' }, 403)
    const { object_paths } = await req.json() as { object_paths?: string[] }
    if (!Array.isArray(object_paths) || !object_paths.length || object_paths.length > 20) throw new Error('Upload between 1 and 20 images.')
    for (const p of object_paths) if (typeof p !== 'string' || !p.startsWith(`${vesselId}/`) || p.includes('..')) throw new Error('Invalid upload path')
    // --- Claude vision extraction across all images ---
    const records: HistRecord[] = []
    for (const path of object_paths) {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const mediaType = MEDIA[ext]
      if (!mediaType) return json(req, { error: `unsupported image type: .${ext}` }, 400)
      const { data: blob, error: dlErr } = await admin.storage.from('past-schedules').download(path)
      if (dlErr || !blob) return json(req, { error: `could not read image: ${dlErr?.message ?? 'not found'}` }, 400)
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


    const inputs = await loadRotaInputs(admin, vesselId)
    const today = new Date().toISOString().slice(0, 10)
    const unmatched = new Set<string>()
    const assigned = new Map<string, SeedRecord>()
    for (const record of records) {
      if (!validISODate(record.date) || record.date >= today) { unmatched.add(`${record.crew_name} (${record.date}: not a past date)`); continue }
      const id = matchCrew(record.crew_name, inputs.crew)
      if (!id) { unmatched.add(record.crew_name); continue }
      assigned.set(`${id}:${record.date}`, { crew_id: id, watch_date: record.date, assigned: true })
    }
    if (!assigned.size) throw new Error('No unambiguous past watches matched your crew. Nothing was changed.')
    const available = makeAvailability(inputs.crew, inputs.leave)
    // Historical eligibility cannot be recovered from an image. Freeze an
    // explicit estimate using today's watched departments and known leave.
    const departments = new Set(inputs.lanes.flatMap(l => l.departments))
    const imported = new Map(assigned)
    for (const date of new Set([...assigned.values()].map(r => r.watch_date))) {
      for (const c of inputs.crew) if (c.eligible && c.department && departments.has(c.department) && available(c.id, date)) {
        const key = `${c.id}:${date}`
        if (!imported.has(key)) imported.set(key, { crew_id: c.id, watch_date: date, assigned: false })
      }
    }
    const seedRecords = [...imported.values()].sort((a,b) => a.watch_date.localeCompare(b.watch_date) || a.crew_id.localeCompare(b.crew_id))
    const { error } = await admin.rpc('replace_rota_seed', { p_vessel: vesselId, p_revision: revision, p_records: seedRecords })
    if (error) throw error
    const history = seedHistory(seedRecords, today)
    const balance = replayGlobal({}, history.assignments, history.opportunities)
    return json(req, { seeded: true, members: globalScores(balance, Object.keys(balance)), unmatched: [...unmatched], records_extracted: records.length, watches_imported: assigned.size, history_estimated: true })
  } catch (err) {
    return json(req, { error: err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Import failed' }, 400)
  }
})
