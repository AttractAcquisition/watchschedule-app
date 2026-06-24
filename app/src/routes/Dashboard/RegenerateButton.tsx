// RegenerateButton — calls the proven generate-schedule (regenerate=true) from
// the dashboard. Confirms first if a schedule already exists ("Regenerate from
// today forward?"). Calm generating state (branding.md §8). On success the
// dashboard query is invalidated so the view refreshes to the NEW current
// schedule (recomputed from the up-to-date ledger — fairness-aware, never random).
import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { dashboardKey } from './useDashboardData'

export function RegenerateButton({ vesselId, hasSchedule }: { vesselId: string | undefined; hasSchedule: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setGenerating(true)
    setConfirming(false)
    try {
      const { error } = await supabase.functions.invoke('generate-schedule', { body: { regenerate: true } })
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: dashboardKey(vesselId) })
    } catch {
      setError("Couldn't regenerate just now. Please try again.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-ws-1">
        <button
          type="button"
          onClick={() => (hasSchedule ? setConfirming(true) : run())}
          disabled={generating}
          className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          {generating ? 'Regenerating…' : 'Regenerate'}
        </button>
        {error && <p role="alert" className="text-ws-xs text-ws-alert">{error}</p>}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <p className="ws-eyebrow">— Regenerate schedule</p>
            <h3 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Regenerate from today forward?</h3>
            <p className="mt-ws-3 text-ws-sm text-ws-text-muted">
              This builds a new current schedule from today, balancing from the up-to-date fairness ledger.
              The previous schedule is kept for history.
            </p>
            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text transition-all hover:bg-ws-steel-3">
                Cancel
              </button>
              <button type="button" onClick={run} className="rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright">
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
