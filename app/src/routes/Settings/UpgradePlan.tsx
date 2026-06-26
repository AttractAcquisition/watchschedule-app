// UpgradePlan (B4 Part 2) — guided tier upgrade in the billing/account section.
// Client sends only a target tier to `upgrade-subscription`; it NEVER writes
// product_tier. After Stripe modifies the subscription and the webhook flips
// product_tier (derived from the new PRICE), we watch the caller's profile via
// Realtime (+ poll + calm timeout — the PaymentProcessing pattern, but on
// product_tier) and, on the flip, invalidate the profile so the page reflects
// the new tier and the reconciliation banner appears. Tokens only.
import { useEffect, useRef, useState } from 'react'
import { ArrowUpCircle, Check, Loader2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { profileQueryKey } from '../../auth/useProfile'
import type { Tier } from './watchSettings'

const RANK: Record<Tier, number> = { solo: 1, dual: 2, triple: 3 }
// B1 pricing (monthly). Marketing site = source of truth.
const TIERS: { tier: Tier; name: string; monthly: number; lanes: string }[] = [
  { tier: 'solo', name: 'Solo Watch', monthly: 39, lanes: '1 lane · all eligible crew' },
  { tier: 'dual', name: 'Dual Watch', monthly: 99, lanes: 'up to 2 lanes · pick 1–2 departments' },
  { tier: 'triple', name: 'Triple Watch', monthly: 199, lanes: 'up to 3 lanes · pick 1–3 departments' },
]
const TIMEOUT_MS = 60_000
const POLL_MS = 2_000

export function UpgradePlan() {
  const { session, profile } = useAuth()
  const userId = session?.user?.id
  const current = (profile?.product_tier ?? null) as Tier | null
  const higher = current ? TIERS.filter((t) => RANK[t.tier] > RANK[current]) : []

  const [confirmTier, setConfirmTier] = useState<Tier | null>(null)
  const [pending, setPending] = useState<Tier | null>(null) // upgrade in flight
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<Tier | null>(null)
  pendingRef.current = pending

  // When the profile's product_tier reaches the pending target, the upgrade is
  // confirmed: clear the in-flight state (the reconciliation banner takes over).
  useEffect(() => {
    if (pending && current === pending) { setPending(null); setTimedOut(false) }
  }, [current, pending])

  // Realtime + poll watch while an upgrade is in flight (webhook writes the flip).
  useEffect(() => {
    if (!pending || !userId) return
    const refresh = () => queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
    const channel = supabase
      .channel(`upgrade:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => { if ((payload.new as { product_tier?: string }).product_tier === pendingRef.current) refresh() })
      .subscribe()
    const poll = window.setInterval(refresh, POLL_MS)
    const timeout = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS)
    return () => { supabase.removeChannel(channel); window.clearInterval(poll); window.clearTimeout(timeout) }
  }, [pending, userId])

  async function startUpgrade(target: Tier) {
    setConfirmTier(null); setError(null); setTimedOut(false); setPending(target)
    const { error } = await supabase.functions.invoke('upgrade-subscription', { body: { target } })
    if (error) { setPending(null); setError("Couldn't start the upgrade. Please try again.") }
  }

  if (!current || higher.length === 0) {
    return <p className="text-ws-sm text-ws-text-muted">You're on the top plan — nothing to upgrade.</p>
  }

  return (
    <div>
      <div className="flex items-center gap-ws-2">
        <ArrowUpCircle className="h-4 w-4 text-ws-gold" strokeWidth={1.5} aria-hidden />
        <p className="text-ws-sm font-medium text-ws-text">Upgrade plan</p>
      </div>
      <p className="mt-ws-1 text-ws-sm text-ws-text-muted">Move up a tier to unlock more watch lanes. You'll pay the difference immediately (prorated).</p>

      <div className="mt-ws-4 grid gap-ws-3 sm:grid-cols-2">
        {higher.map((t) => (
          <div key={t.tier} className="flex items-center justify-between gap-ws-3 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-4">
            <div>
              <p className="font-display text-ws-base font-semibold text-ws-offwhite">{t.name}</p>
              <p className="mt-ws-1 font-mono text-ws-xs text-ws-text-muted">€{t.monthly}/mo · {t.lanes}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmTier(t.tier)}
              disabled={!!pending}
              className="flex min-h-[40px] items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
            >
              {pending === t.tier ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending === t.tier ? 'Upgrading…' : `Upgrade to ${t.name.replace(' Watch', '')}`}
            </button>
          </div>
        ))}
      </div>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}

      {/* In-flight wait surface (watching product_tier flip). */}
      {pending && (
        <div className="mt-ws-4 flex items-start gap-ws-2 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3">
          {!timedOut && <Loader2 className="mt-ws-1 h-4 w-4 shrink-0 animate-spin text-ws-gold" aria-hidden />}
          <p className="text-ws-sm text-ws-text-muted">
            {!timedOut
              ? <>Confirming your upgrade to <span className="text-ws-text">{pending}</span> with Stripe… this is finalised by the payment webhook and usually takes a few seconds.</>
              : <>Still finalising with Stripe — this can take a moment. If a payment is required and your card is declined, your plan will show as <span className="text-ws-text">past due</span>. This page updates automatically.</>}
          </p>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Confirm upgrade</h3>
              <button type="button" onClick={() => setConfirmTier(null)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <p className="mt-ws-3 text-ws-sm text-ws-text-muted">
              Upgrade to <span className="text-ws-text">{TIERS.find((t) => t.tier === confirmTier)?.name}</span> (€{TIERS.find((t) => t.tier === confirmTier)?.monthly}/mo)?
              Your subscription updates now and you pay the prorated difference. After upgrading you'll choose the new watch departments.
            </p>
            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={() => setConfirmTier(null)} className="rounded-ws-sm px-ws-4 py-ws-2 text-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">Cancel</button>
              <button type="button" onClick={() => startUpgrade(confirmTier)} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-5 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright">
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden /> Confirm upgrade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
