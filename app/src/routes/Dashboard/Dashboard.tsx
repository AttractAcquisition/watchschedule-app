// /dashboard — the product (frontend.md §4.5). Two regions — the watch calendar
// and the per-crew fairness panel — plus the regenerate action. Renders inside
// the AppShell (top bar: vessel, tier badge, user menu). The client only READS
// the current schedule + fairness ledger via RLS-scoped selects; it computes no
// fairness or schedule math. (The Claude chatbot panel is Phase 10.)
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
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
import { PrintLayer, usePrintWhenSet, type PrintTarget } from './PrintLayer'
import { SchedulePrintDoc, FairnessPrintDoc } from './PrintDocuments'

export default function Dashboard() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const tier = profile?.product_tier ?? undefined
  const { data, isLoading, isError } = useDashboardData(vesselId)

  // Vessel name for export headers (shared cache key with the A1 button).
  const { data: vessel } = useQuery({
    queryKey: ['vessel-name', vesselId],
    enabled: !!vesselId,
    queryFn: async () => (await supabase.from('vessels').select('name').eq('id', vesselId!).maybeSingle()).data,
    staleTime: 60_000,
  })
  const vesselName = vessel?.name ?? 'Vessel'

  // Browser-print export (PDF/Print) for the schedule + fairness surfaces.
  const [printTarget, setPrintTarget] = useState<PrintTarget>(null)
  const clearPrint = useCallback(() => setPrintTarget(null), [])
  usePrintWhenSet(printTarget, clearPrint)

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

  // Crew changed since the current schedule was generated? (edits/adds bump
  // updated_at past generated_at.) Gentle nudge to regenerate.
  const crewChanged = !!data.schedule && data.crew.some((c) => c.updated_at > data.schedule!.generated_at)

  return (
    <div className="space-y-ws-6">
      <div className="flex items-center justify-between gap-ws-4">
        <div>
          <p className="ws-eyebrow">— Dashboard</p>
          <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">Watch overview</h1>
        </div>
        <div className="flex flex-wrap items-center gap-ws-3">
          <ScheduleHistoryButton data={data} />
          <CopyWhatsAppButton data={data} />
          <ScheduleExportButtons hasSchedule={!!data.schedule} onPrint={() => setPrintTarget('schedule')} />
          <RegenerateButton vesselId={vesselId} hasSchedule={!!data.schedule} />
        </div>
      </div>

      {crewChanged && (
        <div className="flex items-start gap-ws-2 rounded-ws-sm border border-ws-warn bg-ws-steel-2 p-ws-3">
          <AlertTriangle className="mt-ws-1 h-4 w-4 shrink-0 text-ws-warn" strokeWidth={1.5} aria-hidden />
          <p className="text-ws-sm text-ws-text">Crew has changed since the last generation — regenerate to update the schedule.</p>
        </div>
      )}

      <WatchCalendar data={data} />
      <FairnessPanel data={data} vesselName={vesselName} onPrint={() => setPrintTarget('fairness')} />

      <ScheduleChat />

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
