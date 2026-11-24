// import-watch-history — record watches that were actually stood, typed in by
// hand or uploaded as a CSV (docs/history-import.md).
//
// The 10th canonical Edge Function. It is NOT a second past-schedule parser:
// `seed-fairness` still owns reading a photo of a rota into `rota_seed`. This
// one writes real `watch_assignments`, so imported watches render on the
// calendar, replay through `canonicalHistory` into fairness, and can be
// corrected afterwards by clicking the cell.
//
// Two modes on one contract, like the override:
//   { csv | rows | records, preview: true } -> what would change, writes nothing
//   { csv | rows | records }                -> apply
//
// Invariants kept: vessel_id re-derived from the JWT; the schedule and fairness
// tables written only through the service-role RPC; the fairness numbers are
// the ordinary replay (rota_data + rota_v2), never a second formula.
import { handlePreflight, json } from '../_shared/cors.ts'
import { rotaContext, loadRotaInputs, loadGlobalBase, validISODate, visibleVersions } from '../_shared/rota_data.ts'
import { globalScores, versionOwner, type HistoricalAssignment, type ScheduleVersion, type RotaLane } from '../_shared/rota_v2.ts'
import { isoWeekday } from '../_shared/fairness_engine.ts'
import { contiguousRuns, parseHistoryCsv, resolveHistory, type RawHistoryRow } from '../_shared/history_import.ts'
import { FAR_FUTURE } from '../_shared/manual_override.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RECORDS = 2000

interface Body {
  csv?: string
  rows?: RawHistoryRow[]
  records?: { crew_id: string; watch_date: string; lane_id?: string }[]
  lane_id?: string
  preview?: boolean
}

const dayFields = (d: string) => ({
  day_type: isoWeekday(d) >= 6 ? 'weekend' as const : 'weekday' as const,
  is_friday: isoWeekday(d) === 5,
})

