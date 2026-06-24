// Pure (no-JSX) logic for the shared watch settings: the tier-aware Zod schema
// and the lane derivation (schedule.md §3). Kept separate from WatchSettingsForm
// so it is unit-testable on its own and reused verbatim by the form. The
// dept-count-matches-tier rule here mirrors the Phase-1 DB CHECK (defence in depth).
import { z } from 'zod'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import type { Database } from '../../types/db'

export type Tier = Database['public']['Enums']['product_tier']

export const DEPT_LABEL: Record<Department, string> = {
  deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer',
}

export const deptCountForTier = (tier: Tier): number => (tier === 'dual' ? 2 : tier === 'triple' ? 3 : 0)

export const todayISO = () => new Date().toISOString().slice(0, 10)

export interface WatchSettingsValues {
  selected_departments: Department[]
  horizon_weeks: number
  schedule_start_date: string
  include_weekends: boolean
  weekday_rotation_anchor: number
  weekend_rotation_anchor: number
}

// Tier-aware schema. The dept-count rule is load-bearing and matches the DB CHECK.
export function makeWatchSettingsSchema(tier: Tier) {
  const want = deptCountForTier(tier)
  return z
    .object({
      selected_departments: z.array(z.enum(DEPARTMENTS as [Department, ...Department[]])),
      horizon_weeks: z.coerce.number().int().min(1, 'At least 1 week').max(13, 'Max 13 weeks (~3 months)'),
      schedule_start_date: z.string().min(1, 'Pick a start date'),
      include_weekends: z.boolean(),
      weekday_rotation_anchor: z.coerce.number().int().min(0),
      weekend_rotation_anchor: z.coerce.number().int().min(0),
    })
    .superRefine((val, ctx) => {
      const depts = val.selected_departments
      if (new Set(depts).size !== depts.length) {
        ctx.addIssue({ code: 'custom', path: ['selected_departments'], message: 'No duplicate departments.' })
      }
      if (depts.length !== want) {
        ctx.addIssue({
          code: 'custom',
          path: ['selected_departments'],
          message:
            tier === 'solo'
              ? 'Solo Watch uses every eligible crew member — no department selection.'
              : `Select exactly ${want} department${want > 1 ? 's' : ''} for ${tier === 'dual' ? 'Dual' : 'Triple'} Watch.`,
        })
      }
    })
}

export interface DerivedLane {
  kind: 'solo' | 'dept'
  department: Department | null
  label: string
}

// schedule.md §3 — Solo -> 1 solo lane; Dual -> 2 dept lanes; Triple -> 3 dept lanes.
// These are the desired ACTIVE lanes for the current settings.
export function deriveLanes(tier: Tier, depts: Department[]): DerivedLane[] {
  if (tier === 'solo') return [{ kind: 'solo', department: null, label: 'Watch' }]
  return depts.map((d) => ({ kind: 'dept', department: d, label: DEPT_LABEL[d] }))
}

export interface ExistingLane {
  kind: 'solo' | 'dept'
  department: Department | null
  active: boolean
}
export interface LaneRef {
  kind: 'solo' | 'dept'
  department: Department | null
}
export interface LanePlan {
  toInsert: DerivedLane[]
  toReactivate: LaneRef[]
  toDeactivate: LaneRef[]
}

const laneKey = (l: { kind: string; department: Department | null }) => `${l.kind}:${l.department ?? ''}`

// Reconcile existing lanes against the desired set (schedule.md §3). Never deletes:
//   - desired lane absent        -> insert (new, active)
//   - desired lane exists+inactive -> re-activate (flip active=true; no duplicate,
//                                     so the ledger key stays stable)
//   - existing active lane not desired -> de-activate (retire; history retained)
// Re-activation is an UPDATE on the unique (vessel_id, kind, department) row, so it
// never conflicts with the unique constraint.
export function reconcileLanes(existing: ExistingLane[], desired: DerivedLane[]): LanePlan {
  const byKey = new Map(existing.map((l) => [laneKey(l), l]))
  const desiredKeys = new Set(desired.map(laneKey))
  const toInsert: DerivedLane[] = []
  const toReactivate: LaneRef[] = []
  for (const d of desired) {
    const e = byKey.get(laneKey(d))
    if (!e) toInsert.push(d)
    else if (!e.active) toReactivate.push({ kind: d.kind, department: d.department })
  }
  const toDeactivate: LaneRef[] = []
  for (const e of existing) {
    if (e.active && !desiredKeys.has(laneKey(e))) toDeactivate.push({ kind: e.kind, department: e.department })
  }
  return { toInsert, toReactivate, toDeactivate }
}
