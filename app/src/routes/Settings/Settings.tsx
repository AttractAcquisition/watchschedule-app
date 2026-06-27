// /settings — the captain's control surface (frontend.md §4.6). Three sections:
// crew management, watch settings (the SAME shared WatchSettingsForm mounted in
// onboarding Step 2 — built once in Phase 5), and subscription/account. Renders
// inside the AppShell.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { CrewManager } from './CrewManager'
import { CharterManager } from './CharterManager'
import WatchSettingsForm from './WatchSettingsForm'
import { UpgradePlan } from './UpgradePlan'
import { deptMaxForTier, type Tier } from './watchSettings'

export default function Settings() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const vesselId = profile?.vessel_id ?? undefined
  const [savedSettings, setSavedSettings] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reconciliation prompt (B4): after a tier upgrade, product_tier flips before
  // the captain re-configures, so watch_settings.tier lags. Until they save the
  // shared form below (which sets watch_settings.tier = product_tier and rebuilds
  // lanes), we show a soft, NON-BLOCKING prompt. The old lane/schedule keeps
  // working meanwhile — nothing here touches onboarding_complete or the gate.
  const { data: ws } = useQuery({
    queryKey: ['watch_settings_tier', vesselId],
    enabled: !!vesselId,
    queryFn: async () => (await supabase.from('watch_settings').select('tier').eq('vessel_id', vesselId!).maybeSingle()).data,
  })
  const tier = (profile?.product_tier ?? null) as Tier | null
  const needsReconcile = !!tier && !!ws?.tier && ws.tier !== tier

  async function regenerate() {
    setRegenerating(true); setError(null)
    try {
      const { error } = await supabase.functions.invoke('generate-schedule', { body: { regenerate: true } })
      if (error) throw error
      navigate('/dashboard')
    } catch {
      setError('Could not regenerate the schedule.'); setRegenerating(false)
    }
  }

  async function manageBilling() {
    setBillingBusy(true); setError(null)
    try {
      const { data, error } = await supabase.functions.invoke<{ url: string }>('create-billing-portal-session', { body: {} })
      if (error) throw error
      if (!data?.url) throw new Error('no url')
      window.location.href = data.url
    } catch {
      setError("Couldn't open billing just now. Please try again."); setBillingBusy(false)
    }
  }

  return (
    <div className="space-y-ws-6">
      <div>
        <p className="ws-eyebrow">— Settings</p>
        <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">Crew &amp; watch settings</h1>
      </div>

      {error && <p role="alert" className="text-ws-sm text-ws-alert">{error}</p>}

      <CrewManager />

      {/* Reconciliation prompt (B4) — soft, non-blocking; appears after an upgrade
          until the captain saves the now-required settings below. */}
      {needsReconcile && tier && (
        <div className="flex items-start gap-ws-2 rounded-ws-sm border border-ws-gold bg-ws-gold-ghost p-ws-4">
          <ArrowUpCircle className="mt-ws-1 h-4 w-4 shrink-0 text-ws-gold" strokeWidth={1.5} aria-hidden />
          <p className="text-ws-sm text-ws-text">
            Your plan is now <span className="font-semibold text-ws-gold">{tier} watch</span>. Choose 1–{deptMaxForTier(tier)} watch departments in <span className="text-ws-text">Watch configuration</span> below and save to finish the upgrade. Your current schedule keeps working until you do.
          </p>
        </div>
      )}

      {/* Watch settings — the SAME component as onboarding Step 2 (Phase 5). */}
      <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <p className="ws-eyebrow">— Watch settings</p>
        <h2 className="mt-ws-1 mb-ws-4 font-display text-ws-md font-semibold text-ws-offwhite">Watch configuration</h2>
        <WatchSettingsForm submitLabel="Save settings" onSaved={() => { setSavedSettings(true); queryClient.invalidateQueries({ queryKey: ['watch_settings_tier', vesselId] }) }} />
        {savedSettings && (
          <div className="mt-ws-4 flex flex-wrap items-center gap-ws-3 border-t border-ws-line pt-ws-4">
            <p className="text-ws-sm text-ws-text-muted">Settings saved. Regenerate to apply them to the schedule.</p>
            <button type="button" onClick={regenerate} disabled={regenerating} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
              {regenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Save &amp; regenerate
            </button>
          </div>
        )}
      </section>

      {/* Charter mode (B7) */}
      <CharterManager />

      {/* Subscription / account */}
      <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <p className="ws-eyebrow">— Subscription</p>
        <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Account &amp; billing</h2>
        <div className="mt-ws-4 flex flex-wrap items-center justify-between gap-ws-4">
          <div className="flex items-center gap-ws-3">
            <span className="text-ws-sm text-ws-text-muted">Current plan</span>
            <span className="rounded-ws-full border border-ws-gold px-ws-3 py-ws-1 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold">{profile?.product_tier ?? '—'} watch</span>
          </div>
          <div className="flex items-center gap-ws-3">
            <button type="button" onClick={manageBilling} disabled={billingBusy} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-60">
              {billingBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ExternalLink className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Manage billing
            </button>
            <button type="button" onClick={signOut} className="flex items-center gap-ws-2 rounded-ws-sm px-ws-4 py-ws-2 text-ws-sm text-ws-text-muted transition-all hover:bg-ws-steel-2 hover:text-ws-text">
              <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Sign out
            </button>
          </div>
        </div>

        {/* Tier upgrade (B4 Part 2) */}
        <div className="mt-ws-5 border-t border-ws-line pt-ws-5">
          <UpgradePlan />
        </div>
      </section>
    </div>
  )
}
