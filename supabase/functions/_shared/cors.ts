// Shared CORS for the browser-invoked Edge Functions (backend.md §6).
// ORIGIN ALLOWLIST (never "*", because several functions are authenticated and
// some touch Stripe): the request's Origin is echoed back ONLY if it's on the
// allowlist. Local dev (Vite) and production work out of the box; extra origins
// can be added via env (APP_URL / CORS_EXTRA_ORIGIN) without a code change.
// The Stripe webhook is server-to-server and does not use these helpers.
const STATIC_ALLOWED = [
  'http://localhost:5173', // Vite dev
  'https://app.watchschedule.com', // production
]

function allowedOrigins(): string[] {
  const extra = [Deno.env.get('APP_URL'), Deno.env.get('CORS_EXTRA_ORIGIN')].filter((o): o is string => !!o)
  return [...new Set([...STATIC_ALLOWED, ...extra])]
}

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

// Per-request CORS headers. Echoes the caller's Origin only when allowlisted;
// otherwise no Access-Control-Allow-Origin is set (the browser then blocks it).
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = allowedOrigins().includes(origin)
  return { ...BASE_HEADERS, ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}) }
}

// Preflight short-circuit. Return from the function immediately if non-null.
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }
  return null
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}
