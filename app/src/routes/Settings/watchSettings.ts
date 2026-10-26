import { z } from 'zod'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import type { Database } from '../../types/db'
export type Tier = Database['public']['Enums']['product_tier']
export type WeekendStructure = Database['public']['Enums']['weekend_structure']
export type GenerationMode = Database['public']['Enums']['generation_mode']
export const WEEKEND_STRUCTURES: WeekendStructure[] = ['per_day', 'sat_sun_block', 'fri_sat_sun_block']
export const WEEKEND_STRUCTURE_LABEL: Record<WeekendStructure, string> = {
  per_day: 'One person per day', sat_sun_block: 'One person covers Sat + Sun', fri_sat_sun_block: 'One person covers Fri + Sat + Sun',
}
export const GENERATION_MODES: GenerationMode[] = ['weeks', 'month', 'range']
export const GENERATION_MODE_LABEL: Record<GenerationMode, string> = {
  weeks: 'Number of weeks', month: 'A whole month', range: 'A date range',
}
export const DEPT_LABEL: Record<Department, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }
export const laneMaxForTier = (tier: Tier) => tier === 'triple' ? 3 : tier === 'dual' ? 2 : 1
export const todayISO = () => new Date().toISOString().slice(0, 10)

/** schedule.md §5.1 — one cap for every window shape: 91 days inclusive. */
export const MAX_WINDOW_DAYS = 91
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const windowDays = (start: string, end: string) =>
  Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1
/** A month ("2026-11") as the concrete window the engine is given: 1st..last day. */
export const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}
export const monthOf = (date: string) => date.slice(0, 7)
/** The range a run would actually cover: a window already begun clamps to today. */
export const effectiveWindow = (start: string, end: string, today = todayISO()) =>
  ({ start: start < today ? today : start, end })

export interface WatchSettingsValues {
  lanes: { id?: string; departments: Department[] }[]
  horizon_weeks: number
  schedule_start_date: string
  include_weekends: boolean
  weekday_rotation_anchor: number
  weekend_rotation_anchor: number
  weekend_structure: WeekendStructure
  generation_mode: GenerationMode
  generation_start_date: string
  generation_end_date: string
}
export function makeWatchSettingsSchema(tier: Tier) {
  return z.object({
    lanes: z.array(z.object({
      id: z.string().uuid().optional(),
      departments: z.array(z.enum(DEPARTMENTS as [Department, ...Department[]])).min(1, 'Select at least one department.').max(4).refine(d => new Set(d).size === d.length, 'No duplicate departments.'),
    })).min(1, 'Use at least one lane.').max(laneMaxForTier(tier), 'Your subscription does not include this many lanes.'),
    horizon_weeks: z.coerce.number().int().min(1).max(13),
    schedule_start_date: z.string().regex(ISO_DATE, 'Pick a start date'),
    include_weekends: z.boolean(),
    weekday_rotation_anchor: z.coerce.number().int().min(0),
    weekend_rotation_anchor: z.coerce.number().int().min(0),
    weekend_structure: z.enum(['per_day', 'sat_sun_block', 'fri_sat_sun_block']),
    generation_mode: z.enum(['weeks', 'month', 'range']),
    generation_start_date: z.string(),
    generation_end_date: z.string(),
  // Mirrors the generation_window_shape DB check. A window may START in the
  // future (planning ahead); it may not have already ended.
  }).superRefine((v, ctx) => {
    if (v.generation_mode === 'weeks') return
    const at = (path: 'generation_start_date' | 'generation_end_date', message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    if (!ISO_DATE.test(v.generation_start_date)) return at('generation_start_date', v.generation_mode === 'month' ? 'Pick a month' : 'Pick a start date')
    if (!ISO_DATE.test(v.generation_end_date)) return at('generation_end_date', v.generation_mode === 'month' ? 'Pick a month' : 'Pick an end date')
    if (v.generation_end_date < v.generation_start_date) return at('generation_end_date', 'The end date must be on or after the start date.')
    if (windowDays(v.generation_start_date, v.generation_end_date) > MAX_WINDOW_DAYS) return at('generation_end_date', `A window can cover at most ${MAX_WINDOW_DAYS} days (about 3 months).`)
    if (v.generation_end_date < todayISO()) return at('generation_end_date', 'That window has already passed. Pick one that ends today or later.')
  })
}
