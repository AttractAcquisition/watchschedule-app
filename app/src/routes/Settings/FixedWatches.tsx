// FixedWatches (docs/fixed-watches.md) — Settings → Watch configuration →
// Advanced. The captain names a crew member for a specific date BEFORE the rota
// is built; generation honours it and plans everything else around it under the
// ordinary fairness rules.
//
// Pins live in `watch_pins`, a captain CONFIGURATION table (client-RW,
// vessel-scoped — the crew_leave / charter_periods pattern). This component
// evaluates nothing: `generate-schedule`'s preview says what each pin covers
// and breaks, and consent writes back only the codes the server named.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, Ban, Check, Loader2, Pin, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { InfoTooltip } from '../../components/ui/InfoTooltip'
import { acknowledgePin, previewPins, type EvaluatedPin } from './fixedWatches'

const HELP =
  'Put a specific crew member on watch on a specific date. Generation keeps that watch exactly as set and balances everything else around it — the fixed watch still counts towards their fairness, so they get correspondingly less elsewhere. Pins stay until you delete them, so regenerating keeps them.'

const fmt = (d: string) => format(parseISO(d), 'EEE d MMM yyyy')
const shortFmt = (d: string) => format(parseISO(d), 'EEE d MMM')
const todayISO = () => new Date().toISOString().slice(0, 10)

