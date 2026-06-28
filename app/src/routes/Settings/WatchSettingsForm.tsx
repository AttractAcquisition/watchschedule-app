// WatchSettingsForm — the SINGLE shared watch-settings form (frontend.md §4.4
// Step 2 + settings-parity note, §8). Mounted in BOTH onboarding Step 2 (now)
// and the /settings page (Phase 11). Build once — there is no second form.
//
// Tier comes from product_tier (read-only, set at payment) and decides the
// department controls: Solo = none (pool is all eligible crew); Dual = 1–2;
// Triple = 1–3 (B5: floor of 1, up to the tier max), from {deck, interior,
// engineering, officer}. Universal
// settings (all tiers): horizon (<=13 weeks), start date, include_weekends, and
// the advanced rotation anchors. Zod enforces the dept-count-matches-tier rule
// client-side; the Phase-1 DB CHECK enforces it again (defence in depth).
//
// On save: persist watch_settings (RLS-scoped) and derive/persist watch_lanes
// per schedule.md §3 (Solo->1 solo lane; Dual->2 dept lanes; Triple->3). Lanes
// are reused when unchanged (stable ledger keys) and only-missing ones inserted;
// removed lanes are never deleted (preserves future fairness history). The
// caller decides what happens after save via `onSaved` (onboarding advances the
// step; /settings just confirms) — so this component carries no flow coupling.
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { InfoTooltip } from '../../components/ui/InfoTooltip'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'

// Item 2 copy — fixed wording (additions-v2.md B2).
const ANCHORS_HELP =
  'Sets which crew member the rotation starts from on a brand-new schedule, before any watch history exists. Once schedules have been generated, fairness takes over automatically and this no longer applies. Most vessels can leave this at default.'
import {
  DEPT_LABEL, deptMaxForTier, makeWatchSettingsSchema, partitionGroups, groupKey, todayISO,
  WEEKEND_STRUCTURES, WEEKEND_STRUCTURE_LABEL,
  type Tier, type WatchSettingsValues as FormValues,
} from './watchSettings'

export interface WatchSettingsFormProps {
  // Called after watch_settings + watch_lanes persist successfully. The mount
  // point decides the follow-up (onboarding: advance step; settings: toast).
  onSaved?: () => void | Promise<void>
  submitLabel?: string
}

