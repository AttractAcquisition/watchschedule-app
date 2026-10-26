// /dashboard — the product (frontend.md §4.5). The watch calendar is primary;
// fairness is available on demand, keeping the captain's daily view focused.
// Renders inside
// the AppShell (top bar: vessel, tier badge, user menu). The client only READS
// the current schedule + fairness ledger via RLS-scoped selects; it computes no
// fairness or schedule math. (The Claude chatbot panel is Phase 10.)
import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, MoreHorizontal, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { useDashboardData } from './useDashboardData'
import { FairnessPanel } from './FairnessPanel'
import { WatchCalendar } from './WatchCalendar'
import { RegenerateButton } from './RegenerateButton'
import { CopyWhatsAppButton } from './CopyWhatsAppButton'
import { ScheduleHistoryButton } from './ScheduleHistory'
import { ScheduleChat } from './ScheduleChat'
import { ScheduleExportButtons } from './ScheduleExportButtons'
import { FairnessExportButtons } from './FairnessExportButtons'
import { PrintLayer, usePrintWhenSet, type PrintTarget } from './PrintLayer'
import { SchedulePrintDoc, FairnessPrintDoc } from './PrintDocuments'

export default function Dashboard() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const queryClient = useQueryClient()
  const tier = profile?.product_tier ?? undefined
  const { data, isLoading, isError } = useDashboardData(vesselId)

  // Vessel name for export headers (shared cache key with the A1 button).
  const { data: vessel } = useQuery({
    queryKey: ['vessel-name', vesselId],
    enabled: !!vesselId,
    queryFn: async () => (await supabase.from('vessels').select('name,crew_change_warning_dismissed_at,settings_change_warning_dismissed_at,schedule_coverage_warning_dismissed_at').eq('id', vesselId!).maybeSingle()).data,
    staleTime: 60_000,
  })
  const vesselName = vessel?.name ?? 'Vessel'

  // Browser-print export (PDF/Print) for the schedule + fairness surfaces.
  const [printTarget, setPrintTarget] = useState<PrintTarget>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [fairnessOpen, setFairnessOpen] = useState(false)
  const [coverageDismissedLocally, setCoverageDismissedLocally] = useState(false)
  const clearPrint = useCallback(() => setPrintTarget(null), [])
  usePrintWhenSet(printTarget, clearPrint)
  // Stamps only the sources currently showing, so acknowledging a crew change
  // never hides a later settings change (or the reverse).
  const dismissUnappliedNotice = useMutation({
    mutationFn: async (sources: { crew: boolean; settings: boolean }) => {
      if (!vesselId) throw new Error('No vessel')
      const now = new Date().toISOString()
      const patch = {
        ...(sources.crew ? { crew_change_warning_dismissed_at: now } : {}),
        ...(sources.settings ? { settings_change_warning_dismissed_at: now } : {}),
      }
      const { error } = await supabase.from('vessels').update(patch).eq('id', vesselId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vessel-name', vesselId] }),
  })
  const dismissCoverageWarning = useMutation({
    mutationFn: async () => {
      if (!vesselId) throw new Error('No vessel')
      const { error } = await supabase.from('vessels').update({ schedule_coverage_warning_dismissed_at: new Date().toISOString() }).eq('id', vesselId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vessel-name', vesselId] }),
    onError: () => setCoverageDismissedLocally(false),
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading dashboard…
      </div>
    )
  }
  if (isError || !data) {
    return <p className="text-ws-sm text-ws-alert">Couldn't load the dashboard. Please refresh.</p>
  }

  // Crew or watch configuration changed since the current schedule was
  // generated? (Crew edits bump updated_at; every configuration save rewrites
  // watch_settings.) Gentle nudge to regenerate — settings only reach the
  // engine on generation, so without this the schedule looks like it ignored them.
  const latestCrewChange = data.crew.reduce<string | null>((latest, crew) => !latest || crew.updated_at > latest ? crew.updated_at : latest, null)
  const unapplied = (changedAt: string | null, dismissedAt: string | null | undefined) =>
    !!data.schedule && !!changedAt && changedAt > data.schedule.generated_at && (!dismissedAt || changedAt > dismissedAt)
  const crewChanged = unapplied(latestCrewChange, vessel?.crew_change_warning_dismissed_at)
  const settingsChanged = unapplied(data.settingsUpdatedAt, vessel?.settings_change_warning_dismissed_at)

  return (
    <div className="space-y-ws-6">
      <div className="flex flex-wrap items-end justify-between gap-ws-4">
        <div>
          <h1 className="font-display text-ws-xl tracking-ws-tight text-ws-offwhite">Watch schedule</h1>
        </div>
        <div className="relative flex items-center gap-ws-2">
          <RegenerateButton vesselId={vesselId} hasSchedule={!!data.schedule} />
          <div className="flex items-center overflow-hidden rounded-ws-sm border border-ws-line-strong bg-ws-navy-deep shadow-ws-sm">
            <ScheduleChat inline compact />
            <span className="h-5 w-px bg-ws-line" aria-hidden />
            <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-haspopup="menu" aria-label="More schedule actions" title="More schedule actions" className="flex h-10 w-10 items-center justify-center text-ws-text-muted transition-colors hover:bg-ws-steel-3 hover:text-ws-text">
              <MoreHorizontal className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          {moreOpen && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-ws-2 flex w-56 flex-col gap-ws-1 rounded-ws-md border border-ws-line bg-ws-steel-2 p-ws-2 shadow-ws-lg">
              <ScheduleHistoryButton data={data} />
              <CopyWhatsAppButton data={data} />
              <ScheduleExportButtons hasSchedule={!!data.schedule} onPrint={() => setPrintTarget('schedule')} />
            </div>
          )}
        </div>
      </div>

      {(crewChanged || settingsChanged) && (
        <div className="relative flex items-start gap-ws-2 rounded-ws-sm border border-ws-warn bg-ws-steel-2 p-ws-3 pr-ws-11">
          <div className="flex items-start gap-ws-2">
            <AlertTriangle className="mt-ws-1 h-4 w-4 shrink-0 text-ws-warn" strokeWidth={1.5} aria-hidden />
            <p className="text-ws-sm text-ws-text">
              {crewChanged && settingsChanged ? 'Crew and watch settings have changed' : settingsChanged ? 'Watch settings have changed' : 'Crew has changed'} since the last generation — regenerate to update the schedule.
            </p>
          </div>
          <button type="button" onClick={() => dismissUnappliedNotice.mutate({ crew: crewChanged, settings: settingsChanged })} disabled={dismissUnappliedNotice.isPending} aria-label="Dismiss regeneration notice" className="absolute right-ws-2 top-ws-2 flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-text disabled:opacity-50"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
        </div>
      )}

      <WatchCalendar
        data={data}
        coverageWarningDismissedAt={coverageDismissedLocally ? new Date().toISOString() : vessel?.schedule_coverage_warning_dismissed_at ?? null}
        onDismissCoverageWarning={() => { setCoverageDismissedLocally(true); dismissCoverageWarning.mutate() }}
        dismissingCoverageWarning={dismissCoverageWarning.isPending}
      />

      <section className="flex flex-wrap items-center justify-between gap-ws-4 rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <div>
          <p className="ws-eyebrow">— Fairness</p>
          <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Crew balance at a glance</h2>
          <p className="mt-ws-2 text-ws-sm text-ws-text-muted">{data.ledger.length > 0 ? `${data.ledger.length} current balance records, updated with your schedule.` : 'Generate a schedule to see crew balance.'}</p>
        </div>
        <button type="button" onClick={() => setFairnessOpen(true)} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3">View fairness calculator</button>
      </section>

      {fairnessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="fairness-calculator-title">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
            <div className="mb-ws-4 flex items-center justify-between gap-ws-3">
              <div>
                <p className="ws-eyebrow">— Fairness calculator</p>
                <h2 id="fairness-calculator-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Per-crew balance</h2>
              </div>
              <div className="flex items-center gap-ws-2">
                <FairnessExportButtons data={data} vesselName={vesselName} onPrint={() => setPrintTarget('fairness')} />
                <button type="button" onClick={() => setFairnessOpen(false)} aria-label="Close fairness calculator" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
              </div>
            </div>
            <FairnessPanel data={data} vesselName={vesselName} onPrint={() => setPrintTarget('fairness')} showHeading={false} showExport={false} />
          </div>
        </div>
      )}

      {printTarget && (
        <PrintLayer>
          {printTarget === 'schedule'
            ? <SchedulePrintDoc data={data} vesselName={vesselName} tier={tier} />
            : <FairnessPrintDoc data={data} vesselName={vesselName} tier={tier} />}
        </PrintLayer>
      )}
    </div>
  )
}
