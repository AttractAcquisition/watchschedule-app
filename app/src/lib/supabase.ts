// Shared @supabase/supabase-js v2 client (frontend.md §1, master.md §2).
// One instance for the whole app, initialised from PUBLIC build-time env: the
// project URL + anon/publishable key only. The client NEVER holds the Stripe
// secret, the service-role key, or the Anthropic key (invariant §2.5) — those
// live only in Edge Functions. RLS is the real access gate; this client is the
// anon-scoped reader/writer subject to it.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear message rather than a cryptic createClient throw.
  // Copy app/.env.example to app/.env and fill in the public values.
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in app/.env (see app/.env.example).'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
