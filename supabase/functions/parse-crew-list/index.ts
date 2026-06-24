// parse-crew-list (backend.md §6.4)
// OCR + department classification of an uploaded crew-list image.
// Auth: user JWT. vessel_id is RE-DERIVED from the JWT (never trusted from the
// client); the requested object_path MUST live under the caller's vessel folder.
// Service-role reads the image from the private crew-lists bucket and sends it to
// Claude vision. Returns parsed CANDIDATES only — writes NO crew rows; the
// captain confirms in the UI.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { claudeMessages, parseJsonLoose } from '../_shared/anthropic.ts'
import { classifyDepartment, isDepartment, type Department } from '../_shared/classify.ts'

interface Candidate {
  full_name: string
  position: string
  department: Department
}

const MEDIA: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

const PROMPT = `You are extracting a superyacht crew list from an image.
Return ONLY JSON — no prose, no markdown, no code fences.
Shape exactly:
{"crew":[{"full_name":"string","position":"string","department":"deck|interior|engineering|officer"}]}
Rules:
- Extract every visible crew member (name + position/rank).
- Classify each into EXACTLY one department: deck, interior, engineering, or officer.
- Engineers/ETO -> engineering. Captain/officers/mates -> officer. Stew/chef/service -> interior. Deckhands/bosun -> deck.
- If a position is ambiguous, choose the closest department. Never invent crew that are not in the image.`

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre

  try {
    // --- Authenticate; re-derive vessel from the JWT. ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )
    const { data: vessel } = await admin.from('vessels').select('id').eq('owner_id', userData.user.id).maybeSingle()
    if (!vessel) return json({ error: 'vessel not found for user' }, 400)

    const { object_path } = (await req.json()) as { object_path?: string }
    if (!object_path) return json({ error: 'object_path required' }, 400)
    // Security: the path must be inside THIS vessel's folder. Never read another
    // vessel's object regardless of what the client sends.
    if (!object_path.startsWith(`${vessel.id}/`)) {
      return json({ error: 'object_path outside caller vessel' }, 403)
    }

    const ext = object_path.split('.').pop()?.toLowerCase() ?? ''
    const mediaType = MEDIA[ext]
    if (!mediaType) return json({ error: `unsupported image type: .${ext}` }, 400)

    // --- Read the image (service-role) and send to Claude vision. ---
    const { data: blob, error: dlErr } = await admin.storage.from('crew-lists').download(object_path)
    if (dlErr || !blob) return json({ error: `could not read image: ${dlErr?.message ?? 'not found'}` }, 400)
    const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))

    const reply = await claudeMessages({
      maxTokens: 4096,
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: PROMPT },
      ],
    })

    // --- Parse + normalise. Department always coerced into the enum. ---
    const parsed = parseJsonLoose<{ crew?: unknown[] }>(reply)
    const rows = Array.isArray(parsed.crew) ? parsed.crew : []
    const crew: Candidate[] = rows
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>
        const full_name = String(o.full_name ?? o.name ?? '').trim()
        const position = String(o.position ?? '').trim()
        const department = isDepartment(o.department) ? o.department : classifyDepartment(position)
        return { full_name, position, department }
      })
      .filter((c) => c.full_name.length > 0)

    return json({ crew })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return json({ error: message }, 500)
  }
})
