// Dashboard data — all reads are RLS-scoped client selects (the client reads
// the schedule + fairness; it never computes them). One hook assembles the
// current schedule, its assignments, the fairness ledger, crew, and active lanes.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/db'

export type Crew = Pick<Database['public']['Tables']['crew_members']['Row'], 'id' | 'full_name' | 'position' | 'department' | 'eligible' | 'updated_at'>
export type Lane = Pick<Database['public']['Tables']['watch_lanes']['Row'], 'id' | 'kind' | 'department' | 'label' | 'active'> & { departments?: string[] }
export type Assignment = Pick<Database['public']['Tables']['watch_assignments']['Row'], 'lane_id' | 'crew_id' | 'watch_date' | 'day_type' | 'is_friday' | 'is_manual'>
export type LedgerRow = Pick<
  Database['public']['Tables']['vessel_fairness']['Row'],
  'crew_id' | 'total_watches' | 'weekday_watches' | 'weekend_watches' | 'friday_watches' | 'last_watch_date' | 'consecutive_run' | 'fairness_score' | 'balance' | 'weekday_opportunities' | 'weekend_opportunities' | 'history_estimated'
>
export type Schedule = Pick<Database['public']['Tables']['schedules']['Row'], 'id' | 'start_date' | 'end_date' | 'horizon_weeks' | 'generated_at'> & { engine_version?: number; rota_snapshot?: Database['public']['Tables']['schedules']['Row']['rota_snapshot'] }
export type Charter = Pick<Database['public']['Tables']['charter_periods']['Row'], 'id' | 'start_date' | 'end_date' | 'label'>
export type Leave = Pick<Database['public']['Tables']['crew_leave']['Row'], 'id' | 'crew_member_id' | 'start_date' | 'end_date'>

export interface DashboardData {
  schedule: Schedule | null
  assignments: Assignment[]
  ledger: LedgerRow[]
  crew: Crew[]
  lanes: Lane[] // active only, ordered
  crewById: Map<string, Crew>
  charters: Charter[] // B7 — booked charter windows (Paused state on the calendar)
  leave: Leave[] // C3 — booked per-crew leave (calendar "away" indicator)
  // Any configuration save (lanes, horizon, weekend structure) touches this row,
  // so it dates the configuration behind the current schedule.
  settingsUpdatedAt: string | null
  // Set when the current schedule has not started yet (a planned-ahead window,
  // schedule.md §5.1). Dates before it are served by the superseded schedule
  // that still covers them — the same per-date winner rule as canonicalHistory.
  plannedStart: string | null
  interimScheduledDates: string[]
}

export const dashboardKey = (vesselId: string | undefined) => ['dashboard', vesselId] as const

export function useDashboardData(vesselId: string | undefined) {
  return useQuery({
    queryKey: dashboardKey(vesselId),
    enabled: !!vesselId,
    queryFn: async (): Promise<DashboardData> => {
      const inputs = await Promise.all([
        supabase.from('schedules').select('id,start_date,end_date,horizon_weeks,generated_at,engine_version,rota_snapshot').eq('vessel_id', vesselId!).eq('is_current', true).maybeSingle(),
        supabase.from('crew_members').select('id,full_name,position,department,eligible,updated_at').eq('vessel_id', vesselId!).order('full_name'),
        supabase.from('watch_lanes').select('id,kind,department,label,active').eq('vessel_id', vesselId!).order('position'),
        supabase.from('charter_periods').select('id,start_date,end_date,label').eq('vessel_id', vesselId!).eq('status', 'booked').order('start_date'),
        supabase.from('crew_leave').select('id,crew_member_id,start_date,end_date').eq('vessel_id', vesselId!).eq('status', 'booked'),
        supabase.from('watch_settings').select('updated_at').eq('vessel_id', vesselId!).maybeSingle(),
      ])

      for (const result of inputs) if (result.error) throw result.error
      const [{ data: sched }, { data: crew }, { data: lanes }, { data: charters }, { data: leave }, { data: settings }] = inputs
      const outputs = await Promise.all([
        sched
          ? supabase.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday,is_manual').eq('schedule_id', sched.id).order('watch_date')
          : Promise.resolve({ data: [] as Assignment[], error: null }),
        supabase.from('vessel_fairness').select('crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,last_watch_date,consecutive_run,fairness_score,balance,weekday_opportunities,weekend_opportunities,history_estimated').eq('vessel_id', vesselId!),
      ])

      for (const result of outputs) if (result.error) throw result.error
      const [{ data: assignments }, { data: ledger }] = outputs
      const crewList = (crew ?? []) as Crew[]
      const laneList = scheduleLanes(sched?.rota_snapshot, (lanes ?? []) as Lane[], (assignments ?? []) as Assignment[])

      // A planned-ahead schedule must not blank out the rota the crew are
      // currently working: fill the days before it from the newest schedule
      // that still covers them, for lanes the configuration kept.
      const today = new Date().toISOString().slice(0, 10)
      const plannedStart = sched && sched.start_date > today ? sched.start_date : null
      let merged = (assignments ?? []) as Assignment[]
      let interimScheduledDates: string[] = []
      if (sched && plannedStart) {
        const prior = await supabase.from('schedules').select('id,rota_snapshot').eq('vessel_id', vesselId!)
          .neq('id', sched.id).lte('start_date', today).gte('end_date', today)
          .order('generated_at', { ascending: false }).limit(1).maybeSingle()
        if (prior.error) throw prior.error
        if (prior.data) {
          const before = await supabase.from('watch_assignments').select('lane_id,crew_id,watch_date,day_type,is_friday,is_manual')
            .eq('schedule_id', prior.data.id).lt('watch_date', plannedStart).order('watch_date')
          if (before.error) throw before.error
          const laneIds = new Set(laneList.map((l) => l.id))
          const kept = ((before.data ?? []) as Assignment[]).filter((a) => laneIds.has(a.lane_id))
          merged = [...kept, ...merged]
          const snapshot = prior.data.rota_snapshot as { scheduled_dates?: string[] } | null
          interimScheduledDates = (snapshot?.scheduled_dates ?? kept.map((a) => a.watch_date)).filter((d) => d < plannedStart)
        }
      }
      return {
        schedule: (sched ?? null) as Schedule | null,
        assignments: merged,
        ledger: (ledger ?? []) as LedgerRow[],
        crew: crewList,
        lanes: laneList,
        crewById: new Map(crewList.map((c) => [c.id, c])),
        charters: (charters ?? []) as Charter[],
        leave: (leave ?? []) as Leave[],
        settingsUpdatedAt: settings?.updated_at ?? null,
        plannedStart,
        interimScheduledDates,
      }
    },
    staleTime: 30_000,
  })
}

/** Snapshot labels/membership survive edits to the live configuration. */
export function scheduleLanes(snapshot: unknown, fallback: Lane[], assignments: Assignment[]): Lane[] {
  const saved = snapshot as { lanes?: { id: string; label: string; departments: string[]; position: number }[] } | null
  if (Array.isArray(saved?.lanes)) return [...saved.lanes].sort((a,b) => a.position-b.position).map(l => ({ ...l, kind: 'dept', department: null, active: true }))
  const ids = new Set(assignments.map(a => a.lane_id))
  return fallback.filter(l => ids.size ? ids.has(l.id) : l.active)
}
