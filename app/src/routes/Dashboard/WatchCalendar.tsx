// WatchCalendar — the generated schedule (frontend.md §4.5, branding.md §5
// calendar cell). Week/Month segmented toggle; one row per active lane (Solo 1 /
// Dual 2 / Triple 3). Cells show crew initials (mono); hover -> full name +
// position. Friday cells: gold left-border. Weekend cells: distinct (navy) bg —
// the separate-rotation cue. Today / active-week emphasised. Gaps (a scheduled
// date with no assignment) render as an explained empty cell. Reads stored
// assignments only — computes no schedule.
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, format, isFriday,
  isToday, isWeekend, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { shortName } from './fairness'
import type { DashboardData } from './useDashboardData'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')

function Cell({ data, laneId, date, scheduled, compact }: { data: DashboardData; laneId: string; date: Date; scheduled: Set<string>; compact?: boolean }) {
  const key = `${laneId}:${fmt(date)}`
  const a = data.assignments.find((x) => `${x.lane_id}:${x.watch_date}` === key)
  const crew = a ? data.crewById.get(a.crew_id) : undefined
  const isGap = !a && scheduled.has(fmt(date)) // scheduled date, no assignment -> no_eligible_crew gap
  const friday = isFriday(date)
  const weekend = isWeekend(date)

  const base = [
    compact ? 'min-h-[1.5rem] px-ws-1 py-ws-1 text-center' : 'min-h-[2.75rem] px-ws-2 py-ws-2',
    'border border-ws-line-faint',
    weekend ? 'bg-ws-navy' : a ? 'bg-ws-steel-2' : 'bg-ws-steel-inset',
    friday ? 'border-l-2 border-l-ws-gold-dim' : '',
    isToday(date) ? 'border-t-2 border-t-ws-gold' : '',
  ].join(' ')

  return (
    <div className={base} title={crew ? `${crew.full_name} · ${crew.position}` : isGap ? 'No eligible crew — gap' : ''}>
      {crew ? (
        // Firstname.X (B2 item 3); long names truncate with ellipsis, full name in the title.
        <span className={`block truncate font-mono font-medium text-ws-text ${compact ? 'text-ws-xs' : 'max-w-[6rem] text-ws-sm'}`}>{shortName(crew.full_name)}</span>
      ) : isGap ? (
        <span className="font-mono text-ws-xs text-ws-alert" aria-label="gap, no eligible crew">⚠</span>
      ) : (
        <span className="text-ws-text-faint">·</span>
      )}
    </div>
  )
}

export function WatchCalendar({ data }: { data: DashboardData }) {
  const [view, setView] = useState<'week' | 'month'>('week')
  const [offset, setOffset] = useState(0)

  const scheduled = useMemo(() => new Set(data.assignments.map((a) => a.watch_date)), [data.assignments])
  const lanes = data.lanes

  // anchor: today if within schedule, else schedule start
  const anchor = useMemo(() => {
    const start = data.schedule ? parseISO(data.schedule.start_date) : new Date()
    const end = data.schedule ? parseISO(data.schedule.end_date) : new Date()
    const now = new Date()
    return now >= start && now <= end ? now : start
  }, [data.schedule])

  if (!data.schedule) {
    return (
      <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        <p className="ws-eyebrow">— Watch schedule</p>
        <p className="mt-ws-3 text-ws-sm text-ws-text-muted">No schedule yet — generate one to see the rota.</p>
      </section>
    )
  }

  const header = (left: string, right: string) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-ws-2">
        <p className="ws-eyebrow">— Watch schedule</p>
        <span className="font-mono text-ws-xs text-ws-text-faint">{left}</span>
      </div>
      <div className="flex items-center gap-ws-3">
        <span className="font-mono text-ws-sm text-ws-text-muted">{right}</span>
        <div className="flex items-center gap-ws-1">
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Previous" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button type="button" onClick={() => setOffset(0)} className="min-h-[40px] rounded-ws-sm px-ws-3 py-ws-1 text-ws-xs text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">Today</button>
          <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Next" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )

  if (view === 'week') {
    const weekStart = startOfWeek(addWeeks(anchor, offset), { weekStartsOn: 1 })
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    return (
      <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
        {header(`${format(weekStart, 'd MMM')} – ${format(addDays(weekStart, 6), 'd MMM yyyy')}`, '')}
        <div className="mt-ws-4 flex justify-end">
          <SegmentedControl ariaLabel="Calendar view" value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        </div>
        <div className="mt-ws-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-ws-2 py-ws-1 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Lane</th>
                {days.map((d) => (
                  <th key={fmt(d)} className={`px-ws-2 py-ws-1 text-center font-mono text-ws-xs ${isToday(d) ? 'text-ws-gold' : 'text-ws-text-muted'}`}>
                    <div>{format(d, 'EEE')}</div>
                    <div className="text-ws-text-faint">{format(d, 'd')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane) => (
                <tr key={lane.id}>
                  <td className="px-ws-2 py-ws-1 text-ws-sm text-ws-text-muted">{lane.label}</td>
                  {days.map((d) => (
                    <td key={fmt(d)} className="p-0"><Cell data={data} laneId={lane.id} date={d} scheduled={scheduled} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Legend />
      </section>
    )
  }

  // month view
  const monthAnchor = addMonths(anchor, offset)
  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 1 })
  const gridEnd = addDays(startOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 1 }), 6)
  const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const weeks: Date[][] = []
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7))
  const todayInGrid = allDays.some((d) => isToday(d))

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      {header(format(monthAnchor, 'MMMM yyyy'), '')}
      <div className="mt-ws-4 flex justify-end">
        <SegmentedControl ariaLabel="Calendar view" value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </div>
      <div className="mt-ws-4 grid grid-cols-7 gap-ws-1 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-ws-1 text-center">{d}</div>)}
      </div>
      <div className="mt-ws-1 space-y-ws-1">
        {weeks.map((week, wi) => {
          const activeWeek = todayInGrid && week.some((d) => isToday(d))
          return (
            <div key={wi} className={`grid grid-cols-7 gap-ws-1 rounded-ws-sm ${activeWeek ? 'shadow-ws-glow-gold' : ''}`}>
              {week.map((d) => {
                const inMonth = d.getMonth() === monthAnchor.getMonth()
                return (
                  <div key={fmt(d)} className={`rounded-ws-sm ${inMonth ? '' : 'opacity-40'}`}>
                    <div className="px-ws-1 pt-ws-1 text-right font-mono text-ws-xs text-ws-text-faint">{format(d, 'd')}</div>
                    <div className="space-y-px p-ws-1">
                      {lanes.map((lane) => <Cell key={lane.id} data={data} laneId={lane.id} date={d} scheduled={scheduled} compact />)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <Legend />
    </section>
  )
}

function Legend() {
  return (
    <div className="mt-ws-4 flex flex-wrap items-center gap-ws-4 text-ws-xs text-ws-text-muted">
      <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm border-l-2 border-l-ws-gold-dim bg-ws-steel-2" /> Friday (weighted)</span>
      <span className="flex items-center gap-ws-2"><span className="inline-block h-3 w-3 rounded-ws-sm bg-ws-navy" /> Weekend (separate rotation)</span>
      <span className="flex items-center gap-ws-2"><span className="font-mono text-ws-alert">⚠</span> Gap — no eligible crew</span>
    </div>
  )
}
