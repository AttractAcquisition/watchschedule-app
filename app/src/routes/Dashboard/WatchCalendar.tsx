// WatchCalendar — the generated schedule (frontend.md §4.5, branding.md §5
// calendar cell). Month calendar; one row per active lane (Solo 1 / Dual 2 /
// Triple 3). Cells show crew initials (mono); hover -> full name +
// position. Friday cells: gold left-border. Weekend cells: distinct (navy) bg —
// the separate-rotation cue. Today / active-week emphasised. Gaps (a scheduled
// date with no assignment) render as an explained empty cell. Reads stored
// assignments only — computes no schedule.
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  addDays, addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth,
  format, isFriday, isToday, isWeekend, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import { shortName } from './fairness'
import type { EditorTarget } from './AssignmentEditor'
import type { DashboardData } from './useDashboardData'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

// B7 — the booked charter (if any) covering this date. "Paused" is distinct from a
// no_eligible_crew gap. Resume = the day after end_date.
function charterFor(data: DashboardData, dateStr: string) {
  return data.charters.find((c) => dateStr >= c.start_date && dateStr <= c.end_date) ?? null
}

function Cell({ data, lane, date, scheduled, byKey, todayISO, compact, dense, onEdit }: { data: DashboardData; lane: DashboardData['lanes'][number]; date: Date; scheduled: Set<string>; byKey: Map<string, DashboardData['assignments'][number]>; todayISO: string; compact?: boolean; dense?: boolean; onEdit?: (target: EditorTarget) => void }) {
  const laneId = lane.id
  const ds = fmt(date)
  const charter = charterFor(data, ds)
  const a = byKey.get(`${laneId}:${ds}`)
  const crew = a ? data.crewById.get(a.crew_id) : undefined
  const isGap = !charter && !a && scheduled.has(ds) // scheduled date, no assignment -> no_eligible_crew gap
  const friday = isFriday(date)
  const weekend = isWeekend(date)
  // Any day a generation covers can be changed by hand (24 Nov 2026) — the
  // server edits whichever version owns it, so correcting who actually stood
  // last week's watch is possible, not just this week's.
  const planned = scheduled.has(ds)
  // A PAST day no generation reaches is still clickable, to record who stood
  // it (docs/history-import.md). Nothing was planned, so there is nothing to
  // amend — it goes through the import path instead of the override's rules.
  // Future days stay untouchable: the generator owns what is still to come.
  const recordable = !planned && ds < todayISO
  const editable = !!onEdit && !charter && (planned || recordable)

  const base = [
    dense ? 'min-h-5 px-1 py-px text-center' : compact ? 'min-h-[1.5rem] px-ws-1 py-ws-1 text-center' : 'min-h-[2.75rem] px-ws-2 py-ws-2',
    'block w-full border border-ws-line-faint',
    charter ? 'bg-ws-steel-inset' : weekend ? 'bg-ws-navy' : a ? 'bg-ws-steel-2' : 'bg-ws-steel-inset',
    friday && !charter ? 'border-l-2 border-l-ws-gold-dim' : '',
    isToday(date) ? 'border-t-2 border-t-ws-gold' : '',
    a?.is_manual ? 'ring-1 ring-inset ring-ws-gold-dim' : '',
    editable ? 'cursor-pointer transition-colors hover:bg-ws-steel-3' : '',
  ].join(' ')

  const resumes = charter ? format(addDays(parseISO(charter.end_date), 1), 'd MMM') : ''
  const manual = a?.is_manual ? ' · changed by hand' : ''
  const historical = !!data.schedule && ds < data.schedule.start_date
  const title = charter ? `${charter.label ? charter.label + ' — ' : ''}Charter · resumes ${resumes}`
    : crew ? `${crew.full_name} · ${crew.position}${manual}${editable ? (historical ? ' — click to correct this past watch' : ' — click to change') : ''}`
    : isGap ? `No eligible crew — gap${editable ? ' — click to fill' : ''}`
    : recordable && !!onEdit ? 'No schedule covers this day — click to record who stood it' : ''
  const content = (
    <>
      {charter ? (
        <span className={`block truncate font-mono italic text-ws-text-muted ${dense ? 'text-[10px] leading-4' : 'text-ws-xs'}`} aria-label={`paused, charter resumes ${resumes}`}>{compact ? '⏸' : 'Paused'}</span>
      ) : crew ? (
        // Firstname.X (B2 item 3); long names truncate with ellipsis, full name in the title.
        <span className={`block truncate font-mono font-medium text-ws-text ${dense ? 'text-[10px] leading-4' : compact ? 'text-ws-xs' : 'max-w-[6rem] text-ws-sm'}`}>{shortName(crew.full_name)}</span>
      ) : isGap ? (
        <span className="font-mono text-ws-xs text-ws-alert" aria-label="gap, no eligible crew">⚠</span>
      ) : (
        <span className="text-ws-text-faint">·</span>
      )}
    </>
  )

  if (!editable) return <div className={base} title={title}>{content}</div>
  return (
    <button
      type="button"
      className={base}
      title={title}
      aria-label={`${lane.label}, ${format(date, 'EEE d MMM')}: ${crew ? crew.full_name : 'unassigned'} — change`}
      onClick={() => onEdit!({ laneId, laneLabel: lane.label, date: ds })}
    >
      {content}
    </button>
  )
}

