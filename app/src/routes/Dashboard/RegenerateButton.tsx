// RegenerateButton — calls the proven generate-schedule (regenerate=true) from
// the dashboard. Confirms first if a schedule already exists ("Regenerate from
// today forward?"). Calm generating state (branding.md §8). On success the
// dashboard query is invalidated so the view refreshes to the NEW current
// schedule (recomputed from the up-to-date ledger — fairness-aware, never random).
//
// The confirm step also PRESENTS the captain's fixed watches before anything is
// built (docs/fixed-watches.md): which dates are already spoken for, and whether
// any of them is still waiting on consent — in which case generation would
// refuse, so the button says where to go and stays disabled.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Pin, RefreshCw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { previewPins, pinNeedsAnswer } from '../Settings/fixedWatches'
import { GenerationWindowPicker, todayISO, windowProblem, type GenerationWindow } from './GenerationWindowPicker'
import { dashboardKey } from './useDashboardData'

const shortFmt = (d: string) => format(parseISO(d), 'EEE d MMM')

export function RegenerateButton({ vesselId, hasSchedule }: { vesselId: string | undefined; hasSchedule: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The window is the most consequential choice in a regeneration, so it is
  // chosen HERE rather than in Settings (docs/regenerate-window.md). Seeded
  // from the saved configuration when the dialog opens.
  const [window_, setWindow] = useState<GenerationWindow | null>(null)

  const { data: saved } = useQuery({
    queryKey: ['generation_window', vesselId],
    enabled: confirming && !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('watch_settings')
        .select('generation_mode,generation_start_date,generation_end_date,horizon_weeks')
        .eq('vessel_id', vesselId!).maybeSingle()
      if (error) throw error
      return data
    },
  })

  useEffect(() => {
    if (!saved || window_) return
    setWindow({
      mode: (saved.generation_mode ?? 'weeks') as GenerationWindow['mode'],
      horizon_weeks: saved.horizon_weeks ?? 4,
      start: saved.generation_start_date ?? todayISO(),
      end: saved.generation_end_date ?? todayISO(),
    })
  }, [saved, window_])

  // Only asked for while the dialog is open, and never written to.
  const { data: preview, isLoading: checkingPins } = useQuery({
    queryKey: ['watch_pins_preview', vesselId],
    enabled: confirming,
    queryFn: () => previewPins(true),
    retry: false,
  })
  const applying = (preview?.pins ?? []).filter((p) => p.applies)
  const unresolved = applying.filter(pinNeedsAnswer)

  async function run() {
    setError(null)
    setGenerating(true)
    setConfirming(false)
    try {
      // Save the window first: generate-schedule reads it from the stored
      // configuration, so persisting it is what makes the choice take effect —
      // and it keeps Settings showing the truth afterwards.
      if (window_ && !windowProblem(window_)) {
        const { error: windowError } = await supabase.rpc('set_generation_window', {
          p_mode: window_.mode,
          p_start: window_.mode === 'weeks' ? null : window_.start,
          p_end: window_.mode === 'weeks' ? null : window_.end,
          p_horizon_weeks: window_.horizon_weeks,
        })
        if (windowError) throw windowError
        await queryClient.invalidateQueries({ queryKey: ['watch_settings_tier', vesselId] })
      }
      const { data, error } = await supabase.functions.invoke<{ requires_pin_consent?: boolean }>('generate-schedule', { body: { regenerate: true } })
      if (error) throw error
      if (data?.requires_pin_consent) {
        setError('A fixed watch still needs your consent — see Settings → Watch configuration → Advanced.')
        return
      }
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
        {error && <p role="alert" className="max-w-xs text-right text-ws-xs text-ws-alert">{error}</p>}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <p className="ws-eyebrow">— Regenerate schedule</p>
            <h3 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Regenerate from today forward?</h3>
            <p className="mt-ws-3 text-ws-sm text-ws-text-muted">
              This builds a new schedule over the window below, balancing from the up-to-date fairness ledger.
              The previous schedule is kept for history.
            </p>

            <div className="mt-ws-4 rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-3">
              {window_
                ? <GenerationWindowPicker value={window_} onChange={setWindow} />
                : <p className="flex items-center gap-ws-2 text-ws-xs text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your generation window…</p>}
            </div>

            <div className="mt-ws-4 min-h-0 flex-1 overflow-y-auto">
              {checkingPins ? (
                <p className="flex items-center gap-ws-2 text-ws-xs text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking fixed watches…</p>
              ) : applying.length > 0 && (
                <div className="rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-3">
                  <p className="flex items-center gap-ws-2 text-ws-xs font-medium text-ws-text-muted">
                    <Pin className="h-3.5 w-3.5 text-ws-gold" strokeWidth={1.5} aria-hidden />
                    These watches are already fixed and will be kept
                  </p>
                  <ul className="mt-ws-2 space-y-ws-1">
                    {applying.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-ws-2 text-ws-xs">
                        <span className="text-ws-text">{p.crew_name}</span>
                        <span className="font-mono text-ws-text-muted">
                          {p.days.length > 1 ? `${shortFmt(p.days[0])} – ${shortFmt(p.days[p.days.length - 1])}` : shortFmt(p.watch_date)} · {p.lane_label}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-ws-2 text-ws-xs text-ws-text-faint">Everything else is balanced around them.</p>
                </div>
              )}
              {unresolved.length > 0 && (
                <p role="alert" className="mt-ws-3 flex items-start gap-ws-2 text-ws-xs text-ws-warn">
                  <AlertTriangle className="mt-ws-1 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                  <span>
                    {unresolved.length === 1 ? 'One fixed watch needs' : `${unresolved.length} fixed watches need`} your
                    consent before anything can be generated — Settings → Watch configuration → Advanced.
                  </span>
                </p>
              )}
            </div>

            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text transition-all hover:bg-ws-steel-3">
                Cancel
              </button>
              <button type="button" onClick={run} disabled={unresolved.length > 0 || !window_ || !!windowProblem(window_)}
                className="rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
