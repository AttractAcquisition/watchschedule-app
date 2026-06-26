// upgrade-subscription (B4 Part 2, backend.md §6) — moves the caller's Stripe
// subscription UP to a higher tier's price. JWT-auth; vessel/user RE-DERIVED from
// the JWT (never trust client). The client sends ONLY a target tier; it NEVER
// writes product_tier. We validate the target is strictly higher, swap the
// subscription's price item (keeping the same billing interval) with
// proration_behavior:'create_prorations', and let Stripe fire
// customer.subscription.updated — stripe-webhook is the ONLY writer of
// product_tier (derived from the new PRICE, not from any client claim or metadata).
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'

type Tier = 'solo' | 'dual' | 'triple'
type Interval = 'month' | 'year'
const RANK: Record<Tier, number> = { solo: 1, dual: 2, triple: 3 }

// (tier, interval) -> the canonical price-secret env name (mirrors
// create-checkout-session). The 6 STRIPE_PRICE_* secrets already live in the env.
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
  const pre = handlePreflight(req)
  if (pre) return pre

  try {
    // --- authenticate + re-derive identity from the JWT ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json(req, { error: 'unauthorized' }, 401)
    const userId = userData.user.id

    const { target } = (await req.json().catch(() => ({}))) as { target?: Tier }
    if (!target || !RANK[target]) return json(req, { error: 'invalid target tier' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    // current tier + subscription id come from the SERVER copy, never the client.
    const { data: profile } = await admin.from('profiles').select('product_tier, stripe_subscription_id').eq('id', userId).maybeSingle()
    if (!profile) return json(req, { error: 'profile not found' }, 400)
    const current = (profile.product_tier ?? null) as Tier | null
    if (!profile.stripe_subscription_id) return json(req, { error: 'no active subscription on file' }, 400)

    // --- strictly-higher guard: reject same or lower tier ---
    if (!current || RANK[target] <= RANK[current]) {
      return json(req, { error: `target tier must be higher than current (${current ?? 'none'} -> ${target})` }, 400)
    }

    // --- keep the same billing interval as the current subscription item ---
    const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id)
    const item = sub.items.data[0]
    if (!item) return json(req, { error: 'subscription has no items' }, 400)
    const interval = (item.price.recurring?.interval === 'year' ? 'year' : 'month') as Interval
    const newPriceId = Deno.env.get(PRICE_ENV[target][interval])
    if (!newPriceId) return json(req, { error: `price not configured: ${PRICE_ENV[target][interval]}` }, 500)

    // --- modify the subscription: swap the price item, prorate immediately ---
    // metadata.tier is reference only; the webhook derives product_tier FROM PRICE.
    const updated = await stripe.subscriptions.update(profile.stripe_subscription_id, {
      items: [{ id: item.id, price: newPriceId }],
      proration_behavior: 'create_prorations',
      metadata: { ...sub.metadata, user_id: userId, tier: target },
    })

    // NOTE: product_tier is NOT written here. The webhook writes it from the price.
    return json(req, { ok: true, target, interval, subscription_status: updated.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return json(req, { error: message }, 500)
  }
})