export function WatchCalendar({
  data, coverageWarningDismissedAt, onDismissCoverageWarning, dismissingCoverageWarning, onEdit,
}: {
  data: DashboardData
  coverageWarningDismissedAt?: string | null
  onDismissCoverageWarning?: () => void
  dismissingCoverageWarning?: boolean
  onEdit?: (target: EditorTarget) => void
}) {
  const [offset, setOffset] = useState(0)

  // Every date any surviving generation rostered, history included — resolved
  // in useDashboardData under the server's per-date winner rule.
  const byKey = useMemo(
    () => new Map(data.assignments.map((a) => [`${a.lane_id}:${a.watch_date}`, a])),
    [data.assignments],
  )
  const scheduled = useMemo(
    () => new Set(data.scheduledDates.length ? data.scheduledDates : data.assignments.map(a => a.watch_date)),
    [data.assignments, data.scheduledDates],
  )
  const lanes = data.lanes
  // C3 — who is on booked leave each day. The legend has always promised a 🌙
  // marker; until 28 Nov 2026 the leave was loaded but never drawn, so a captain
  // could not see on the calendar that a period had registered.
  const awayOn = useMemo(() => {
    const names = (ids: string[]) => ids.map((id) => data.crewById.get(id)?.full_name ?? 'Crew').sort()
    const byDate = new Map<string, string[]>()
    for (const l of data.leave) {
      for (let d = parseISO(l.start_date); fmt(d) <= l.end_date; d = addDays(d, 1)) {
        const key = fmt(d)
        byDate.set(key, [...(byDate.get(key) ?? []), l.crew_member_id])
      }
    }
    return (date: string) => names([...new Set(byDate.get(date) ?? [])])
  }, [data.leave, data.crewById])

  // The Today control must always show the real current week/month. An expired
  // schedule remains visible only on its own dates via Previous/Next; falling
  // back to its start date made Today misleading.
  const anchor = new Date()

  if (!data.schedule) {
    // A cleared calendar is not an empty one: every watch is still stored, and
    // saying "no schedule yet" would read as data loss (docs/calendar-restore.md).
    return (
      <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <p className="ws-eyebrow">— Watch schedule</p>
        {data.calendarCleared ? (
          <>
            <p className="mt-ws-3 text-ws-sm text-ws-text">The calendar is cleared.</p>
            <p className="mt-ws-2 text-ws-sm text-ws-text-muted">
              Nothing was deleted — every generation is still under History, and
              Settings → Account → Calendar puts them all back. Regenerate to start a fresh rota.
            </p>
          </>
        ) : (
          <p className="mt-ws-3 text-ws-sm text-ws-text-muted">No schedule yet — generate one to see the rota.</p>
        )}
      </section>
    )
  }

  const today = fmt(new Date())
  // A schedule that has not STARTED is planned, not broken — it must not read
  // like an expired one (schedule.md §5.1, frontend.md §4.5).
  const notStarted = today < data.schedule.start_date
  const expired = today > data.schedule.end_date
  const range = `${format(parseISO(data.schedule.start_date), 'd MMM yyyy')} – ${format(parseISO(data.schedule.end_date), 'd MMM yyyy')}`
  const daysAway = differenceInCalendarDays(parseISO(data.schedule.start_date), parseISO(today))
  const coverageNotice = !(notStarted || expired)
    || (coverageWarningDismissedAt && data.schedule.generated_at <= coverageWarningDismissedAt)
    ? null
    : notStarted
      ? `Watch schedule starts ${format(parseISO(data.schedule.start_date), 'd MMM yyyy')} — ${daysAway} ${daysAway === 1 ? 'day' : 'days'} away.${data.hasPriorRota ? ' Days before then show your previous rota.' : ''}`
      : `Current schedule covered ${range}. Regenerate to cover today.`

  const header = (periodLabel: string) => (
    <div className="flex flex-wrap items-center justify-between gap-ws-3">
      <p className="ws-eyebrow">— Watch schedule</p>
      <div className="flex items-center gap-ws-2">
        <div className="flex items-center gap-ws-1">
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Previous" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setOffset(0)}
            aria-label="Return to the current month"
            title="Return to the current month"
            className="min-h-[40px] rounded-ws-sm px-ws-3 py-ws-1 font-mono text-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"
          >
            {periodLabel}
          </button>
          <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Next" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )

  const monthAnchor = addMonths(anchor, offset)
  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 1 })
  const gridEnd = addDays(startOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 1 }), 6)
  const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const weeks: Date[][] = []
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7))
  const todayInGrid = allDays.some((d) => isToday(d))
  const denseMonth = lanes.length >= 3

  return (
    <section className={`rounded-ws-md border border-ws-line bg-ws-steel shadow-ws-md ${denseMonth ? 'p-ws-4' : 'p-ws-5'}`}>
      {header(format(monthAnchor, 'MMMM yyyy'))}
      <p className="mt-ws-1 text-ws-xs text-ws-text-faint">{lanes.map(l => l.label + (l.departments?.length ? ': ' + l.departments.join(' / ') : '')).join(' · ')}</p>
      {coverageNotice && <CoverageNotice text={coverageNotice} onDismiss={onDismissCoverageWarning} dismissing={dismissingCoverageWarning} />}
      <div className={`grid grid-cols-7 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted ${denseMonth ? 'mt-ws-3 gap-px' : 'mt-ws-4 gap-ws-1'}`}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-ws-1 text-center">{d}</div>)}
      </div>
      <div className={denseMonth ? 'mt-px space-y-px' : 'mt-ws-1 space-y-ws-1'}>
        {weeks.map((week, wi) => {
          const activeWeek = todayInGrid && week.some((d) => isToday(d))
          return (
            <div key={wi} className={`grid grid-cols-7 rounded-ws-sm ${denseMonth ? 'gap-px' : 'gap-ws-1'} ${activeWeek ? 'shadow-ws-glow-gold' : ''}`}>
              {week.map((d) => {
                const inMonth = d.getMonth() === monthAnchor.getMonth()
                return (
                  <div key={fmt(d)} className={`rounded-ws-sm ${inMonth ? '' : 'opacity-40'}`}>
                    <DayHeader date={d} away={awayOn(fmt(d))} />
                    <div className="space-y-px p-ws-1">
                      {lanes.map((lane) => <Cell key={lane.id} data={data} lane={lane} date={d} scheduled={scheduled} byKey={byKey} todayISO={today} compact dense={denseMonth} onEdit={onEdit} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <Legend compact={denseMonth} editable={!!onEdit} />
    </section>
  )
}

function DayHeader({ date, away }: { date: Date; away: string[] }) {
  return (
    <div className="flex items-center justify-between gap-ws-1 px-ws-1 pt-ws-1 font-mono text-ws-xs text-ws-text-faint">
      {away.length ? (
        <span
          className="flex min-w-0 items-center text-ws-seagreen"
          title={`On leave: ${away.join(', ')}`}
          aria-label={`${format(date, 'd MMMM')}: on leave — ${away.join(', ')}`}
        >
          🌙
        </span>
      ) : <span />}
      <span>{format(date, 'd')}</span>
    </div>
  )
}

function CoverageNotice({ text, onDismiss, dismissing }: { text: string; onDismiss?: () => void; dismissing?: boolean }) {
  return (
    <div className="relative mt-ws-3 flex items-start rounded-ws-sm border border-ws-warn bg-ws-steel-2 px-ws-3 py-ws-2 pr-ws-11">
      <p className="text-ws-sm text-ws-text-muted">{text}</p>
      {onDismiss && <button type="button" onClick={onDismiss} disabled={dismissing} aria-label="Dismiss schedule coverage notice" className="absolute right-ws-2 top-ws-2 flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-text disabled:opacity-50"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>}
    </div>
  )
}

function Legend({ compact = false, editable = false }: { compact?: boolean; editable?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center text-ws-xs text-ws-text-muted ${compact ? 'mt-ws-3 gap-x-ws-3 gap-y-ws-1' : 'mt-ws-4 gap-ws-4'}`}>
      <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm border-l-2 border-l-ws-gold-dim bg-ws-steel-2" /> Friday (weighted)</span>
      <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm bg-ws-navy" /> Weekend (separate rotation)</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono text-ws-alert">⚠</span> Gap — no eligible crew</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono italic text-ws-text-muted">Paused</span> Charter (rotation resumes after)</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono text-ws-seagreen">🌙</span> On leave — hover for who (standing preserved)</span>
      {editable && <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm bg-ws-steel-2 ring-1 ring-inset ring-ws-gold-dim" /> Changed by hand — click any day to reassign, or a past day to record who stood it</span>}
    </div>
  )
}
