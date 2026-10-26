import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { dashboardKey } from '../Dashboard/useDashboardData'

export function FairnessReset() {
  const { profile } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function reset() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const { error: rpcError } = await supabase.rpc('reset_fairness_history')
      if (rpcError) throw rpcError
      setConfirming(false)
      setNotice('Fairness history cleared. Regenerate to start the new season.')
      await queryClient.invalidateQueries({ queryKey: dashboardKey(profile?.vessel_id ?? undefined) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear fairness history.')
    } finally { setBusy(false) }
  }

  return <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
    <p className="ws-eyebrow">— Fairness season</p>
    <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Start fresh</h2>
    <p className="mt-ws-2 max-w-2xl text-ws-sm text-ws-text-muted">Clear previous fairness history for a new crew or season. Crew, settings, schedules, and assignments stay intact; the next regeneration starts with a clean balance.</p>
    {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
    {notice && <p role="status" className="mt-ws-3 text-ws-sm text-ws-ok">{notice}</p>}
    <button type="button" onClick={() => { setConfirming(true); setNotice(null) }} className="mt-ws-4 flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-colors hover:border-ws-warn hover:text-ws-warn">
      <AlertTriangle className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Clear fairness history
    </button>
    {confirming && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="fairness-reset-title">
      <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
        <p className="ws-eyebrow">— Start a new season</p>
        <h3 id="fairness-reset-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Clear previous fairness history?</h3>
        <p className="mt-ws-3 text-ws-sm text-ws-text-muted">This removes imported history, fairness scores, and previous fairness decisions. Your crew and schedules are not deleted. Regenerate afterward to calculate the new season.</p>
        <div className="mt-ws-5 flex justify-end gap-ws-3">
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text hover:bg-ws-steel-3">Cancel</button>
          <button type="button" onClick={reset} disabled={busy} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-warn px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Clear history</button>
        </div>
      </div>
    </div>}
  </section>
}
