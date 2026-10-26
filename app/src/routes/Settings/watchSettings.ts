import { z } from 'zod'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import type { Database } from '../../types/db'
export type Tier = Database['public']['Enums']['product_tier']
export type WeekendStructure = Database['public']['Enums']['weekend_structure']
export const WEEKEND_STRUCTURES: WeekendStructure[] = ['per_day', 'sat_sun_block', 'fri_sat_sun_block']
export const WEEKEND_STRUCTURE_LABEL: Record<WeekendStructure, string> = {
  per_day: 'One person per day', sat_sun_block: 'One person covers Sat + Sun', fri_sat_sun_block: 'One person covers Fri + Sat + Sun',
}
export const DEPT_LABEL: Record<Department, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }
export const laneMaxForTier = (tier: Tier) => tier === 'triple' ? 3 : tier === 'dual' ? 2 : 1
export const todayISO = () => new Date().toISOString().slice(0, 10)
export interface WatchSettingsValues {
  lanes: { id?: string; departments: Department[] }[]
  horizon_weeks: number
  schedule_start_date: string
  include_weekends: boolean
  weekday_rotation_anchor: number
  weekend_rotation_anchor: number
  weekend_structure: WeekendStructure
}
export function makeWatchSettingsSchema(tier: Tier) {
  return z.object({
    lanes: z.array(z.object({
      id: z.string().uuid().optional(),
      departments: z.array(z.enum(DEPARTMENTS as [Department, ...Department[]])).min(1, 'Select at least one department.').max(4).refine(d => new Set(d).size === d.length, 'No duplicate departments.'),
    })).min(1, 'Use at least one lane.').max(laneMaxForTier(tier), 'Your subscription does not include this many lanes.'),
    horizon_weeks: z.coerce.number().int().min(1).max(13),
    schedule_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
    include_weekends: z.boolean(),
    weekday_rotation_anchor: z.coerce.number().int().min(0),
    weekend_rotation_anchor: z.coerce.number().int().min(0),
    weekend_structure: z.enum(['per_day', 'sat_sun_block', 'fri_sat_sun_block']),
  })
}
