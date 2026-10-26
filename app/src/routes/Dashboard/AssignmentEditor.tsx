// AssignmentEditor — change who stands one lane's watch on one day
// (docs/manual-override.md). The captain picks a cell on the calendar, picks a
// replacement, and consents — explicitly, rule by rule — to anything the swap
// breaks. The client holds NO rota rules: the `override-assignment` Edge
// Function lists the candidates, states what each one would break, and applies
// the change; fairness is recomputed server-side by the ordinary replay.
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Check, Loader2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { dashboardKey, type DashboardData } from './useDashboardData'

interface Violation { code: string; severity: 'rule' | 'caution'; message: string }
interface Blocker { code: string; message: string }
interface Option { crew_id: string; full_name: string; in_lane: boolean; violations: Violation[]; blockers: Blocker[] }
interface OverrideResponse {
  days?: string[]
  current_crew_id?: string | null
  options?: Option[]
  requires_consent?: boolean
  blocked?: boolean
  violations?: Violation[]
  blockers?: Blocker[]
  applied?: boolean
  error?: string
}

export interface EditorTarget { laneId: string; laneLabel: string; date: string }

const CLEAR = 'none'
const dayLabel = (d: string) => format(parseISO(d), 'EEE d MMM')

async function callOverride(body: Record<string, unknown>): Promise<OverrideResponse> {
  const { data, error } = await supabase.functions.invoke<OverrideResponse>('override-assignment', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    const payload = context ? await context.json().catch(() => null) as OverrideResponse | null : null
    throw new Error(payload?.error ?? "That change didn't go through. Please try again.")
  }
  if (data?.error) throw new Error(data.error)
  return data ?? {}
}