export default function WatchSettingsForm({ onSaved, submitLabel = 'Save settings' }: WatchSettingsFormProps) {
  const { profile } = useAuth()
  const tier = (profile?.product_tier ?? 'solo') as Tier
  const vesselId = profile?.vessel_id ?? undefined
  const max = deptMaxForTier(tier)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [vesselName, setVesselName] = useState('')

  // Prefill from an existing row (covers /settings edit and onboarding resume).
  const { data: existing, isLoading } = useQuery({
    queryKey: ['watch_settings', vesselId],
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('watch_settings').select('*').eq('vessel_id', vesselId!).maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Vessel name (item 1) — lives on the vessels table (owner-scoped RLS allows the
  // client to read+write its own row; no migration). Seeds the field; persisted on save.
  const { data: vesselRow } = useQuery({
    queryKey: ['vessel_name', vesselId],
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('vessels').select('name').eq('id', vesselId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
  useEffect(() => { if (vesselRow?.name != null) setVesselName(vesselRow.name) }, [vesselRow])

  const schema = useMemo(() => makeWatchSettingsSchema(tier), [tier])
  const {
    register, handleSubmit, watch, setValue, reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      selected_departments: [], horizon_weeks: 4, schedule_start_date: todayISO(),
      include_weekends: true, weekday_rotation_anchor: 0, weekend_rotation_anchor: 0,
      weekend_structure: 'per_day',
    },
  })

  useEffect(() => {
    if (!existing) return
    reset({
      selected_departments: (existing.selected_departments ?? []) as Department[],
      horizon_weeks: existing.horizon_weeks,
      schedule_start_date: existing.schedule_start_date,
      include_weekends: existing.include_weekends,
      weekday_rotation_anchor: existing.weekday_rotation_anchor ?? 0,
      weekend_rotation_anchor: existing.weekend_rotation_anchor ?? 0,
      weekend_structure: existing.weekend_structure ?? 'per_day',
    })
  }, [existing, reset])

  const selected = watch('selected_departments')
  const includeWeekends = watch('include_weekends')

  // C4 — per-department lane assignment (which group/lane each selected dept is in).
  // Default: each its own lane (groups-of-one). Prefilled from the vessel's current
  // active dept lanes so the group builder round-trips.
  const [groupOf, setGroupOf] = useState<Record<string, number>>({})
  const { data: currentGroups } = useQuery({
    queryKey: ['lane_groups', vesselId],
    enabled: !!vesselId,
    queryFn: async () => {
      const [{ data: ls }, { data: ld }] = await Promise.all([
        supabase.from('watch_lanes').select('id,kind,department,active').eq('vessel_id', vesselId!).eq('active', true),
        supabase.from('lane_departments').select('lane_id,department').eq('vessel_id', vesselId!),
      ])
      const byLane = new Map<string, string[]>()
      for (const r of ld ?? []) { const a = byLane.get(r.lane_id) ?? []; a.push(r.department); byLane.set(r.lane_id, a) }
      return (ls ?? []).filter((l) => l.kind === 'dept').map((l) => byLane.get(l.id) ?? (l.department ? [l.department] : []))
    },
  })
  useEffect(() => {
    if (!currentGroups) return
    const g: Record<string, number> = {}
    currentGroups.forEach((set, i) => set.forEach((d) => { g[d] = i }))
    if (Object.keys(g).length) setGroupOf(g)
  }, [currentGroups])

  function toggleDept(d: Department) {
    const has = selected.includes(d)
    if (has) setValue('selected_departments', selected.filter((x) => x !== d), { shouldValidate: true })
    else if (selected.length < max) setValue('selected_departments', [...selected, d], { shouldValidate: true })
    setSaved(false)
  }

  async function onSubmit(values: FormValues) {
    if (!vesselId) return setSaveError('Session not ready — please refresh.')
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      // 0) vessel name (item 1) — owner-scoped update; refresh the top-bar query.
      const name = vesselName.trim()
      const vn = await supabase.from('vessels').update({ name }).eq('id', vesselId)
      if (vn.error) throw vn.error
      await queryClient.invalidateQueries({ queryKey: ['vessel', vesselId] })

      // 1) watch_settings (one row per vessel; tier mirrors product_tier).
      const up = await supabase.from('watch_settings').upsert(
        {
          vessel_id: vesselId,
          tier,
          selected_departments: values.selected_departments,
          horizon_weeks: values.horizon_weeks,
          schedule_start_date: values.schedule_start_date,
          include_weekends: values.include_weekends,
          weekday_rotation_anchor: values.weekday_rotation_anchor,
          weekend_rotation_anchor: values.weekend_rotation_anchor,
          weekend_structure: values.weekend_structure,
        },
        { onConflict: 'vessel_id' }
      )
      if (up.error) throw up.error

      // 2) reconcile lanes as GROUPS (C4). Match desired groups (department-sets) to
      //    ACTIVE lanes by exact dept-set: unchanged -> carry forward (ledger
      //    preserved); new/changed -> a NEW lane (resets to even at formation —
      //    honest on the post-C2 engine, no fictional counts); an active dept lane no
      //    longer desired -> retire (active=false) + FREE its departments from the
      //    junction so they can be re-grouped. The engine schedules ACTIVE lanes only.
      const { data: active } = await supabase.from('watch_lanes').select('id,kind,department').eq('vessel_id', vesselId).eq('active', true)
      const { data: ld } = await supabase.from('lane_departments').select('lane_id,department').eq('vessel_id', vesselId)
      const deptsByLane = new Map<string, string[]>()
      for (const r of ld ?? []) { const a = deptsByLane.get(r.lane_id) ?? []; a.push(r.department); deptsByLane.set(r.lane_id, a) }
      const laneSetKey = (l: { id: string; department: string | null }) => groupKey((deptsByLane.get(l.id) ?? (l.department ? [l.department] : [])) as Department[])
      const activeDept = (active ?? []).filter((l) => l.kind === 'dept')
      const activeSolo = (active ?? []).filter((l) => l.kind === 'solo')

      if (tier === 'solo') {
        for (const l of activeDept) { await supabase.from('watch_lanes').update({ active: false }).eq('id', l.id); await supabase.from('lane_departments').delete().eq('lane_id', l.id) }
        if (activeSolo.length === 0) {
          const { data: solo } = await supabase.from('watch_lanes').select('id').eq('vessel_id', vesselId).eq('kind', 'solo').maybeSingle()
          if (solo) await supabase.from('watch_lanes').update({ active: true }).eq('id', solo.id)
          else { const r = await supabase.from('watch_lanes').insert({ vessel_id: vesselId, kind: 'solo', department: null, label: 'Watch', active: true }); if (r.error) throw r.error }
        }
      } else {
        const groups = partitionGroups(values.selected_departments, groupOf)
        const desiredKeys = new Set(groups.map(groupKey))
        // retire active lanes not desired + free their departments (must happen BEFORE
        // creating new lanes so re-grouped departments are unclaimed).
        for (const l of activeDept) if (!desiredKeys.has(laneSetKey(l))) {
          await supabase.from('watch_lanes').update({ active: false }).eq('id', l.id)
          await supabase.from('lane_departments').delete().eq('lane_id', l.id)
        }
        for (const l of activeSolo) await supabase.from('watch_lanes').update({ active: false }).eq('id', l.id)
        const carriedKeys = new Set(activeDept.filter((l) => desiredKeys.has(laneSetKey(l))).map(laneSetKey))
        for (const g of groups) {
          if (carriedKeys.has(groupKey(g))) continue // unchanged group -> carry (ledger preserved)
          const label = g.map((d) => DEPT_LABEL[d]).join(' & ')
          const { data: lane, error: le } = await supabase.from('watch_lanes').insert({ vessel_id: vesselId, kind: 'dept', department: [...g].sort()[0], label, active: true }).select('id').single()
          if (le || !lane) throw le ?? new Error('lane insert failed')
          const insLd = await supabase.from('lane_departments').insert(g.map((d) => ({ vessel_id: vesselId, lane_id: lane.id, department: d })))
          if (insLd.error) throw insLd.error
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['lane_groups', vesselId] })

      setSaved(true)
      await onSaved?.()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading settings…
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-ws-6">
      {/* Tier badge */}
      <div className="flex items-center gap-ws-2">
        <span className="ws-eyebrow">— Watch settings</span>
        <span className="rounded-ws-full border border-ws-gold px-ws-2 py-ws-1 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold">
          {tier} watch
        </span>
      </div>

      {/* Vessel name (item 1) — shows in the top bar and feeds exports. */}
      <div className="space-y-ws-2">
        <label htmlFor="vessel_name" className="block text-ws-sm font-medium text-ws-text-muted">Vessel name</label>
        <input
          id="vessel_name" type="text" value={vesselName} onChange={(e) => { setVesselName(e.target.value); setSaved(false) }}
          placeholder="M/Y Serenity" maxLength={120}
          className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none"
        />
        <p className="font-mono text-ws-xs text-ws-text-faint">Displayed in the top bar; used on shared schedules.</p>
      </div>

      {/* Department selection (Dual/Triple only) */}
      {tier === 'solo' ? (
        <p className="rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3 text-ws-sm text-ws-text-muted">
          Solo Watch runs one lane from <span className="text-ws-text">all eligible crew</span> — no department selection.
        </p>
      ) : (
        <div>
          <label className="block text-ws-sm font-medium text-ws-text-muted">
            Watch departments — choose 1–{max}
          </label>
          <div className="mt-ws-3 grid grid-cols-2 gap-ws-3 sm:grid-cols-4">
            {DEPARTMENTS.map((d) => {
              const on = selected.includes(d)
              const full = !on && selected.length >= max
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDept(d)}
                  aria-pressed={on}
                  disabled={full}
                  className={[
                    'rounded-ws-sm border px-ws-3 py-ws-3 text-ws-sm font-medium transition-all',
                    on
                      ? 'border-ws-gold bg-ws-gold-ghost text-ws-gold'
                      : full
                        ? 'border-ws-line text-ws-text-faint'
                        : 'border-ws-line-strong text-ws-text hover:border-ws-gold hover:bg-ws-steel-3',
                  ].join(' ')}
                >
                  {DEPT_LABEL[d]}
                </button>
              )
            })}
          </div>
          <p className="mt-ws-2 font-mono text-ws-xs text-ws-text-faint">{selected.length}/{max} selected (min 1)</p>
          {errors.selected_departments && (
            <p role="alert" className="mt-ws-2 text-ws-sm text-ws-alert">{errors.selected_departments.message}</p>
          )}

          {/* C4 — Watch Groups: combine departments into a shared lane (one pooled
              rotation). Default = each its own lane. Same lane number = combined. */}
          {selected.length > 1 && (
            <div className="mt-ws-4 space-y-ws-2 border-t border-ws-line pt-ws-3">
              <p className="text-ws-sm font-medium text-ws-text-muted">Watch lanes — combine departments into one pooled rotation (optional)</p>
              <div className="space-y-ws-2">
                {selected.map((d, idx) => (
                  <label key={d} className="flex items-center justify-between gap-ws-3 text-ws-sm text-ws-text">
                    <span>{DEPT_LABEL[d]}</span>
                    <select
                      value={groupOf[d] ?? idx}
                      onChange={(e) => { setGroupOf({ ...groupOf, [d]: Number(e.target.value) }); setSaved(false) }}
                      className="rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none"
                    >
                      {selected.map((_, i) => <option key={i} value={i}>Lane {i + 1}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <p className="font-mono text-ws-xs text-ws-text-faint">
                {partitionGroups(selected, groupOf).map((g, i) => `Lane ${i + 1}: ${g.map((x) => DEPT_LABEL[x]).join(' & ')}`).join('  ·  ')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Universal settings */}
      <div className="grid gap-ws-4 sm:grid-cols-2">
        <div className="space-y-ws-2">
          <label htmlFor="horizon" className="block text-ws-sm font-medium text-ws-text-muted">
            Generation horizon (weeks)
          </label>
          <input
            id="horizon" type="number" min={1} max={13}
            {...register('horizon_weeks', { valueAsNumber: true })}
            className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text focus:border-ws-gold focus:outline-none"
          />
          <p className="font-mono text-ws-xs text-ws-text-faint">Max 13 weeks (~3 months).</p>
          {errors.horizon_weeks && <p role="alert" className="text-ws-sm text-ws-alert">{errors.horizon_weeks.message}</p>}
        </div>

        <div className="space-y-ws-2">
          <label htmlFor="start" className="block text-ws-sm font-medium text-ws-text-muted">Schedule start date</label>
          <input
            id="start" type="date"
            {...register('schedule_start_date')}
            className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text focus:border-ws-gold focus:outline-none"
          />
          {errors.schedule_start_date && <p role="alert" className="text-ws-sm text-ws-alert">{errors.schedule_start_date.message}</p>}
        </div>
      </div>

      <label className="flex items-center gap-ws-3">
        <input type="checkbox" {...register('include_weekends')} className="h-4 w-4 accent-ws-gold" />
        <span className="text-ws-sm text-ws-text">
          Schedule weekend watches (Sat/Sun) — {includeWeekends ? 'on' : 'off'}
        </span>
      </label>

      {/* Weekend structure (B6) — only meaningful when weekends are scheduled. */}
      {includeWeekends && (
        <fieldset className="space-y-ws-2">
          <legend className="block text-ws-sm font-medium text-ws-text-muted">Weekend coverage</legend>
          <div className="space-y-ws-2">
            {WEEKEND_STRUCTURES.map((ws) => (
              <label key={ws} className="flex items-center gap-ws-3">
                <input type="radio" value={ws} {...register('weekend_structure')} className="h-4 w-4 accent-ws-gold" />
                <span className="text-ws-sm text-ws-text">{WEEKEND_STRUCTURE_LABEL[ws]}</span>
              </label>
            ))}
          </div>
          <p className="font-mono text-ws-xs text-ws-text-faint">
            Block modes assign one person across the whole weekend (and Friday); fairness still counts each covered day.
          </p>
        </fieldset>
      )}

      {/* Advanced: rotation anchors (optional) */}
      <div>
        <div className="flex items-center gap-ws-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-ws-sm font-medium text-ws-gold hover:text-ws-gold-bright"
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced rotation anchors
          </button>
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
      </div>

      {saveError && <p role="alert" className="text-ws-sm text-ws-alert">{saveError}</p>}
      {saved && !saving && <p role="status" className="text-ws-sm text-ws-ok">Settings saved.</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-5 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
