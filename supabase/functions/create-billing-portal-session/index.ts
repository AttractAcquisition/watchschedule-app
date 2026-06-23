// create-billing-portal-session (backend.md §6.3)
// Opens the Stripe Billing Portal for the caller's stored customer.
// Auth: user JWT required; the customer is derived from the caller's profile
// (never from the client). return_url = {APP_URL}/settings.
//
// PENDING VERIFICATION: undeployed/unverified until Stripe test creds exist.
// See PHASE3_PENDING.md.
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.watchschedule.com'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

    // RLS-scoped read of the caller's own profile row.
    const { data: profile, error: pErr } = await userClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (pErr) return json({ error: pErr.message }, 500)
    if (!profile?.stripe_customer_id) return json({ error: 'no billing customer on file' }, 400)

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${APP_URL}/settings`,
    })

    return json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return json({ error: message }, 500)
  }
})
