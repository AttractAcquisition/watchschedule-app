// Shared lane matrix for onboarding and settings. Saves atomically on the server.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { InfoTooltip } from '../../components/ui/InfoTooltip'
import { FixedWatches } from './FixedWatches'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import { DEPT_LABEL, effectiveWindow, GENERATION_MODES, GENERATION_MODE_LABEL, laneMaxForTier, makeWatchSettingsSchema, monthBounds, monthOf, todayISO, WEEKEND_STRUCTURES, WEEKEND_STRUCTURE_LABEL, windowDays, type Tier, type WatchSettingsValues as FormValues } from './watchSettings'

const DATE_INPUT = 'w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text focus:border-ws-gold focus:outline-none'
const prettyDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const prettyMonth = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const addDaysISO = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)

const ANCHORS_HELP = 'Sets the initial rotation order before watch history exists. Once schedules have been generated, fairness takes over. Most vessels can leave this at default.'
// onSaveAndRegenerate renders a second submit that persists the form FIRST and
// only then regenerates — settings edits must never reach the engine unsaved.
export interface WatchSettingsFormProps { onSaved?: () => void | Promise<void>; submitLabel?: string; onSaveAndRegenerate?: () => Promise<void> }

export default function WatchSettingsForm({ onSaved, submitLabel = 'Save settings', onSaveAndRegenerate }: WatchSettingsFormProps) {
  const { profile } = useAuth()
  const tier = (profile?.product_tier ?? 'solo') as Tier
  const vesselId = profile?.vessel_id ?? undefined
  const max = laneMaxForTier(tier)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHorizon, setShowHorizon] = useState(false)
  const [showWeekend, setShowWeekend] = useState(false)
  const regenerateAfterSave = useRef(false)
  const [horizonSuggestion, setHorizonSuggestion] = useState<{ suggested_weeks: number; reason: string; confidence: string } | null>(null)
  const [suggestingHorizon, setSuggestingHorizon] = useState(false)
  const { data: configuration, isLoading, error: loadError } = useQuery({
    queryKey: ['watch_configuration', vesselId], enabled: !!vesselId,
    queryFn: async () => {
      const results = await Promise.all([
        supabase.from('watch_settings').select('*').eq('vessel_id', vesselId!).maybeSingle(),
        supabase.from('watch_lanes').select('*').eq('vessel_id', vesselId!).eq('active', true).order('position'),
        supabase.from('lane_departments').select('lane_id,department').eq('vessel_id', vesselId!),
        supabase.from('crew_members').select('department,eligible').eq('vessel_id', vesselId!),
      ])
      for (const result of results) if (result.error) throw result.error
      return { settings: results[0].data, lanes: results[1].data ?? [], memberships: results[2].data ?? [], crew: results[3].data ?? [] }
    },
  })
  const schema = useMemo(() => makeWatchSettingsSchema(tier), [tier])
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { lanes: [{ departments: [...DEPARTMENTS] }], horizon_weeks: 4, schedule_start_date: todayISO(), include_weekends: true, weekday_rotation_anchor: 0, weekend_rotation_anchor: 0, weekend_structure: 'per_day', generation_mode: 'weeks', generation_start_date: '', generation_end_date: '' },
  })
  useEffect(() => {
    if (!configuration) return
    const s = configuration.settings
    reset({
      lanes: configuration.lanes.length ? configuration.lanes.map(l => ({
        id: l.id, departments: configuration.memberships.filter(m => m.lane_id === l.id).map(m => m.department),
      })) : [{ departments: [...DEPARTMENTS] }],
      horizon_weeks: s?.horizon_weeks ?? 4, schedule_start_date: s?.schedule_start_date ?? todayISO(),
      include_weekends: s?.include_weekends ?? true, weekday_rotation_anchor: s?.weekday_rotation_anchor ?? 0,
      weekend_rotation_anchor: s?.weekend_rotation_anchor ?? 0, weekend_structure: s?.weekend_structure ?? 'per_day',
      generation_mode: s?.generation_mode ?? 'weeks',
      generation_start_date: s?.generation_start_date ?? '', generation_end_date: s?.generation_end_date ?? '',
    })
  }, [configuration, reset])
  const lanes = watch('lanes')
  const includeWeekends = watch('include_weekends')
  const mode = watch('generation_mode')
  const windowStart = watch('generation_start_date')
  const windowEnd = watch('generation_end_date')
  const validWindow = mode !== 'weeks' && !!windowStart && !!windowEnd && windowEnd >= windowStart
  // What a run would actually cover: a window already begun clamps to today.
  const effective = validWindow ? effectiveWindow(windowStart, windowEnd) : null
  const windowSummary = mode === 'weeks' ? `${watch('horizon_weeks')} weeks`
    : !validWindow ? 'Not set'
    : mode === 'month' ? prettyMonth(windowStart)
    : `${prettyDate(windowStart).slice(5)} – ${prettyDate(windowEnd).slice(5)}`
  const setWindow = (start: string, end: string) => {
    setValue('generation_start_date', start, { shouldValidate: true, shouldDirty: true })
    setValue('generation_end_date', end, { shouldValidate: true, shouldDirty: true })
    setSaved(false)
  }
  function pickMode(next: FormValues['generation_mode']) {
    setValue('generation_mode', next, { shouldValidate: true, shouldDirty: true })
    setSaved(false)
    if (next === 'weeks') return
    // Seed a sensible window so the control is never empty on arrival.
    const today = todayISO()
    if (next === 'month') {
      const month = windowStart && mode === 'range' ? monthOf(windowStart) : monthOf(today)
      const bounds = monthBounds(month)
      setWindow(bounds.start, bounds.end)
    } else if (!windowStart || !windowEnd || windowEnd < windowStart) {
      setWindow(today, addDaysISO(today, 27))
    }
  }
  const setLanes = (next: FormValues['lanes']) => { setValue('lanes', next, { shouldValidate: true, shouldDirty: true }); setSaved(false) }
  function toggleDept(index: number, dept: Department) {
    setLanes(lanes.map((l, i) => i !== index ? l : { ...l, departments: l.departments.includes(dept) ? l.departments.filter(d => d !== dept) : [...l.departments, dept] }))
  }
  async function onSubmit(values: FormValues) {
    if (!vesselId) return
    const alsoRegenerate = regenerateAfterSave.current
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      const { lanes: pools, ...rest } = values
      // The window dates must be NULL in weeks mode (generation_window_shape).
      const weeks = rest.generation_mode === 'weeks'
      const settings = {
        ...rest,
        generation_start_date: weeks ? null : rest.generation_start_date,
        generation_end_date: weeks ? null : rest.generation_end_date,
      }
      const { error } = await supabase.rpc('save_watch_configuration', { p_settings: settings, p_lanes: pools })
      if (error) throw error
      await Promise.all(['watch_configuration', 'watch_settings', 'lane_groups', 'dashboard', 'settings_reconcile'].map(key => queryClient.invalidateQueries({ queryKey: [key, vesselId] })))
      setSaved(true)
      await onSaved?.()
      if (alsoRegenerate && onSaveAndRegenerate) await onSaveAndRegenerate()
    } catch (err) { setSaveError(err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Could not save settings.') }
    finally { regenerateAfterSave.current = false; setSaving(false) }
  }
  async function suggestHorizon() {
    setSuggestingHorizon(true)
    try {
      const { data, error } = await supabase.functions.invoke<{ suggested_weeks: number; reason: string; confidence: string }>('suggest-generation-horizon', { body: {} })
      if (error) throw error
      setHorizonSuggestion(data ?? null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not calculate a horizon recommendation.')
    } finally { setSuggestingHorizon(false) }
  }
  if (isLoading) return <p className="text-ws-sm text-ws-text-muted">Loading settings…</p>
  if (loadError) return <p role="alert" className="text-ws-sm text-ws-alert">Could not load watch configuration. Please refresh.</p>
  return (
    <form onSubmit={handleSubmit(onSubmit, () => { regenerateAfterSave.current = false })} onChange={() => setSaved(false)} className="space-y-ws-6">
      <div className="space-y-ws-3">
        <div className="flex items-center justify-between gap-ws-3">
          <div>
            <h3 className="font-medium text-ws-text">Daily watch lanes</h3>
            <p className="text-ws-sm text-ws-text-muted">{lanes.length} of {max} lanes in use · one person per lane, per day</p>
          </div>
          {lanes.length < max && <button type="button" onClick={() => setLanes([...lanes, { departments: [] }])} className="text-ws-sm text-ws-gold hover:text-ws-gold-bright">Add lane</button>}
        </div>
        <div className="overflow-x-auto rounded-ws-sm border border-ws-line">
          <table className="w-full min-w-[32rem] text-left text-ws-sm">
            <thead className="bg-ws-steel-3 text-ws-text-muted"><tr>
              <th className="p-ws-3 font-medium">Lane</th>
              {DEPARTMENTS.map(d => <th key={d} className="p-ws-3 text-center font-medium">{DEPT_LABEL[d]}</th>)}
              <th className="p-ws-3 font-medium">Pool</th><th><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{lanes.map((lane, i) => {
              const count = configuration?.crew.filter(c => c.eligible && c.department && lane.departments.includes(c.department)).length ?? 0
              return <tr key={lane.id ?? i} className="border-t border-ws-line">
                <th className="p-ws-3 font-medium text-ws-text">Lane {i + 1}</th>
                {DEPARTMENTS.map(d => <td key={d} className="p-ws-3 text-center"><input type="checkbox" aria-label={`Lane ${i + 1}: ${DEPT_LABEL[d]}`} checked={lane.departments.includes(d)} onChange={() => toggleDept(i, d)} className="h-4 w-4 accent-ws-gold" /></td>)}
                <td className={`p-ws-3 ${count ? 'text-ws-text-muted' : 'text-ws-alert'}`}>{count} crew</td>
                <td className="p-ws-3">{lanes.length > 1 && <button type="button" aria-label={`Remove lane ${i + 1}`} onClick={() => setLanes(lanes.filter((_, n) => n !== i))} className="text-ws-xs text-ws-text-muted hover:text-ws-alert">Remove</button>}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {errors.lanes && <p role="alert" className="text-ws-sm text-ws-alert">Use 1–{max} lanes and select at least one department in every lane.</p>}
        <p className="text-ws-xs text-ws-text-muted">Departments can appear in multiple lanes. Crew are never assigned twice on the same day. Unselected departments do not take part.</p>
        <p className="text-ws-xs text-ws-text-faint">Fairness is compared across the whole vessel. Small, separate pools may carry more watches per person. Changes apply when you regenerate; watch history is kept.</p>
      </div>
      <div className="grid gap-ws-3 sm:grid-cols-3">
        <button type="button" onClick={() => setShowHorizon((s) => !s)} aria-expanded={showHorizon} className="flex items-center justify-between rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-3 text-left text-ws-sm font-medium text-ws-text transition-colors hover:border-ws-gold hover:bg-ws-steel-3">
          <span>Generation window</span><span className="font-mono text-ws-xs text-ws-text-faint">{showHorizon ? 'Hide' : windowSummary}</span>
        </button>
        <button type="button" onClick={() => setShowWeekend((s) => !s)} aria-expanded={showWeekend} className="flex items-center justify-between rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-3 text-left text-ws-sm font-medium text-ws-text transition-colors hover:border-ws-gold hover:bg-ws-steel-3">
          <span>Weekend settings</span><span className="font-mono text-ws-xs text-ws-text-faint">{showWeekend ? 'Hide' : includeWeekends ? 'On' : 'Off'}</span>
        </button>
        <button type="button" onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced} className="flex items-center justify-between rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-3 text-left text-ws-sm font-medium text-ws-text transition-colors hover:border-ws-gold hover:bg-ws-steel-3">
          <span>Advanced</span><span className="font-mono text-ws-xs text-ws-text-faint">{showAdvanced ? 'Hide' : 'Optional'}</span>
        </button>
      </div>

      {showHorizon && <div className="space-y-ws-4 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-4">
        <fieldset className="space-y-ws-2">
          <legend className="block text-ws-sm font-medium text-ws-text">How much to generate</legend>
          <div className="grid gap-ws-2 sm:grid-cols-3">
            {GENERATION_MODES.map((m) => (
              <label key={m} className={`flex items-center gap-ws-2 rounded-ws-sm border px-ws-3 py-ws-2 text-ws-sm text-ws-text ${mode === m ? 'border-ws-gold bg-ws-gold-ghost' : 'border-ws-line'}`}>
                <input type="radio" name="generation_mode" value={m} checked={mode === m} onChange={() => pickMode(m)} className="h-4 w-4 accent-ws-gold" />
                <span>{GENERATION_MODE_LABEL[m]}</span>
              </label>
            ))}
          </div>
          <p className="font-mono text-ws-xs text-ws-text-faint">Any shape, up to 91 days (~3 months).</p>
        </fieldset>

        {mode === 'weeks' && <>
          <div className="flex flex-wrap items-center justify-between gap-ws-3 border-t border-ws-line pt-ws-4">
            <div><p className="text-ws-sm font-medium text-ws-text">Generation horizon</p><p className="text-ws-xs text-ws-text-faint">Choose manually or ask the scheduler to compare 1–13 weeks.</p></div>
            <button type="button" onClick={suggestHorizon} disabled={suggestingHorizon} className="rounded-ws-sm border border-ws-gold px-ws-3 py-ws-2 text-ws-xs font-medium text-ws-gold hover:bg-ws-gold-ghost disabled:opacity-60">{suggestingHorizon ? 'Calculating…' : 'Suggest fairest horizon'}</button>
          </div>
          {horizonSuggestion && <div className="rounded-ws-sm border border-ws-gold bg-ws-gold-ghost px-ws-3 py-ws-3 text-ws-sm text-ws-text"><span className="font-semibold text-ws-gold">Suggested: {horizonSuggestion.suggested_weeks} weeks.</span> {horizonSuggestion.reason} <button type="button" onClick={() => setValue('horizon_weeks', horizonSuggestion.suggested_weeks, { shouldValidate: true, shouldDirty: true })} className="ml-ws-2 text-ws-gold underline underline-offset-2">Use this</button></div>}
          <div className="grid gap-ws-4 sm:grid-cols-2">
            <div className="space-y-ws-2">
              <label htmlFor="horizon" className="block text-ws-sm font-medium text-ws-text-muted">Generation horizon (weeks)</label>
              <input id="horizon" type="number" min={1} max={13} {...register('horizon_weeks', { valueAsNumber: true })} className={DATE_INPUT} />
              <p className="font-mono text-ws-xs text-ws-text-faint">Max 13 weeks (~3 months).</p>
              {errors.horizon_weeks && <p role="alert" className="text-ws-sm text-ws-alert">{errors.horizon_weeks.message}</p>}
            </div>
            <div className="space-y-ws-2">
              <label htmlFor="start" className="block text-ws-sm font-medium text-ws-text-muted">Schedule start date</label>
              <input id="start" type="date" {...register('schedule_start_date')} className={DATE_INPUT} />
              <p className="text-ws-xs text-ws-text-faint">For your first schedule. Regeneration always starts today.</p>
              {errors.schedule_start_date && <p role="alert" className="text-ws-sm text-ws-alert">{errors.schedule_start_date.message}</p>}
            </div>
          </div>
        </>}

        {mode === 'month' && <div className="space-y-ws-2 border-t border-ws-line pt-ws-4">
          <label htmlFor="gen-month" className="block text-ws-sm font-medium text-ws-text-muted">Month to generate</label>
          <input
            id="gen-month" type="month" className={`${DATE_INPUT} sm:max-w-xs`}
            value={windowStart ? monthOf(windowStart) : ''}
            onChange={(e) => { const m = e.target.value; if (!m) return; const b = monthBounds(m); setWindow(b.start, b.end) }}
          />
          <p className="text-ws-xs text-ws-text-faint">Covers the 1st to the last day of that month. A later month is fine — you can plan ahead.</p>
        </div>}

        {mode === 'range' && <div className="grid gap-ws-4 border-t border-ws-line pt-ws-4 sm:grid-cols-2">
          <div className="space-y-ws-2">
            <label htmlFor="gen-from" className="block text-ws-sm font-medium text-ws-text-muted">From</label>
            <input id="gen-from" type="date" className={DATE_INPUT} value={windowStart} onChange={(e) => setWindow(e.target.value, windowEnd)} />
          </div>
          <div className="space-y-ws-2">
            <label htmlFor="gen-to" className="block text-ws-sm font-medium text-ws-text-muted">To</label>
            <input id="gen-to" type="date" className={DATE_INPUT} value={windowEnd} min={windowStart || undefined} onChange={(e) => setWindow(windowStart, e.target.value)} />
          </div>
        </div>}

        {mode !== 'weeks' && <>
          {(errors.generation_start_date || errors.generation_end_date) && (
            <p role="alert" className="text-ws-sm text-ws-alert">{errors.generation_start_date?.message ?? errors.generation_end_date?.message}</p>
          )}
          {effective && windowDays(windowStart, windowEnd) <= 91 && (
            <div className="rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-3 text-ws-sm text-ws-text">
              <span className="font-semibold text-ws-gold">Generates {prettyDate(effective.start)} – {prettyDate(effective.end)}</span>
              <span className="font-mono text-ws-xs text-ws-text-faint"> · {windowDays(effective.start, effective.end)} days</span>
              {effective.start !== windowStart && <p className="mt-ws-1 text-ws-xs text-ws-text-muted">Starts today because {prettyDate(windowStart)} has passed — watches already stood are never rewritten.</p>}
              {effective.start > todayISO() && <p className="mt-ws-1 text-ws-xs text-ws-text-muted">Starts in the future. Your current rota stays on the dashboard until then.</p>}
            </div>
          )}
        </>}
      </div>}

      {showWeekend && <div className="space-y-ws-3 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-4">
        <label className="flex items-center gap-ws-3">
          <input type="checkbox" {...register('include_weekends')} className="h-4 w-4 accent-ws-gold" />
          <span className="text-ws-sm text-ws-text">Schedule weekend watches (Sat/Sun) — {includeWeekends ? 'on' : 'off'}</span>
        </label>
        {includeWeekends && <fieldset className="space-y-ws-2">
          <legend className="block text-ws-sm font-medium text-ws-text-muted">Weekend coverage</legend>
          <div className="grid gap-ws-2 sm:grid-cols-3">
            {WEEKEND_STRUCTURES.map((ws) => <label key={ws} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line px-ws-3 py-ws-2 text-ws-sm text-ws-text"><input type="radio" value={ws} {...register('weekend_structure')} className="h-4 w-4 accent-ws-gold" /><span>{WEEKEND_STRUCTURE_LABEL[ws]}</span></label>)}
          </div>
          <p className="font-mono text-ws-xs text-ws-text-faint">Block modes assign one person across the whole weekend (and Friday); fairness still counts each covered day.</p>
        </fieldset>}
      </div>}

      {/* Advanced: rotation anchors (optional) */}
      {showAdvanced && <div className="rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-4">
        <div className="flex items-center gap-ws-2">
          <p className="text-ws-sm font-medium text-ws-text-muted">Rotation anchors</p>
          <InfoTooltip text={ANCHORS_HELP} label="About rotation anchors" />
        </div>
        {showAdvanced && (
          <div className="mt-ws-3 grid gap-ws-4 sm:grid-cols-2">
            <div className="space-y-ws-2">
              <label htmlFor="wda" className="block text-ws-sm font-medium text-ws-text-muted">Weekday rotation anchor</label>
              <input id="wda" type="number" min={0} {...register('weekday_rotation_anchor', { valueAsNumber: true })}
                className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text focus:border-ws-gold focus:outline-none" />
            </div>
            <div className="space-y-ws-2">
              <label htmlFor="wea" className="block text-ws-sm font-medium text-ws-text-muted">Weekend rotation anchor</label>
              <input id="wea" type="number" min={0} {...register('weekend_rotation_anchor', { valueAsNumber: true })}
                className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text focus:border-ws-gold focus:outline-none" />
            </div>
          </div>
        )}
        {/* docs/fixed-watches.md — needs saved lanes to pin against, so it stays
            hidden until the configuration has been saved at least once. */}
        {!!configuration?.lanes.length && <FixedWatches />}
      </div>}

      {saveError && <p role="alert" className="text-ws-sm text-ws-alert">{saveError}</p>}
      {saved && !saving && <p role="status" className="text-ws-sm text-ws-ok">Settings saved.</p>}

      <div className="flex flex-wrap items-center justify-end gap-ws-3">
        <button
          type="submit"
          disabled={saving}
          className={onSaveAndRegenerate
            ? 'flex items-center gap-ws-2 rounded-ws-sm border border-ws-gold px-ws-5 py-ws-2 font-ui font-semibold text-ws-gold transition-all hover:bg-ws-gold-ghost disabled:border-ws-line disabled:text-ws-text-faint'
            : 'flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-5 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint'}
        >
          {saving && !regenerateAfterSave.current && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
        {onSaveAndRegenerate && (
          <button
            type="submit"
            onClick={() => { regenerateAfterSave.current = true }}
            disabled={saving}
            className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-5 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
          >
            {saving && regenerateAfterSave.current
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            Save &amp; regenerate
          </button>
        )}
      </div>
    </form>
  )
}
