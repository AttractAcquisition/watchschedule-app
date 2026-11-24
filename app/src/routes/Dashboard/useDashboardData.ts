// Dashboard data — all reads are RLS-scoped client selects (the client reads
// the schedule + fairness; it never computes them). One hook assembles the
// rota across every generation, the fairness ledger, crew, and active lanes.
//
// History: regenerating does NOT delete the rota it replaces — the superseded
// `schedules` row keeps its `watch_assignments`, and they keep counting towards
// fairness. So the calendar reads the canonical union of ALL versions (one
// winner per date, `lib/canonicalRota.ts`) rather than the current schedule
// alone. Reading only the current schedule blanked every earlier day the moment
// a new window was generated.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { resolveRota, type RotaRow, type RotaVersion } from '../../lib/canonicalRota'
import type { Database } from '../../types/db'

export type Crew = Pick<Database['public']['Tables']['crew_members']['Row'], 'id' | 'full_name' | 'position' | 'department' | 'eligible' | 'updated_at'>
export type Lane = Pick<Database['public']['Tables']['watch_lanes']['Row'], 'id' | 'kind' | 'department' | 'label' | 'active'> & { departments?: string[]; position?: number }
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
  /**
   * The canonical rota across every generation — history included, one
   * watchkeeper per lane-day. Only the CURRENT schedule's own days are
   * editable; see WatchCalendar's `editable` gate.
   */
  assignments: Assignment[]
  /** Every date any surviving generation rostered — drives gap rendering. */
  scheduledDates: string[]
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
  // schedule.md §5.1). Earlier dates are served by the superseded schedules that
  // still cover them, under the same per-date winner rule as canonicalHistory.
  plannedStart: string | null
  /**
   * The captain cleared the calendar (docs/calendar-restore.md). Every watch is
   * hidden and nothing counts towards fairness, but nothing is deleted. The
   * calendar says so rather than looking like a vessel that never generated.
   */
  calendarCleared: boolean
  /** True when a superseded generation still supplies days the calendar shows. */
  hasPriorRota: boolean
}

export const dashboardKey = (vesselId: string | undefined) => ['dashboard', vesselId] as const

/**
 * Page past PostgREST's row cap. A vessel accumulates one row per lane-day per
 * generation, so a season of history runs well beyond a single response.
 */
async function readAllAssignments(vesselId: string): Promise<RotaRow[]> {
  const rows: RotaRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('watch_assignments')
      .select('schedule_id,lane_id,crew_id,watch_date,day_type,is_friday,is_manual')
      .eq('vessel_id', vesselId)
      .order('watch_date')
      .order('lane_id')
      .range(offset, offset + 999)
    if (error) throw error
    rows.push(...((data ?? []) as RotaRow[]))
    if ((data?.length ?? 0) < 1000) return rows
  }
}

export function useDashboardData(vesselId: string | undefined) {
  return useQuery({
    queryKey: dashboardKey(vesselId),
    enabled: !!vesselId,
    queryFn: async (): Promise<DashboardData> => {
      const inputs = await Promise.all([
        supabase.from('schedules').select('id,start_date,end_date,horizon_weeks,generated_at,engine_version,rota_snapshot,is_current').eq('vessel_id', vesselId!),
        supabase.from('crew_members').select('id,full_name,position,department,eligible,updated_at').eq('vessel_id', vesselId!).order('full_name'),
        // Retired lanes come back too, so a historical lane id still resolves.
        supabase.from('watch_lanes').select('id,kind,department,label,active,position').eq('vessel_id', vesselId!).order('position'),
        supabase.from('charter_periods').select('id,start_date,end_date,label').eq('vessel_id', vesselId!).eq('status', 'booked').order('start_date'),
        supabase.from('crew_leave').select('id,crew_member_id,start_date,end_date').eq('vessel_id', vesselId!).eq('status', 'booked'),
        supabase.from('watch_settings').select('updated_at').eq('vessel_id', vesselId!).maybeSingle(),
        supabase.from('vessel_fairness').select('crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,last_watch_date,consecutive_run,fairness_score,balance,weekday_opportunities,weekend_opportunities,history_estimated').eq('vessel_id', vesselId!),
        // The calendar-clear marker. The ENGINE honours this in its replay; the
        // calendar has to honour it too, or a clear would empty the fairness
        // panel while every watch stayed on screen.
        supabase.from('vessels').select('calendar_cleared_at').eq('id', vesselId!).maybeSingle(),
      ])

      for (const result of inputs) if (result.error) throw result.error
      const [{ data: schedules }, { data: crew }, { data: lanes }, { data: charters }, { data: leave }, { data: settings }, { data: ledger }, { data: vessel }] = inputs

      // A fairness reset deliberately keeps the rota on screen, so only the
      // calendar marker hides versions here.
      const clearedAt = vessel?.calendar_cleared_at ?? null
      const versions = ((schedules ?? []) as (RotaVersion & { is_current: boolean })[])
        .filter((s) => !clearedAt || s.generated_at > clearedAt)
      const sched = versions.find((s) => s.is_current) ?? null
      const rows = sched ? await readAllAssignments(vesselId!) : []

      const crewList = (crew ?? []) as Crew[]
      const allLanes = (lanes ?? []) as Lane[]
      const own = rows.filter((r) => r.schedule_id === sched?.id) as Assignment[]
      const laneList = scheduleLanes(sched?.rota_snapshot, allLanes.filter((l) => l.active), own)

      // One winner per date across every generation — the server's rule, so the
      // calendar and the fairness scores can never disagree about a day.
      const resolved = resolveRota({ versions, rows, lanes: laneList })

      const today = new Date().toISOString().slice(0, 10)
      return {
        schedule: (sched ?? null) as Schedule | null,
        assignments: resolved.assignments as Assignment[],
        scheduledDates: resolved.scheduledDates,
        ledger: (ledger ?? []) as LedgerRow[],
        crew: crewList,
        lanes: laneList,
        crewById: new Map(crewList.map((c) => [c.id, c])),
        charters: (charters ?? []) as Charter[],
        leave: (leave ?? []) as Leave[],
        settingsUpdatedAt: settings?.updated_at ?? null,
        plannedStart: sched && sched.start_date > today ? sched.start_date : null,
        calendarCleared: !!clearedAt,
        hasPriorRota: !!sched && resolved.assignments.some((a) => a.watch_date < sched.start_date),
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