Deno.serve(async req => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
    const { admin, vesselId, revision } = await rotaContext(req)
    const body = await req.json().catch(() => ({})) as Body
    const inputs = await loadRotaInputs(admin, vesselId)
    if (!inputs.lanes.length) throw new Error('Set up your watch lanes before importing past watches.')
    const today = new Date().toISOString().slice(0, 10)

    // --- what was sent -----------------------------------------------------
    // Crew picked by id in the manual table skip name matching entirely; CSV
    // and typed names go through the shared matcher.
    let records: { crew_id: string; watch_date: string; lane?: string }[] = []
    let unmatched: string[] = []
    let rejected: string[] = []
    let parseErrors: string[] = []

    if (Array.isArray(body.records) && body.records.length) {
      const known = new Set(inputs.crew.map(c => c.id))
      const seen = new Map<string, { crew_id: string; watch_date: string }>()
      for (const r of body.records) {
        if (!UUID.test(r.crew_id ?? '') || !known.has(r.crew_id)) { unmatched.push(r.crew_id ?? '(none)'); continue }
        if (!validISODate(r.watch_date ?? '')) { rejected.push(`${r.watch_date}: not a date`); continue }
        if (r.watch_date >= today) { rejected.push(`${r.watch_date}: not a past date`); continue }
        seen.set(`${r.crew_id}:${r.watch_date}`, { crew_id: r.crew_id, watch_date: r.watch_date })
      }
      records = [...seen.values()]
    } else {
      const rows = typeof body.csv === 'string' ? (() => {
        const p = parseHistoryCsv(body.csv!)
        parseErrors = p.errors
        return p.rows
      })() : Array.isArray(body.rows) ? body.rows : []
      const resolved = resolveHistory(rows, inputs.crew as { id: string; full_name: string }[], today)
      records = resolved.records
      unmatched = resolved.unmatched
      rejected = resolved.rejected
    }

    if (!records.length) {
      return json(req, {
        imported: 0, unmatched, rejected, errors: parseErrors,
        error: parseErrors[0] ?? 'Nothing in that import matched your crew on a past date.',
      })
    }
    if (records.length > MAX_RECORDS) throw new Error(`That is more than ${MAX_RECORDS} watches in one go. Split the file.`)

    // --- where each date belongs -------------------------------------------
    const [{ data: scheduleRows, error: se }, { data: assignmentRows, error: ae }] = await Promise.all([
      admin.from('schedules').select('id,start_date,end_date,generated_at,rota_snapshot').eq('vessel_id', vesselId),
      admin.from('watch_assignments').select('schedule_id,lane_id,crew_id,watch_date,day_type,is_friday').eq('vessel_id', vesselId),
    ])
    if (se) throw se
    if (ae) throw ae
    // Only versions the rota still consists of may own a date. After a calendar
    // clear the hidden ones must not claim one, or the import would amend a
    // generation nobody can see and the watch would vanish on arrival.
    const versions = await visibleVersions(admin, vesselId,
      (scheduleRows ?? []) as (ScheduleVersion & { rota_snapshot: { lanes?: RotaLane[]; scheduled_dates?: string[] } | null })[])
    const owner = versionOwner(versions as ScheduleVersion[])

    // The lane an imported watch is filed under. The captain picks one in the
    // UI; it defaults to the first. For a schedule generated before a lane
    // reconfiguration, the lane at the same POSITION in that version is used —
    // the same mapping the calendar and the single-cell override apply.
    const defaultLane = (body.lane_id && inputs.lanes.find(l => l.id === body.lane_id)) || inputs.lanes[0]
    const laneFor = (scheduleId: string | null) => {
      if (!scheduleId) return defaultLane.id
      const snapshotLanes = versions.find(v => v.id === scheduleId)?.rota_snapshot?.lanes
      if (!snapshotLanes?.length) return defaultLane.id
      return (snapshotLanes.find(l => l.id === defaultLane.id)
        ?? snapshotLanes.find(l => l.position === defaultLane.position)
        ?? snapshotLanes[0]).id
    }

    const amendments: { schedule_id: string; lane_id: string; crew_id: string; watch_date: string; day_type: 'weekday' | 'weekend'; is_friday: boolean }[] = []
    const uncovered: { crew_id: string; watch_date: string }[] = []
    for (const r of records) {
      const scheduleId = owner(r.watch_date)
      if (scheduleId) amendments.push({ schedule_id: scheduleId, lane_id: laneFor(scheduleId), crew_id: r.crew_id, watch_date: r.watch_date, ...dayFields(r.watch_date) })
      else uncovered.push({ crew_id: r.crew_id, watch_date: r.watch_date })
    }

    // Dates no generation reaches become their own schedule rows, one per
    // contiguous run so the range never blankets a generated day between them.
    const runs = contiguousRuns(uncovered.map(r => r.watch_date))
    const newVersions = runs.map((run, i) => {
      const dates = new Set(run.dates)
      const assignments = uncovered.filter(r => dates.has(r.watch_date)).map(r => ({
        lane_id: defaultLane.id, crew_id: r.crew_id, watch_date: r.watch_date, ...dayFields(r.watch_date),
      }))
      return {
        pending_id: `pending-${i}`,
        start_date: run.start, end_date: run.end,
        horizon_weeks: Math.max(1, Math.ceil(run.dates.length / 7)),
        snapshot: {
          lanes: inputs.lanes, imported: true,
          scheduled_dates: [...run.dates].sort(),
          // Imported days are evidence of who stood, not of who could have.
          // An empty opportunity list keeps the replay from inventing a
          // denominator nobody recorded; the import is explicitly estimated.
          opportunities: assignments.map(a => ({ crew_id: a.crew_id, watch_date: a.watch_date })),
          weekend_structure: 'per_day',
        },
        assignments,
      }
    })

    // --- fairness, by the ordinary replay over the amended rota -------------
    // The import wins its lane-day, and clears the same person off any other
    // lane that day, so the replay sees exactly what the RPC is about to write.
    const droppedLaneDay = new Set(amendments.map(a => `${a.schedule_id}:${a.lane_id}:${a.watch_date}`))
    const droppedCrewDay = new Set(amendments.map(a => `${a.schedule_id}:${a.crew_id}:${a.watch_date}`))
    const pendingFor = new Map<string, string>()
    for (const v of newVersions) for (const d of v.snapshot.scheduled_dates) pendingFor.set(d, v.pending_id)

    const patched = await loadGlobalBase(admin, vesselId, FAR_FUTURE, inputs, {
      // Price the rows that are about to become their own schedule versions:
      // without these the winner rule would own none of those dates and the
      // whole import would score as nothing.
      versions: rows => [
        ...rows,
        ...newVersions.map(v => ({ id: v.pending_id, start_date: v.start_date, end_date: v.end_date, generated_at: new Date().toISOString(), rota_snapshot: v.snapshot })),
      ] as ScheduleVersion[],
      assignments: rows => [
        ...rows.filter(r =>
          !droppedLaneDay.has(`${r.schedule_id}:${r.lane_id}:${r.watch_date}`)
          && !droppedCrewDay.has(`${r.schedule_id}:${r.crew_id}:${r.watch_date}`)),
        ...amendments as HistoricalAssignment[],
        ...newVersions.flatMap(v => v.assignments.map(a => ({ ...a, schedule_id: v.pending_id }))) as HistoricalAssignment[],
      ],
      opportunities: records.map(r => ({
        crew_id: r.crew_id, watch_date: r.watch_date,
        schedule_id: owner(r.watch_date) ?? pendingFor.get(r.watch_date) ?? '',
      })),
    })
    const participants = [...new Set([
      ...inputs.lanes.flatMap(l => inputs.crew.filter(c => c.eligible && c.department && l.departments.includes(c.department)).map(c => c.id)),
      ...records.map(r => r.crew_id),
    ])]
    const scores = globalScores(patched.ledger, participants)

    const summary = {
      imported: records.length,
      amended: amendments.length,
      new_days: uncovered.length,
      unmatched, rejected, errors: parseErrors,
      crew: [...new Set(records.map(r => r.crew_id))].length,
      from: records.reduce((a, r) => (r.watch_date < a ? r.watch_date : a), records[0].watch_date),
      to: records.reduce((a, r) => (r.watch_date > a ? r.watch_date : a), records[0].watch_date),
    }
    // A read-only look at what would change. Writes nothing.
    if (body.preview) return json(req, { ...summary, preview: true, fairness: scores })

    const { error: applyError } = await admin.rpc('import_watch_history', {
      p_vessel: vesselId, p_revision: revision,
      p_plan: {
        amendments, new_versions: newVersions.map(({ pending_id: _p, ...v }) => v), scores,
        history_estimated: true,
        detail: { source: body.csv ? 'csv' : body.records ? 'manual' : 'rows', imported: records.length, from: summary.from, to: summary.to },
      },
    })
    if (applyError) throw applyError
    return json(req, { ...summary, applied: true, fairness: scores })
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Could not import those watches'
    return json(req, { error: message }, message === 'Unauthorized' ? 401 : 400)
  }
})