export function AssignmentEditor({ data, target, vesselId, onClose }: {
  data: DashboardData
  target: EditorTarget
  vesselId: string | undefined
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [options, setOptions] = useState<Option[] | null>(null)
  const [days, setDays] = useState<string[]>([target.date])
  const [currentCrewId, setCurrentCrewId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [consented, setConsented] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    callOverride({ watch_date: target.date, lane_id: target.laneId })
      .then((res) => {
        if (!live) return
        setOptions(res.options ?? [])
        setDays(res.days?.length ? res.days : [target.date])
        setCurrentCrewId(res.current_crew_id ?? null)
      })
      .catch((err: Error) => live && setError(err.message))
    return () => { live = false }
  }, [target.date, target.laneId])

  const option = options?.find((o) => o.crew_id === selected) ?? null
  const violations = useMemo(() => (selected === CLEAR ? [] : option?.violations ?? []), [option, selected])
  const ready = selected !== null && violations.every((v) => consented.has(v.code))

  async function apply() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const res = await callOverride({
        watch_date: target.date, lane_id: target.laneId,
        crew_id: selected === CLEAR ? null : selected,
        acknowledge: [...consented],
      })
      // The server re-checks with the live rota: it can still refuse, or find a
      // rule the listing didn't (someone else edited in the meantime).
      if (res.blocked) { setError(res.blockers?.[0]?.message ?? 'That change is not possible.'); return }
      if (res.requires_consent) {
        setOptions((prev) => prev?.map((o) => (o.crew_id === selected ? { ...o, violations: res.violations ?? [] } : o)) ?? prev)
        setConsented(new Set())
        setError('The rota moved under this change — please confirm what it breaks again.')
        return
      }
      await queryClient.invalidateQueries({ queryKey: dashboardKey(vesselId) })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const span = days.length > 1 ? `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}` : dayLabel(days[0])
  const currentName = currentCrewId ? data.crewById.get(currentCrewId)?.full_name ?? 'Unknown' : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-labelledby="assignment-editor-title">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-ws-lg border border-ws-line bg-ws-steel-2 shadow-ws-lg">
        <div className="flex items-start justify-between gap-ws-3 border-b border-ws-line p-ws-5 pb-ws-4">
          <div>
            <p className="ws-eyebrow">— Change watch</p>
            <h3 id="assignment-editor-title" className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">{target.laneLabel} · {span}</h3>
            <p className="mt-ws-1 text-ws-sm text-ws-text-muted">
              {currentName ? <>On watch: <span className="font-mono text-ws-text">{currentName}</span></> : 'Nobody is on watch.'}
              {days.length > 1 && ' — this weekend block moves together.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-ws-5 pt-ws-4">
          {!options && !error && (
            <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking who can stand this watch…</p>
          )}

          {options && (
            <ul className="space-y-ws-1" role="radiogroup" aria-label="Crew for this watch">
              {options.map((o) => {
                const crew = data.crewById.get(o.crew_id)
                const blocked = o.blockers.length > 0
                const rules = o.violations.filter((v) => v.severity === 'rule').length
                const isCurrent = o.crew_id === currentCrewId
                return (
                  <li key={o.crew_id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected === o.crew_id}
                      disabled={blocked || isCurrent}
                      onClick={() => { setSelected(o.crew_id); setConsented(new Set()); setError(null) }}
                      title={blocked ? o.blockers[0].message : undefined}
                      className={`flex w-full items-center justify-between gap-ws-3 rounded-ws-sm border px-ws-3 py-ws-2 text-left transition-all disabled:opacity-40 ${
                        selected === o.crew_id ? 'border-ws-gold bg-ws-steel-3' : 'border-ws-line bg-ws-steel hover:border-ws-line-strong enabled:hover:bg-ws-steel-3'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-ui text-ws-sm font-medium text-ws-text">{o.full_name}</span>
                        <span className="block truncate text-ws-xs text-ws-text-muted">
                          {crew?.position ?? '—'}{crew?.department ? ` · ${crew.department}` : ''}{isCurrent ? ' · on watch' : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-ws-2 text-ws-xs">
                        {blocked ? <span className="flex items-center gap-ws-1 text-ws-text-faint"><Ban className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Unavailable</span>
                          : rules > 0 ? <span className="flex items-center gap-ws-1 text-ws-alert"><AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Breaks {rules} rule{rules > 1 ? 's' : ''}</span>
                          : o.violations.length > 0 ? <span className="flex items-center gap-ws-1 text-ws-warn"><AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Check</span>
                          : !o.in_lane ? <span className="text-ws-text-faint">Other department</span>
                          : <span className="flex items-center gap-ws-1 text-ws-fair-high"><Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Clear</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
              {currentCrewId && (
                <li>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected === CLEAR}
                    onClick={() => { setSelected(CLEAR); setConsented(new Set()); setError(null) }}
                    className={`w-full rounded-ws-sm border px-ws-3 py-ws-2 text-left text-ws-sm transition-all ${
                      selected === CLEAR ? 'border-ws-gold bg-ws-steel-3 text-ws-text' : 'border-ws-line bg-ws-steel text-ws-text-muted hover:border-ws-line-strong hover:bg-ws-steel-3'
                    }`}
                  >
                    Leave this watch unassigned
                  </button>
                </li>
              )}
            </ul>
          )}

          {violations.length > 0 && (
            <div className="mt-ws-4 rounded-ws-sm border border-ws-warn bg-ws-steel p-ws-3">
              <p className="flex items-center gap-ws-2 font-ui text-ws-sm font-medium text-ws-text">
                <AlertTriangle className="h-4 w-4 text-ws-warn" strokeWidth={1.5} aria-hidden /> Confirm each rule you are overriding
              </p>
              <ul className="mt-ws-3 space-y-ws-2">
                {violations.map((v) => (
                  <li key={v.code}>
                    <label className="flex cursor-pointer items-start gap-ws-2 text-ws-sm text-ws-text-muted">
                      <input
                        type="checkbox"
                        checked={consented.has(v.code)}
                        onChange={(e) => setConsented((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(v.code); else next.delete(v.code)
                          return next
                        })}
                        className="mt-ws-1 h-4 w-4 shrink-0 accent-ws-gold"
                      />
                      <span><span className={v.severity === 'rule' ? 'text-ws-alert' : 'text-ws-warn'}>{v.severity === 'rule' ? 'Rule' : 'Caution'}</span> — {v.message}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p role="alert" className="mt-ws-4 text-ws-sm text-ws-alert">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-ws-3 border-t border-ws-line p-ws-5 pt-ws-4">
          <p className="text-ws-xs text-ws-text-faint">Fairness updates now. Regenerating replaces manual changes.</p>
          <div className="flex shrink-0 gap-ws-3">
            <button type="button" onClick={onClose} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text transition-all hover:bg-ws-steel-3">Cancel</button>
            <button
              type="button"
              onClick={apply}
              disabled={!ready || saving}
              className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {saving ? 'Applying…' : 'Apply change'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
