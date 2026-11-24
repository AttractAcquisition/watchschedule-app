// A2 — Schedule History (read-only). Surfaces past GENERATED schedules (audit
// established there is no approval/publish/lock lifecycle — see additions.md A2).
// Pure surface: lists prior `schedules` for the vessel via the existing
// SELECT-only vessel-scoped RLS (no migration, no new policy), each openable
// read-only to view that version's `watch_assignments` (which persist intact for
// regenerated-away schedules). No edit, no regenerate-from, no revert. Tokens only.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, ArrowLeft, History, Loader2, RotateCcw, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { WatchCalendar } from './WatchCalendar'
import { deriveScheduleVersions, type HistSchedule } from './scheduleVersions'
import { dashboardKey, scheduleLanes, type Assignment, type DashboardData, type Lane } from './useDashboardData'
import { useQueryClient } from '@tanstack/react-query'

export function ScheduleHistoryButton({ data, onRestored }: { data: DashboardData; onRestored?: () => void }) {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<HistSchedule | null>(null)
  // Restoring copies a version forward into a new live one — see
  // docs/calendar-restore.md. The original is never altered.
  const [restoring, setRestoring] = useState<HistSchedule | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  async function restore(version: HistSchedule) {
    setBusy(true); setRestoreError(null)
    try {
      const { data, error } = await supabase.functions.invoke<{ error?: string }>('restore-rota', {
        body: { action: 'restore_version', source_schedule_id: version.id },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await queryClient.invalidateQueries({ queryKey: dashboardKey(vesselId) })
      await queryClient.invalidateQueries({ queryKey: ['schedule_history', vesselId] })
      setRestoring(null); setOpen(false); setSelected(null)
      onRestored?.()
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Could not restore that version.')
    } finally { setBusy(false) }
  }

  const { data: schedules, isLoading } = useQuery({
    queryKey: ['schedule_history', vesselId],
    enabled: !!vesselId && open,
    queryFn: async () => {
      const { data, error } = await supabase.from('schedules').select('id,generated_at,start_date,end_date,is_current,horizon_weeks,rota_snapshot').eq('vessel_id', vesselId!)
      if (error) throw error
      return data as HistSchedule[]
    },
  })
  // all lanes (incl. retired) so a historical schedule's lane labels resolve
  const { data: allLanes } = useQuery({
    queryKey: ['all_lanes', vesselId],
    enabled: !!vesselId && open,
    queryFn: async () => (await supabase.from('watch_lanes').select('id,kind,department,label,active').eq('vessel_id', vesselId!)).data as Lane[],
  })
  // selected version's assignments (persist intact for regenerated-away schedules)
  const { data: histAssignments, isLoading: loadingAsg } = useQuery({
    queryKey: ['hist_assignments', selected?.id],
    enabled: !!selected,
    queryFn: async () => (await supabase.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday').eq('schedule_id', selected!.id).order('watch_date')).data as Assignment[],
  })

  const versions = useMemo(() => (schedules ? deriveScheduleVersions(schedules) : []), [schedules])

  // build a read-only DashboardData for the selected historical schedule
  const histData: DashboardData | null = useMemo(() => {
    if (!selected || !histAssignments) return null
    const lanes = scheduleLanes(selected.rota_snapshot, allLanes ?? [], histAssignments)
    // This version's OWN rostered days — a historical view shows one version in
    // isolation, never the canonical union the live calendar resolves.
    const snapshot = selected.rota_snapshot as { scheduled_dates?: string[] } | null
    const histScheduledDates = [...new Set(snapshot?.scheduled_dates ?? histAssignments.map((a) => a.watch_date))].sort()
    return { schedule: { id: selected.id, start_date: selected.start_date, end_date: selected.end_date, horizon_weeks: selected.horizon_weeks, generated_at: selected.generated_at }, assignments: histAssignments, ledger: [], crew: data.crew, lanes, crewById: data.crewById, charters: [], leave: [], settingsUpdatedAt: null, plannedStart: null, hasPriorRota: false, scheduledDates: histScheduledDates }
  }, [selected, histAssignments, allLanes, data.crew, data.crewById])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[40px] items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3"
      >
        <History className="h-4 w-4" strokeWidth={1.5} aria-hidden /> History
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-ws-lg border border-ws-line bg-ws-steel-2 shadow-ws-lg">
            <header className="flex items-center justify-between border-b border-ws-line px-ws-5 py-ws-3">
              <div className="flex items-center gap-ws-2">
                {selected && (
                  <button type="button" onClick={() => setSelected(null)} aria-label="Back to list" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                    <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  </button>
                )}
                <span className="font-display text-ws-md font-semibold text-ws-offwhite">
                  {selected ? `Schedule v${versions.find((v) => v.id === selected.id)?.version ?? ''} — read-only` : 'Schedule history'}
                </span>
              </div>
              <button type="button" onClick={() => { setOpen(false); setSelected(null) }} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </header>

            <div className="overflow-y-auto p-ws-5">
              {!selected ? (
                isLoading ? (
                  <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading history…</p>
                ) : versions.length === 0 ? (
                  <p className="text-ws-sm text-ws-text-muted">No schedules generated yet.</p>
                ) : (
                  <ul className="space-y-ws-2">
                    {versions.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(v)}
                          className="flex w-full items-center justify-between gap-ws-3 rounded-ws-sm border border-ws-line bg-ws-steel px-ws-4 py-ws-3 text-left transition-all hover:border-ws-gold hover:bg-ws-steel-3"
                        >
                          <div>
                            <p className="flex items-center gap-ws-2 text-ws-sm font-medium text-ws-text">
                              <span className="font-mono text-ws-gold">v{v.version}</span>
                              {v.is_current && <span className="rounded-ws-full border border-ws-gold px-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold">Current</span>}
                            </p>
                            <p className="mt-ws-1 text-ws-xs text-ws-text-muted">
                              Generated {format(parseISO(v.generated_at), 'd MMM yyyy, HH:mm')} · covers {format(parseISO(v.start_date), 'd MMM')}–{format(parseISO(v.end_date), 'd MMM yyyy')}
                            </p>
                          </div>
                          <span className="font-mono text-ws-xs text-ws-text-faint">open →</span>
                        </button>
                        {!v.is_current && (
                          <button
                            type="button"
                            onClick={() => { setRestoring(v); setRestoreError(null) }}
                            className="mt-ws-1 flex items-center gap-ws-2 rounded-ws-sm px-ws-2 py-ws-1 text-ws-xs text-ws-text-muted transition-colors hover:text-ws-gold"
                          >
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Make this the live schedule
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              ) : loadingAsg || !histData ? (
                <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading schedule…</p>
              ) : (
                <WatchCalendar data={histData} />
              )}
            </div>
          </div>
        </div>
      )}

      {restoring && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="restore-version-title">
          <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
            <p className="ws-eyebrow">— Restore a version</p>
            <h3 id="restore-version-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">
              Make v{versions.find((v) => v.id === restoring.id)?.version ?? ''} the live schedule?
            </h3>
            <p className="mt-ws-3 text-ws-sm text-ws-text-muted">
              This copies that version forward as a new live schedule covering{' '}
              {format(parseISO(restoring.start_date), 'd MMM')}–{format(parseISO(restoring.end_date), 'd MMM yyyy')},
              and recalculates fairness from it. The version you are restoring is left untouched, and the schedule it
              replaces stays in this list.
            </p>
            <p className="mt-ws-3 flex items-start gap-ws-2 text-ws-xs text-ws-warn">
              <AlertTriangle className="mt-ws-1 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
              <span>Any manual changes made since then are not carried over — they stay on their own version.</span>
            </p>
            {restoreError && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{restoreError}</p>}
            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={() => setRestoring(null)} disabled={busy} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text hover:bg-ws-steel-3">Cancel</button>
              <button type="button" onClick={() => restore(restoring)} disabled={busy} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:opacity-60">
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
