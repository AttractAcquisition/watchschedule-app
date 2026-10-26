// /settings — the captain's control surface (frontend.md §4.6). Three sections:
// crew management, watch settings (the SAME shared WatchSettingsForm mounted in
// onboarding Step 2 — built once in Phase 5), and account/subscription. Renders
// inside the AppShell.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { CrewManager } from './CrewManager'
import { CharterManager } from './CharterManager'
import { LeaveManager } from './LeaveManager'
import WatchSettingsForm from './WatchSettingsForm'
import { UpgradePlan } from './UpgradePlan'
import { VesselIdentityForm } from './VesselIdentityForm'
import { AccountProfileForm } from './AccountProfileForm'
import { FairnessReset } from './FairnessReset'
import { laneMaxForTier, type Tier } from './watchSettings'

type SettingsTab = 'crew' | 'watch' | 'exceptions' | 'account' | 'subscription'

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'crew', label: 'Crew' },
  { value: 'watch', label: 'Watch configuration' },
  { value: 'exceptions', label: 'Schedule exceptions' },
  { value: 'account', label: 'Account' },
  { value: 'subscription', label: 'Subscription' },
]

const SETTINGS_GROUPS: { label: string; tabs: { value: SettingsTab; label: string }[] }[] = [
  { label: 'Configure', tabs: SETTINGS_TABS.slice(0, 2) },
  { label: 'Schedule', tabs: SETTINGS_TABS.slice(2, 3) },
  { label: 'Account', tabs: SETTINGS_TABS.slice(3) },
]

