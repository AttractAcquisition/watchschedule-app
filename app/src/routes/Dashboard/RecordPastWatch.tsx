// RecordPastWatch — put a crew member on a past day the rota never covered
// (docs/history-import.md).
//
// The sibling of AssignmentEditor. That one CHANGES who stood a watch the
// engine planned, so it carries the engine's rules and their consent gates.
// This one RECORDS a watch that was stood on a day no generation reaches —
// before the vessel's first schedule, or after a clear. There is no plan to
// break, so there are no rules to consent to: it is a statement of fact, and
// it goes through the same `import-watch-history` path as a CSV.
//
// Past days only. The generator owns what is still to come.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { dashboardKey, type DashboardData } from './useDashboardData'
import type { EditorTarget } from './AssignmentEditor'

export function RecordPastWatch({ data, target, vesselId, onClose, onRecorded }: {
  data: DashboardData
  target: EditorTarget
  vesselId: string | undefined
  onClose: () => void
  onRecorded?: () => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Everyone on the crew list, eligible or not: a departed crew member still
  // stood the watches they stood.
  const crew = useMemo(() => [...data.crew].sort((a, b) => a.full_name.localeCompare(b.full_name)), [data.crew])
  const dayLabel = format(parseISO(target.date), 'EEE d MMM yyyy')

  async function record() {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke<{ error?: string; applied?: boolean; imported?: number }>(
        'import-watch-history', { body: { records: [{ crew_id: selected, watch_date: target.date }] } },
      )
      if (fnError) throw fnError
      if (res?.error) throw new Error(res.error)
      if (!res?.applied || !res?.imported) throw new Error('That watch was not recorded. Please try again.')
      await queryClient.invalidateQueries({ queryKey: dashboardKey(vesselId) })
      onRecorded?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that watch.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="record-past-title">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
        <div className="flex items-start justify-between gap-ws-3">
          <div>
            <p className="ws-eyebrow">— Record a past watch</p>
            <h3 id="record-past-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">{dayLabel}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <p className="mt-ws-2 text-ws-sm text-ws-text-muted">
          No schedule covers this day, so this records who actually stood it. It goes onto the calendar
          and fairness recounts from it.
        </p>

        <div className="mt-ws-4 min-h-0 flex-1 overflow-y-auto">
          <label htmlFor="record-past-crew" className="block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Who stood it</label>
          <select
            id="record-past-crew"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-ws-2 w-full rounded-ws-sm border border-ws-line-strong bg-ws-navy-deep px-ws-3 py-ws-2 text-ws-sm text-ws-text"
          >
            <option value="">Choose a crew member…</option>
            {crew.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}{c.eligible ? '' : ' (no longer on watch)'}</option>
            ))}
          </select>
          <p className="mt-ws-2 text-ws-xs text-ws-text-faint">
            Someone who has left the vessel is still listed, so their watches stay on the record.
          </p>
          {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
        </div>

        <div className="mt-ws-5 flex justify-end gap-ws-3">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text transition-all hover:bg-ws-steel-3">Cancel</button>
          <button type="button" onClick={record} disabled={saving || !selected}
            className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? 'Recording…' : 'Record watch'}
          </button>
        </div>
      </div>
    </div>
  )
}
