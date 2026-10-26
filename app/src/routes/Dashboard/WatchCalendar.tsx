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
  addDays, addMonths, eachDayOfInterval, endOfMonth, format, isFriday,
  isToday, isWeekend, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import { shortName } from './fairness'
import type { DashboardData } from './useDashboardData'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

// B7 — the booked charter (if any) covering this date. "Paused" is distinct from a
// no_eligible_crew gap. Resume = the day after end_date.
function charterFor(data: DashboardData, dateStr: string) {
  return data.charters.find((c) => dateStr >= c.start_date && dateStr <= c.end_date) ?? null
}

function Cell({ data, laneId, date, scheduled, compact, dense }: { data: DashboardData; laneId: string; date: Date; scheduled: Set<string>; compact?: boolean; dense?: boolean }) {
  const ds = fmt(date)
  const charter = charterFor(data, ds)
  const key = `${laneId}:${ds}`
  const a = data.assignments.find((x) => `${x.lane_id}:${x.watch_date}` === key)
  const crew = a ? data.crewById.get(a.crew_id) : undefined
  const isGap = !charter && !a && scheduled.has(ds) // scheduled date, no assignment -> no_eligible_crew gap
  const friday = isFriday(date)
  const weekend = isWeekend(date)

  const base = [
    dense ? 'min-h-5 px-1 py-px text-center' : compact ? 'min-h-[1.5rem] px-ws-1 py-ws-1 text-center' : 'min-h-[2.75rem] px-ws-2 py-ws-2',
    'border border-ws-line-faint',
    charter ? 'bg-ws-steel-inset' : weekend ? 'bg-ws-navy' : a ? 'bg-ws-steel-2' : 'bg-ws-steel-inset',
    friday && !charter ? 'border-l-2 border-l-ws-gold-dim' : '',
    isToday(date) ? 'border-t-2 border-t-ws-gold' : '',
  ].join(' ')

  const resumes = charter ? format(addDays(parseISO(charter.end_date), 1), 'd MMM') : ''
  return (
    <div className={base} title={charter ? `${charter.label ? charter.label + ' — ' : ''}Charter · resumes ${resumes}` : crew ? `${crew.full_name} · ${crew.position}` : isGap ? 'No eligible crew — gap' : ''}>
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
    </div>
  )
}

export function WatchCalendar({
  data, coverageWarningDismissedAt, onDismissCoverageWarning, dismissingCoverageWarning,
}: {
  data: DashboardData
  coverageWarningDismissedAt?: string | null
  onDismissCoverageWarning?: () => void
  dismissingCoverageWarning?: boolean
}) {
  const [offset, setOffset] = useState(0)

  const scheduled = useMemo(() => {
    const snapshot = data.schedule?.rota_snapshot as { scheduled_dates?: string[] } | null
    return new Set(snapshot?.scheduled_dates ?? data.assignments.map(a => a.watch_date))
  }, [data.assignments, data.schedule])
  const lanes = data.lanes

  // The Today control must always show the real current week/month. An expired
  // schedule remains visible only on its own dates via Previous/Next; falling
  // back to its start date made Today misleading.
  const anchor = new Date()

  if (!data.schedule) {
    return (
      <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <p className="ws-eyebrow">— Watch schedule</p>
        <p className="mt-ws-3 text-ws-sm text-ws-text-muted">No schedule yet — generate one to see the rota.</p>
      </section>
    )
  }

  const today = fmt(new Date())
  const scheduleIsOutsideToday = today < data.schedule.start_date || today > data.schedule.end_date
  const coverageNotice = scheduleIsOutsideToday
    && (!coverageWarningDismissedAt || data.schedule.generated_at > coverageWarningDismissedAt)
    ? `Current schedule covers ${format(parseISO(data.schedule.start_date), 'd MMM yyyy')} – ${format(parseISO(data.schedule.end_date), 'd MMM yyyy')}. Regenerate to cover today.`
    : null

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
                    <div className="px-ws-1 pt-ws-1 text-right font-mono text-ws-xs text-ws-text-faint">{format(d, 'd')}</div>
                    <div className="space-y-px p-ws-1">
                      {lanes.map((lane) => <Cell key={lane.id} data={data} laneId={lane.id} date={d} scheduled={scheduled} compact dense={denseMonth} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <Legend compact={denseMonth} />
    </section>
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

function Legend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center text-ws-xs text-ws-text-muted ${compact ? 'mt-ws-3 gap-x-ws-3 gap-y-ws-1' : 'mt-ws-4 gap-ws-4'}`}>
      <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm border-l-2 border-l-ws-gold-dim bg-ws-steel-2" /> Friday (weighted)</span>
      <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm bg-ws-navy" /> Weekend (separate rotation)</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono text-ws-alert">⚠</span> Gap — no eligible crew</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono italic text-ws-text-muted">Paused</span> Charter (rotation resumes after)</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono text-ws-seagreen">🌙</span> On leave (per-crew; standing preserved)</span>
    </div>
  )
}
