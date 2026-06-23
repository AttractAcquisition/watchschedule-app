// Shared CORS for the browser-invoked Edge Functions (backend.md §6: "CORS
// enabled for the app origin"). The Stripe webhook is server-to-server and does
// not use these. APP_URL is the single allowed origin; we echo it rather than
// using "*" so credentials/headers stay scoped to the app.
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.watchschedule.com'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': APP_URL,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

// Preflight short-circuit. Return from the function immediately if non-null.
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