export default function Settings() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const vesselId = profile?.vessel_id ?? undefined
  const [savedSettings, setSavedSettings] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('crew')
  const [dismissingReconciliation, setDismissingReconciliation] = useState(false)

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
  const { data: vesselNotices } = useQuery({
    queryKey: ['vessel_notices', vesselId],
    enabled: !!vesselId,
    queryFn: async () => (await supabase.from('vessels').select('watch_settings_reconciliation_dismissed_at').eq('id', vesselId!).maybeSingle()).data,
  })
  const tier = (profile?.product_tier ?? null) as Tier | null
  const needsReconcile = !!tier && !!ws?.tier && ws.tier !== tier
  const showReconciliationWarning = needsReconcile && (!vesselNotices?.watch_settings_reconciliation_dismissed_at || !!profile?.updated_at && profile.updated_at > vesselNotices.watch_settings_reconciliation_dismissed_at)

  async function dismissReconciliationWarning() {
    if (!vesselId) return
    setDismissingReconciliation(true)
    try {
      const { error } = await supabase.from('vessels').update({ watch_settings_reconciliation_dismissed_at: new Date().toISOString() }).eq('id', vesselId)
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['vessel_notices', vesselId] })
    } finally {
      setDismissingReconciliation(false)
    }
  }

  async function regenerate() {
    setRegenerating(true); setError(null)
    try {
      const { error } = await supabase.functions.invoke('generate-schedule', { body: { regenerate: true } })
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['dashboard', vesselId] })
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
    <div>
      <div>
        <p className="ws-eyebrow">— Settings</p>
        <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">Settings</h1>
        <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Manage crew, watch configuration, schedule exceptions, account details, and billing.</p>
        <div className="mt-ws-4 overflow-x-auto pb-ws-1 lg:hidden">
          <SegmentedControl
            options={SETTINGS_TABS}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Settings sections"
          />
        </div>
      </div>
	  
      <div className="mt-ws-6 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-ws-6">
        <nav className="hidden lg:block" aria-label="Settings sections">
          <div className="sticky top-ws-5 space-y-ws-5 border-r border-ws-line pr-ws-4">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-faint">{group.label}</p>
                <div className="space-y-ws-1">
                  {group.tabs.map((tab) => {
                    const active = activeTab === tab.value
                    return (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => setActiveTab(tab.value)}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full rounded-ws-sm px-ws-3 py-ws-2 text-left text-ws-sm font-medium transition-colors ${active ? 'bg-ws-gold text-ws-text-on-gold' : 'text-ws-text-muted hover:bg-ws-steel-2 hover:text-ws-text'}`}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 space-y-ws-6">
          {error && <p role="alert" className="text-ws-sm text-ws-alert">{error}</p>}

          {activeTab === 'crew' && <CrewManager />}

      {/* Reconciliation prompt (B4) — soft, non-blocking; appears after an upgrade
          until the captain saves the now-required settings below. */}
          {activeTab === 'watch' && showReconciliationWarning && tier && (
        <div className="relative flex items-start gap-ws-2 rounded-ws-sm border border-ws-gold bg-ws-gold-ghost p-ws-4 pr-ws-12">
          <div className="flex items-start gap-ws-2">
            <ArrowUpCircle className="mt-ws-1 h-4 w-4 shrink-0 text-ws-gold" strokeWidth={1.5} aria-hidden />
            <p className="text-ws-sm text-ws-text">
              Your plan is now <span className="font-semibold text-ws-gold">{tier} watch</span>. Choose 1–{laneMaxForTier(tier)} watch lanes in <span className="text-ws-text">Watch configuration</span> below and save to finish the upgrade. Your current schedule keeps working until you do.
            </p>
          </div>
          <button type="button" onClick={dismissReconciliationWarning} disabled={dismissingReconciliation} aria-label="Dismiss watch-settings notice" className="absolute right-ws-3 top-ws-3 flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-text disabled:opacity-50"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
        </div>
      )}

      {/* Watch settings — the SAME component as onboarding Step 2 (Phase 5). */}
          {activeTab === 'watch' && (
        <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
          <p className="ws-eyebrow">— Watch settings</p>
          <h2 className="mt-ws-1 mb-ws-4 font-display text-ws-md font-semibold text-ws-offwhite">Watch configuration</h2>
          <WatchSettingsForm
            submitLabel="Save settings"
            onSaved={() => { setSavedSettings(true); queryClient.invalidateQueries({ queryKey: ['watch_settings_tier', vesselId] }) }}
            onSaveAndRegenerate={regenerate}
          />
          {savedSettings && (
            <div className="mt-ws-4 flex flex-wrap items-center gap-ws-3 border-t border-ws-line pt-ws-4">
              <p className="text-ws-sm text-ws-text-muted">Settings saved. Regenerate to apply them to the schedule.</p>
              <button type="button" onClick={regenerate} disabled={regenerating} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-gold transition-all hover:bg-ws-gold-ghost disabled:border-ws-line disabled:text-ws-text-faint">
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Regenerate now
              </button>
            </div>
          )}
        </section>
      )}

          {activeTab === 'exceptions' && (
            <>
              <div>
                <p className="ws-eyebrow">— Schedule exceptions</p>
                <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Planned pauses and crew leave</h2>
                <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Temporarily pause the vessel rota or book leave without changing the underlying rotation.</p>
              </div>
              <CharterManager />
              <LeaveManager />
            </>
          )}

      {/* Account */}
          {activeTab === 'account' && <>
        <AccountProfileForm />
        <VesselIdentityForm />
        <FairnessReset />
          </>}

      {/* Subscription */}
          {activeTab === 'subscription' && <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <p className="ws-eyebrow">— Subscription</p>
        <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Plan &amp; billing</h2>
        <div className="mt-ws-4 flex flex-wrap items-end justify-between gap-ws-3">
          <div><p className="text-ws-xs text-ws-text-muted">Current plan</p>
            <p className="mt-ws-1 font-mono text-ws-sm uppercase tracking-ws-wide text-ws-gold">{profile?.product_tier ?? '—'} watch</p>
          </div>
          <div className="flex flex-wrap gap-ws-2">
            <button type="button" onClick={manageBilling} disabled={billingBusy} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-60">
              {billingBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ExternalLink className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Manage billing
            </button>
            {profile?.product_tier !== 'triple' && <button type="button" onClick={() => setUpgradeOpen((open) => !open)} className="rounded-ws-sm px-ws-3 py-ws-2 text-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">{upgradeOpen ? 'Hide upgrades' : 'Upgrade plan'}</button>}
          </div>
        </div>

        {upgradeOpen && <div className="mt-ws-4 border-t border-ws-line pt-ws-4"><UpgradePlan /></div>}
          </section>}
        </main>
      </div>
    </div>
  )
}
