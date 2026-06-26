// stripe-webhook (backend.md §6.2) — THE ONLY writer of gate columns
// (payment_status, product_tier, stripe_*). Server-to-server: NO JWT; instead
// the Stripe-Signature header is verified against STRIPE_WEBHOOK_SECRET using
// the ASYNC constructor (constructEventAsync) with a SubtleCrypto provider —
// the synchronous constructEvent fails in Deno. All DB writes use service-role
// (bypasses RLS + the block_gate_column_writes trigger). Returns 200 fast.
//
// PENDING VERIFICATION: undeployed/unverified until Stripe test creds + a
// registered endpoint (or `stripe listen`) exist. See PHASE3_PENDING.md.
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})
// Deno requires the WebCrypto-backed provider for async signature verification.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

type PaymentStatus = 'unpaid' | 'active' | 'past_due' | 'canceled'
type Tier = 'solo' | 'dual' | 'triple'

// {priceId -> tier} reverse-map built from the 6 STRIPE_PRICE_* secrets already
// in the Edge env (the mirror of create-checkout-session's PRICE_ENV). PRICE is
// billing truth, so deriving product_tier from the subscription's CURRENT price
// is authoritative — it also corrects tier for any portal-driven price change,
// and never trusts client/metadata tier claims. Built once per cold start.
function priceTierMap(): Record<string, Tier> {
  const pairs: Array<[string | undefined, Tier]> = [
    [Deno.env.get('STRIPE_PRICE_SOLO_MONTH'), 'solo'], [Deno.env.get('STRIPE_PRICE_SOLO_YEAR'), 'solo'],
    [Deno.env.get('STRIPE_PRICE_DUAL_MONTH'), 'dual'], [Deno.env.get('STRIPE_PRICE_DUAL_YEAR'), 'dual'],
    [Deno.env.get('STRIPE_PRICE_TRIPLE_MONTH'), 'triple'], [Deno.env.get('STRIPE_PRICE_TRIPLE_YEAR'), 'triple'],
  ]
  const map: Record<string, Tier> = {}
  for (const [id, tier] of pairs) if (id) map[id] = tier
  return map
}
const PRICE_TIER = priceTierMap()

// The tier a subscription currently bills for, from its first item's price id.
function tierFromSubscription(sub: Stripe.Subscription): Tier | null {
  const priceId = sub.items?.data?.[0]?.price?.id
  return priceId ? (PRICE_TIER[priceId] ?? null) : null
}

// Stripe subscription.status -> our payment_status enum.
function mapSubStatus(status: string): PaymentStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    default:
      return 'past_due'
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const body = await req.text() // raw body required for signature verification
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

  let event: Stripe.Event
  try {
    if (!signature) throw new Error('missing Stripe-Signature')
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider
    )
  } catch (err) {
    // Bad/forged/missing signature -> 400, never processed.
    const message = err instanceof Error ? err.message : 'invalid signature'
    return new Response(JSON.stringify({ error: `signature verification failed: ${message}` }), {
      status: 400,
    })
  }

  // --- Idempotency. Every handler below is an idempotent UPDATE keyed by a
  // stable id, so a replayed event re-derives the same end state and never
  // double-processes. (A dedicated stripe_events(id pk) dedupe table is noted
  // as a possible hardening in PHASE3_PENDING.md.) ---
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.user_id
        const tier = session.metadata?.tier
        if (!userId || !tier) break
        await admin
          .from('profiles')
          .update({
            payment_status: 'active',
            product_tier: tier,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
            stripe_subscription_id:
              typeof session.subscription === 'string' ? session.subscription : null,
          })
          .eq('id', userId)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const status = mapSubStatus(sub.status)
        // product_tier is derived from the subscription's CURRENT PRICE (billing
        // truth via the reverse-map) — NOT from metadata — so a tier upgrade
        // (or any portal-driven price change) flips product_tier here. Only set
        // it when the price maps to a known tier (otherwise leave it untouched).
        // This is the sole authorized writer of product_tier (service-role).
        const tier = tierFromSubscription(sub)
        const patch: Record<string, unknown> = { payment_status: status }
        if (tier) patch.product_tier = tier
        // Prefer the user_id we stamped into subscription metadata; fall back to
        // matching the stored subscription id. (metadata.user_id only — tier
        // comes from price.)
        const userId = sub.metadata?.user_id
        const query = admin.from('profiles').update(patch)
        if (userId) await query.eq('id', userId)
        else await query.eq('stripe_subscription_id', sub.id)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        const query = admin.from('profiles').update({ payment_status: 'canceled' })
        if (userId) await query.eq('id', userId)
        else await query.eq('stripe_subscription_id', sub.id)
        break
      }

      default:
        // Unhandled event types are acknowledged (200) so Stripe stops retrying.
        break
    }
  } catch (err) {
    // Log-and-200 would hide failures from Stripe's retry; return 500 so Stripe
    // retries transient DB errors. Signature was already validated above.
    const message = err instanceof Error ? err.message : 'handler error'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
