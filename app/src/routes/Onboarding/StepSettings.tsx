// Onboarding Step 2 — Watch settings (frontend.md §4.4 Step 2).
// This step is JUST a thin mount of the shared WatchSettingsForm (the very same
// component /settings mounts in Phase 11 — built once, in routes/Settings/).
// The form persists watch_settings + watch_lanes; this wrapper's only job is the
// onboarding follow-up: advance onboarding_step to 'generate'.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { profileQueryKey } from '../../auth/useProfile'
import WatchSettingsForm from '../Settings/WatchSettingsForm'

export default function StepSettings() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [error, setError] = useState<string | null>(null)

  async function advanceToGenerate() {
    if (!userId) return
    const { error } = await supabase.from('profiles').update({ onboarding_step: 'generate' }).eq('id', userId)
    if (error) { setError('Settings saved, but advancing failed. Please retry.'); return }
    await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) }) // -> stepper advances
  }

  return (
    <div>
      <p className="ws-eyebrow">— Step 2 · Settings</p>
      <h2 className="mt-ws-1 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">Configure your watch</h2>
      <p className="mt-ws-2 mb-ws-5 text-ws-sm text-ws-text-muted">
        These are the same settings you'll find on the Settings page later — set them once.
      </p>
      {error && <p role="alert" className="mb-ws-4 text-ws-sm text-ws-alert">{error}</p>}
      <WatchSettingsForm onSaved={advanceToGenerate} submitLabel="Confirm settings & continue" />
    </div>
  )
}
