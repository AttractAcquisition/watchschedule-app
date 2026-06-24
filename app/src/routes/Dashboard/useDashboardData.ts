// Dashboard data — all reads are RLS-scoped client selects (the client reads
// the schedule + fairness; it never computes them). One hook assembles the
// current schedule, its assignments, the fairness ledger, crew, and active lanes.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/db'

export type Crew = Pick<Database['public']['Tables']['crew_members']['Row'], 'id' | 'full_name' | 'position' | 'department' | 'eligible' | 'updated_at'>
export type Lane = Pick<Database['public']['Tables']['watch_lanes']['Row'], 'id' | 'kind' | 'department' | 'label' | 'active'>
export type Assignment = Pick<Database['public']['Tables']['watch_assignments']['Row'], 'lane_id' | 'crew_id' | 'watch_date' | 'day_type' | 'is_friday'>
export type LedgerRow = Pick<
  Database['public']['Tables']['fairness_ledger']['Row'],
  'lane_id' | 'crew_id' | 'total_watches' | 'weekday_watches' | 'weekend_watches' | 'friday_watches' | 'last_watch_date' | 'consecutive_run' | 'fairness_score'
>
export type Schedule = Pick<Database['public']['Tables']['schedules']['Row'], 'id' | 'start_date' | 'end_date' | 'horizon_weeks' | 'generated_at'>

export interface DashboardData {
  schedule: Schedule | null
  assignments: Assignment[]
  ledger: LedgerRow[]
  crew: Crew[]
  lanes: Lane[] // active only, ordered
  crewById: Map<string, Crew>
}

export const dashboardKey = (vesselId: string | undefined) => ['dashboard', vesselId] as const

export function useDashboardData(vesselId: string | undefined) {
  return useQuery({
    queryKey: dashboardKey(vesselId),
    enabled: !!vesselId,
    queryFn: async (): Promise<DashboardData> => {
      const [{ data: sched }, { data: crew }, { data: lanes }] = await Promise.all([
        supabase.from('schedules').select('id,start_date,end_date,horizon_weeks,generated_at').eq('vessel_id', vesselId!).eq('is_current', true).maybeSingle(),
        supabase.from('crew_members').select('id,full_name,position,department,eligible,updated_at').eq('vessel_id', vesselId!).order('full_name'),
        supabase.from('watch_lanes').select('id,kind,department,label,active').eq('vessel_id', vesselId!).eq('active', true).order('label'),
      ])

      const [{ data: assignments }, { data: ledger }] = await Promise.all([
        sched
          ? supabase.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday').eq('schedule_id', sched.id).order('watch_date')
          : Promise.resolve({ data: [] as Assignment[] }),
        supabase.from('fairness_ledger').select('lane_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,last_watch_date,consecutive_run,fairness_score').eq('vessel_id', vesselId!),
      ])

      const crewList = (crew ?? []) as Crew[]
      return {
        schedule: (sched ?? null) as Schedule | null,
        assignments: (assignments ?? []) as Assignment[],
        ledger: (ledger ?? []) as LedgerRow[],
        crew: crewList,
        lanes: (lanes ?? []) as Lane[],
        crewById: new Map(crewList.map((c) => [c.id, c])),
      }
    },
    staleTime: 30_000,
  })
}
