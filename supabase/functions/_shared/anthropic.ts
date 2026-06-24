// Shared Anthropic (Claude) client for Edge Functions (master.md §2 invariant 8:
// Claude is called ONLY from the server; the API key never reaches the client).
// Used by parse-crew-list now, and later by seed-fairness + schedule-chat.
// Model + key come from Edge secrets (backend.md §5): ANTHROPIC_MODEL, ANTHROPIC_API_KEY.

export interface ClaudeBlock {
  type: string
  text?: string
}

// Calls the Messages API and returns the concatenated text output.
// `content` is the user-message content array (text and/or image blocks).
export async function claudeMessages(opts: {
  content: unknown[]
  system?: string
  maxTokens?: number
}): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 2048,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.content }],
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`anthropic ${res.status}: ${detail}`)
  }
  const data = (await res.json()) as { content?: ClaudeBlock[] }
  return (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// Multi-turn chat: a separate `system` prompt + a full messages array (history +
// current). Used by schedule-chat. Returns the assistant's text.
export async function claudeChat(opts: {
  system: string
  messages: ChatTurn[]
  maxTokens?: number
}): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  const model = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens ?? 1024, system: opts.system, messages: opts.messages }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content?: ClaudeBlock[] }
  return (data.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
}

// Defensively extract a JSON object/array from a model reply that may be wrapped
// in prose or ```json fences. Returns the parsed value or throws.
export function parseJsonLoose<T>(raw: string): T {
  let text = raw.trim()
  // strip leading/trailing code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  // fall back to the outermost {...} or [...] span
  const firstObj = text.indexOf('{')
  const firstArr = text.indexOf('[')
  const start = firstArr !== -1 && (firstArr < firstObj || firstObj === -1) ? firstArr : firstObj
  const lastObj = text.lastIndexOf('}')
  const lastArr = text.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1)
  return JSON.parse(text) as T
}
