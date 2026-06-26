// /payment-required — Plan selection (frontend.md §4.2, branding.md).
// Three tiers + an annual toggle (annual = 2 months free). "Start [tier]" calls
// the create-checkout-session Edge Function and redirects to Stripe Checkout.
// The client NEVER writes payment_status / product_tier — those flip only via
// the webhook after payment (invariant §3). Tokens only; no raw hex.
//
// PENDING VERIFICATION: the checkout round-trip is unverified until Stripe test
// credentials are configured. See PHASE3_PENDING.md.
import { useState } from 'react'
import { Anchor, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthGate'

type Tier = 'solo' | 'dual' | 'triple'
type Interval = 'month' | 'year'

interface Plan {
  tier: Tier
  name: string
  monthly: number // EUR/mo
  blurb: string
  lanes: string
  popular?: boolean
}

// Pricing per frontend.md §4.2 / master.md seam index (marketing site = source of
// truth). Annual = 2 months free, so the yearly figure is monthly × 10
// (e.g. Solo €390, Dual €990, Triple €1990).
const PLANS: Plan[] = [
  { tier: 'solo', name: 'Solo Watch', monthly: 39, blurb: 'One shared watch pool.', lanes: '1 lane · all eligible crew' },
  { tier: 'dual', name: 'Dual Watch', monthly: 99, blurb: 'Up to two department rotations.', lanes: 'up to 2 lanes · pick 1–2 departments', popular: true },
  { tier: 'triple', name: 'Triple Watch', monthly: 199, blurb: 'Up to three department rotations.', lanes: 'up to 3 lanes · pick 1–3 departments' },
]

const euro = (n: number) => `€${n.toLocaleString('en-IE')}`

export default function PaymentRequired() {
  const { profile, signOut } = useAuth()
  const [interval, setInterval] = useState<Interval>('month')
  const [busyTier, setBusyTier] = useState<Tier | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(tier: Tier) {
    setError(null)
    setBusyTier(tier)
    try {
      const { data, error } = await supabase.functions.invoke<{ url: string }>(
        'create-checkout-session',
        { body: { tier, interval } }
      )
      if (error) throw error
      if (!data?.url) throw new Error('No checkout URL returned')
      window.location.href = data.url // hand off to Stripe Checkout
    } catch {
      setError("We couldn't start checkout just now. Please try again.")
      setBusyTier(null)
    }
  }

  const annual = interval === 'year'

  return (
    <main className="min-h-full bg-ws-navy-deep px-ws-5 py-ws-7">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex items-center gap-ws-2">
          <Anchor className="h-5 w-5 text-ws-gold" strokeWidth={1.5} aria-hidden />
          <span className="font-display text-ws-md font-semibold tracking-ws-tight text-ws-offwhite">
            WatchSchedule
          </span>
        </div>

        <div className="mt-ws-6 text-center">
          <p className="ws-eyebrow">— Choose your plan</p>
          <h1 className="mt-ws-2 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
            Billed by the watch structure your vessel runs
          </h1>
          <p className="mt-ws-2 text-ws-base text-ws-text-muted">
            You're signed in. Pick a plan to begin onboarding.
          </p>
        </div>

        {/* Monthly / annual toggle */}
        <div className="mt-ws-5 flex items-center justify-center">
          <div
            role="tablist"
            aria-label="Billing interval"
            className="inline-flex rounded-ws-full border border-ws-line bg-ws-steel-3 p-ws-1"
          >
            {(['month', 'year'] as Interval[]).map((opt) => {
              const active = interval === opt
              return (
                <button
                  key={opt}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setInterval(opt)}
                  className={[
                    'rounded-ws-full px-ws-4 py-ws-2 text-ws-sm font-medium transition-all',
                    active ? 'bg-ws-gold text-ws-text-on-gold' : 'text-ws-text-muted hover:text-ws-text',
                  ].join(' ')}
                >
                  {opt === 'month' ? 'Monthly' : 'Annual'}
                  {opt === 'year' && (
                    <span className={active ? 'ml-ws-2 text-ws-text-on-gold' : 'ml-ws-2 text-ws-gold'}>
                      2 months free
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-ws-4 text-center text-ws-sm text-ws-alert">
            {error}
          </p>
        )}

        {/* Plan cards */}
        <div className="mt-ws-6 grid gap-ws-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const price = annual ? plan.monthly * 10 : plan.monthly
            const busy = busyTier === plan.tier
            return (
              <section
                key={plan.tier}
                className={[
                  'flex flex-col rounded-ws-md border bg-ws-steel p-ws-5 shadow-ws-md',
                  plan.popular ? 'border-ws-gold shadow-ws-glow-gold' : 'border-ws-line',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-ws-md font-semibold text-ws-offwhite">{plan.name}</h2>
                  {plan.popular && (
                    <span className="rounded-ws-full border border-ws-gold px-ws-2 py-ws-1 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-ws-2 text-ws-sm text-ws-text-muted">{plan.blurb}</p>

                <div className="mt-ws-4 flex items-baseline gap-ws-2">
                  <span className="font-mono text-ws-2xl tracking-ws-tight text-ws-offwhite">
                    {euro(price)}
                  </span>
                  <span className="text-ws-sm text-ws-text-muted">/{annual ? 'yr' : 'mo'}</span>
                </div>
                {annual && (
                  <p className="mt-ws-1 font-mono text-ws-xs text-ws-text-faint">
                    {euro(plan.monthly)}/mo billed annually
                  </p>
                )}

                <p className="mt-ws-4 flex items-center gap-ws-2 text-ws-sm text-ws-text">
                  <Check className="h-4 w-4 text-ws-seagreen" strokeWidth={1.5} aria-hidden />
                  {plan.lanes}
                </p>

                <button
                  type="button"
                  onClick={() => startCheckout(plan.tier)}
                  disabled={busy || busyTier !== null}
                  className="mt-ws-5 flex items-center justify-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Start {plan.name}
                </button>
              </section>
            )
          })}
        </div>

        <p className="mt-ws-6 text-center font-mono text-ws-xs text-ws-text-faint">
          payment_status: {profile?.payment_status ?? '—'} ·{' '}
          <button type="button" onClick={signOut} className="text-ws-gold hover:text-ws-gold-bright">
            Sign out
          </button>
        </p>
      </div>
    </main>
  )
}