export function FixedWatches() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const qc = useQueryClient()
  const pinsKey = useMemo(() => ['watch_pins', vesselId], [vesselId])
  const previewKey = useMemo(() => ['watch_pins_preview', vesselId], [vesselId])

  const { data: refs } = useQuery({
    queryKey: ['fixed_watch_refs', vesselId],
    enabled: !!vesselId,
    queryFn: async () => {
      const [crew, lanes, schedules] = await Promise.all([
        supabase.from('crew_members').select('id,full_name').eq('vessel_id', vesselId!).order('full_name'),
        supabase.from('watch_lanes').select('id,label,position').eq('vessel_id', vesselId!).eq('active', true).order('position'),
        supabase.from('schedules').select('id').eq('vessel_id', vesselId!).limit(1),
      ])
      for (const r of [crew, lanes, schedules]) if (r.error) throw r.error
      return { crew: crew.data ?? [], lanes: lanes.data ?? [], hasSchedule: (schedules.data ?? []).length > 0 }
    },
  })

  const { data: pins, isLoading } = useQuery({
    queryKey: pinsKey,
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('watch_pins')
        .select('id,crew_member_id,lane_id,watch_date,acknowledged').eq('vessel_id', vesselId!).order('watch_date')
      if (error) throw error
      return data
    },
  })

  // Server-evaluated status for every pin. Refetched whenever a pin changes.
  const { data: preview, isFetching: checking, error: previewError } = useQuery({
    queryKey: previewKey,
    enabled: !!vesselId && !!refs,
    queryFn: () => previewPins(refs!.hasSchedule),
    retry: false,
  })

  const [crewId, setCrewId] = useState('')
  const [laneId, setLaneId] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const lanes = refs?.lanes ?? []
  const soleLane = lanes.length === 1 ? lanes[0].id : ''
  const chosenLane = laneId || soleLane
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: pinsKey })
    qc.invalidateQueries({ queryKey: previewKey })
    qc.invalidateQueries({ queryKey: ['dashboard', vesselId] })
  }

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('watch_pins')
        .insert({ vessel_id: vesselId!, crew_member_id: crewId, lane_id: chosenLane, watch_date: date })
      if (error) throw error
    },
    onSuccess: () => { setDate(''); setError(null); invalidate() },
    onError: (e: { code?: string }) => setError(e?.code === '23505'
      ? 'That day is already taken — either this watch lane or this crew member is already fixed to it.'
      : 'Could not add that fixed watch.'),
  })
  const removeM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('watch_pins').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { setError(null); invalidate() },
    onError: () => setError('Could not remove that fixed watch.'),
  })
  const ackM = useMutation({
    mutationFn: ({ id, codes }: { id: string; codes: string[] }) => acknowledgePin(id, codes),
    onSuccess: invalidate,
    onError: () => setError('Could not save that acknowledgement.'),
  })

  const busy = addM.isPending || removeM.isPending || ackM.isPending
  const canAdd = !!crewId && !!chosenLane && !!date
  const crewName = (id: string) => refs?.crew.find((c) => c.id === id)?.full_name ?? 'crew'
  const laneLabel = (id: string) => lanes.find((l) => l.id === id)?.label ?? 'lane'

  // Prefer the server's evaluation; fall back to the raw rows if it is unavailable.
  const rows: EvaluatedPin[] = preview?.pins?.length || !pins?.length
    ? preview?.pins ?? []
    : pins.map((p) => ({
        id: p.id, crew_id: p.crew_member_id, crew_name: crewName(p.crew_member_id),
        lane_id: p.lane_id, lane_label: laneLabel(p.lane_id), watch_date: p.watch_date,
        days: [p.watch_date], applies: true, inert_reason: null,
        violations: [], blockers: [], unacknowledged: [],
      }))
  const storedAck = (id: string) => pins?.find((p) => p.id === id)?.acknowledged ?? []
  const toggle = (pinId: string, code: string) => {
    const stored = storedAck(pinId)
    ackM.mutate({ id: pinId, codes: stored.includes(code) ? stored.filter((c) => c !== code) : [...stored, code] })
  }

  return (
    <div className="mt-ws-4 border-t border-ws-line pt-ws-4">
      <div className="flex items-center gap-ws-2">
        <Pin className="h-4 w-4 text-ws-gold" strokeWidth={1.5} aria-hidden />
        <p className="text-ws-sm font-medium text-ws-text-muted">Fixed watches</p>
        <InfoTooltip text={HELP} label="About fixed watches" />
      </div>
      <p className="mt-ws-2 text-ws-xs text-ws-text-muted">
        Set a crew member on watch for a specific date. The rest of the schedule is generated around it, with the normal
        fairness rules — a fixed watch counts towards their standing like any other.
      </p>

      {/* add — a plain div, never a nested <form>: this panel lives inside the settings form */}
      <div className="mt-ws-3 flex flex-wrap items-end gap-ws-2 rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-3">
        <div className="min-w-[10rem] flex-1">
          <label htmlFor="pin-crew" className="block text-ws-xs text-ws-text-muted">Crew member</label>
          <select id="pin-crew" value={crewId} onChange={(e) => setCrewId(e.target.value)}
            className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-2 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
            <option value="">Select…</option>
            {(refs?.crew ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        {lanes.length > 1 && (
          <div className="min-w-[8rem] flex-1">
            <label htmlFor="pin-lane" className="block text-ws-xs text-ws-text-muted">Watch lane</label>
            <select id="pin-lane" value={laneId} onChange={(e) => setLaneId(e.target.value)}
              className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-2 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
              <option value="">Select…</option>
              {lanes.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="pin-date" className="block text-ws-xs text-ws-text-muted">Date</label>
          <input id="pin-date" type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)}
            className="mt-ws-1 rounded-ws-sm border border-ws-line bg-ws-steel-2 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
        </div>
        <button type="button" disabled={busy || !canAdd} onClick={() => addM.mutate()}
          className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
          {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Fix watch
        </button>
      </div>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
      {previewError && (
        <p className="mt-ws-3 text-ws-xs text-ws-text-faint">
          Couldn't check these against the next schedule ({(previewError as Error).message}) — they are still saved.
        </p>
      )}
      {preview?.start_date && (
        <p className="mt-ws-3 font-mono text-ws-xs text-ws-text-faint">
          Next generation covers {shortFmt(preview.start_date)} – {shortFmt(preview.end_date)}
          {checking && ' · rechecking…'}
        </p>
      )}

      <div className="mt-ws-3 space-y-ws-2">
        {isLoading ? (
          <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading fixed watches…</p>
        ) : rows.length ? (
          rows.map((p) => {
            const rules = p.violations.filter((v) => v.severity === 'rule').length
            const answered = p.applies && !p.unacknowledged.length && !p.blockers.length
            return (
              <div key={p.id} className={`rounded-ws-sm border bg-ws-steel-2 px-ws-4 py-ws-3 ${
                p.blockers.length ? 'border-ws-alert' : p.unacknowledged.length ? 'border-ws-warn' : 'border-ws-line'
              } ${p.applies ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-center justify-between gap-ws-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-ws-2 text-ws-sm font-medium text-ws-text">
                      <span>{p.crew_name}</span>
                      <span className="font-mono text-ws-xs text-ws-text-muted">
                        {p.days.length > 1 ? `${shortFmt(p.days[0])} – ${shortFmt(p.days[p.days.length - 1])}` : fmt(p.watch_date)}
                      </span>
                      <span className="rounded-ws-full border border-ws-line-strong px-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">{p.lane_label}</span>
                      {p.days.length > 1 && <span className="text-ws-xs text-ws-text-faint">whole block</span>}
                    </p>
                    {!p.applies && p.inert_reason && <p className="mt-ws-1 text-ws-xs text-ws-text-faint">{p.inert_reason}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-ws-3 text-ws-xs">
                    {p.blockers.length ? <span className="flex items-center gap-ws-1 text-ws-alert"><Ban className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Not possible</span>
                      : p.unacknowledged.length ? <span className="flex items-center gap-ws-1 text-ws-warn"><AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Needs {rules > 0 ? 'consent' : 'a check'}</span>
                      : answered ? <span className="flex items-center gap-ws-1 text-ws-ok"><Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Will be applied</span>
                      : <span className="text-ws-text-faint">Not applied</span>}
                    <button type="button" disabled={busy} onClick={() => removeM.mutate(p.id)} aria-label={`Remove fixed watch for ${p.crew_name}`}
                      className="rounded-ws-sm p-ws-1 text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-alert">
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                    </button>
                  </div>
                </div>

                {p.blockers.map((b) => (
                  <p key={b.code} role="alert" className="mt-ws-2 text-ws-xs text-ws-alert">{b.message}</p>
                ))}
                {p.violations.length > 0 && (
                  <ul className="mt-ws-2 space-y-ws-1 border-t border-ws-line pt-ws-2">
                    {p.violations.map((v) => (
                      <li key={v.code}>
                        <label className="flex items-start gap-ws-2 text-ws-xs text-ws-text-muted">
                          <input type="checkbox" disabled={busy} checked={storedAck(p.id).includes(v.code)}
                            onChange={() => toggle(p.id, v.code)}
                            className="mt-ws-1 h-3.5 w-3.5 shrink-0 accent-ws-gold" />
                          <span>
                            <span className={v.severity === 'rule' ? 'text-ws-warn' : 'text-ws-text-faint'}>
                              {v.severity === 'rule' ? 'Breaks a rule — ' : 'Worth checking — '}
                            </span>
                            {v.message}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })
        ) : (
          <p className="text-ws-sm text-ws-text-faint">No fixed watches. Generation balances every day freely.</p>
        )}
      </div>
    </div>
  )
}
