// CalendarReset — clear every watch from the calendar, and put them back
// (docs/calendar-restore.md).
//
// Nothing is deleted. The clear is a reversible marker on the vessel: Schedule
// History still lists every generation, and Restore brings them all back.
// Fairness follows the calendar, because scores describing watches nobody can
// see are worse than no scores.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { dashboardKey } from '../Dashboard/useDashboardData'

export function CalendarReset({ cleared, onChanged }: { cleared: boolean; onChanged?: () => void }) {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function run(action: 'clear_calendar' | 'restore_calendar') {
    setBusy(true); setError(null); setNotice(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke<{ error?: string }>('restore-rota', { body: { action } })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      setConfirming(false)
      setNotice(action === 'clear_calendar'
        ? 'Calendar cleared. Every version is still under Schedule History, and Restore puts them back.'
        : 'Watches restored to the calendar.')
      await queryClient.invalidateQueries({ queryKey: dashboardKey(profile?.vessel_id ?? undefined) })
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the calendar.')
    } finally { setBusy(false) }
  }

  return <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
    <p className="ws-eyebrow">— Calendar</p>
    <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">{cleared ? 'Calendar cleared' : 'Clear the calendar'}</h2>
    <p className="mt-ws-2 max-w-2xl text-ws-sm text-ws-text-muted">
      {cleared
        ? 'Every stored watch is hidden from the calendar and excluded from fairness. Nothing was deleted — Schedule History still lists every generation, and you can put them all back.'
        : 'Hide every watch on the calendar and stop them counting towards fairness. Nothing is deleted: Schedule History keeps every generation, and this can be undone.'}
    </p>
    {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
    {notice && <p role="status" className="mt-ws-3 text-ws-sm text-ws-ok">{notice}</p>}
    {cleared ? (
      <button type="button" onClick={() => run('restore_calendar')} disabled={busy}
        className="mt-ws-4 flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-colors hover:border-ws-gold hover:text-ws-gold disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
        Restore cleared watches
      </button>
    ) : (
      <button type="button" onClick={() => { setConfirming(true); setNotice(null) }}
        className="mt-ws-4 flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-colors hover:border-ws-warn hover:text-ws-warn">
        <AlertTriangle className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Clear all watches
      </button>
    )}
    {confirming && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="calendar-reset-title">
      <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
        <p className="ws-eyebrow">— Clear the calendar</p>
        <h3 id="calendar-reset-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Clear every watch from the calendar?</h3>
        <p className="mt-ws-3 text-ws-sm text-ws-text-muted">
          The calendar empties and fairness scores reset, because the scores describe the watches on it.
          <strong className="text-ws-text"> Nothing is deleted.</strong> Every generation stays under Schedule History,
          and &ldquo;Restore cleared watches&rdquo; brings them all back.
        </p>
        <div className="mt-ws-5 flex justify-end gap-ws-3">
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text hover:bg-ws-steel-3">Cancel</button>
          <button type="button" onClick={() => run('clear_calendar')} disabled={busy} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-warn px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Clear all watches
          </button>
        </div>
      </div>
    </div>}
  </section>
}
