// create-checkout-session (backend.md §6.1)
// Starts a Stripe Checkout (subscription mode) for the caller's chosen tier.
// Auth: user JWT required. vessel_id is RE-DERIVED from the JWT — never trusted
// from the client (invariant §9). Secrets (Stripe key + the 6 price ids) are
// read from the Edge env (backend.md §5); nothing is hardcoded.
//
// PENDING VERIFICATION: this function is undeployed and unverified until Stripe
// test credentials are provided. See PHASE3_PENDING.md.
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'

type Tier = 'solo' | 'dual' | 'triple'
type Interval = 'month' | 'year'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.watchschedule.com'

// (tier, interval) -> the canonical price-secret env name (backend.md §5).
const PRICE_ENV: Record<Tier, Record<Interval, string>> = {
  solo: { month: 'STRIPE_PRICE_SOLO_MONTH', year: 'STRIPE_PRICE_SOLO_YEAR' },
  dual: { month: 'STRIPE_PRICE_DUAL_MONTH', year: 'STRIPE_PRICE_DUAL_YEAR' },
  triple: { month: 'STRIPE_PRICE_TRIPLE_MONTH', year: 'STRIPE_PRICE_TRIPLE_YEAR' },
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    // --- Authenticate the caller and re-derive identity from the JWT. ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    )
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    const user = userData.user

    const { tier, interval } = (await req.json()) as { tier?: Tier; interval?: Interval }
    if (!tier || !PRICE_ENV[tier]) return json({ error: 'invalid tier' }, 400)
    if (interval !== 'month' && interval !== 'year') return json({ error: 'invalid interval' }, 400)

    const priceId = Deno.env.get(PRICE_ENV[tier][interval])
    if (!priceId) return json({ error: `price not configured: ${PRICE_ENV[tier][interval]}` }, 500)

    // --- Re-derive vessel_id server-side (service-role; never trust client). ---
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )
    const { data: vessel, error: vErr } = await admin
      .from('vessels')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle()
    if (vErr || !vessel) return json({ error: 'vessel not found for user' }, 400)
    const vesselId = vessel.id

    // --- Find or create the Stripe customer for this user. ---
    // We read any previously-stored customer id; otherwise create one and store
    // it via service-role (backend.md §6.1). NOTE: §2.2's profiles note says
    // stripe_* is webhook-written only — see PHASE3_PENDING.md "SURFACE" item;
    // followed §6.1 here. payment_status / product_tier are NEVER written here.
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', user.id)
      .maybeSingle()

    let customerId = profile?.stripe_customer_id ?? null
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? profile?.email ?? undefined,
        metadata: { user_id: user.id, vessel_id: vesselId },
      })
      customerId = customer.id
      await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
    }

    // --- Create the Checkout Session. Metadata on BOTH the session and the
    // subscription so the webhook can read tier reliably (backend.md §6.1). ---
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/payment-processing`,
      cancel_url: `${APP_URL}/payment-required`,
      metadata: { user_id: user.id, vessel_id: vesselId, tier },
      subscription_data: { metadata: { user_id: user.id, vessel_id: vesselId, tier } },
    })

    return json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return json({ error: message }, 500)
  }
})
