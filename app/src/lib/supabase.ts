// Shared @supabase/supabase-js v2 client (frontend.md §1, master.md §2).
// One instance for the whole app, initialised from PUBLIC build-time env: the
// project URL + anon/publishable key only. The client NEVER holds the Stripe
// secret, the service-role key, or the Anthropic key (invariant §2.5) — those
// live only in Edge Functions. RLS is the real access gate; this client is the
// anon-scoped reader/writer subject to it.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'
import { callbackIntent, createAuthState } from '../auth/authState'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear message rather than a cryptic createClient throw.
  // Copy app/.env.example to app/.env and fill in the public values.
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in app/.env (see app/.env.example).'
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
})

export const authState = createAuthState(supabase.auth, {
  url: () => new URL(window.location.href),
  replace: path => window.history.replaceState(window.history.state, '', path),
  get storage() { return window.sessionStorage },
})
// A callback pasted/clicked while already on the exact same SPA path can be a
// fragment-only navigation. auth-js consumes URLs at initialization, so reload
// that document and let the SDK handle it once, rather than manually parsing
// credentials or leaving them in a live page's URL.
const onCallbackHashChange = () => {
  if (window.location.hash) {
    const intent = callbackIntent(new URL(window.location.href))
    if (intent.callback || intent.recovery) window.location.reload()
  }
}
window.addEventListener('hashchange', onCallbackHashChange)
if (import.meta.hot) import.meta.hot.dispose(() => {
  authState.dispose()
  window.removeEventListener('hashchange', onCallbackHashChange)
})
