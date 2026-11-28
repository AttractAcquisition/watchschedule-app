// DateRangePicker — pick a start and an end date on one calendar, in two clicks.
//
// Built for crew leave (tester feedback, 28 Nov 2026: "be able to put in start
// and finish in one go instead of having to click each individually"). The two
// native date inputs it replaces each opened their own picker and lost sight of
// the other end of the range.
//
// Click once for the first day, again for the last; hovering previews the span.
// Clicking a day before the start restarts from there. A single-day range is a
// double click on the same day. Existing ranges (`marked`) are shaded so the
// captain can see a crew member's other leave while choosing.
//
// No dependency: date-fns only, as everywhere else in the app (frontend.md keeps
// third-party UI out). Tokens only (branding.md). Weeks start on Monday,
// matching the watch calendar.
import { useEffect, useId, useRef, useState } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDays, addMonths, differenceInCalendarDays, eachDayOfInterval, endOfMonth, format,
  isSameMonth, parseISO, startOfMonth, startOfWeek,
} from 'date-fns'

export type DateRange = { start: string; end: string }
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function formatRange(start: string, end: string) {
  const s = parseISO(start)
  const e = parseISO(end)
  const days = differenceInCalendarDays(e, s) + 1
  const sameYear = s.getFullYear() === e.getFullYear()
  const left = start === end ? format(s, 'd MMM yyyy') : format(s, sameYear ? 'd MMM' : 'd MMM yyyy')
  const label = start === end ? left : `${left} – ${format(e, 'd MMM yyyy')}`
  return `${label} · ${days} day${days === 1 ? '' : 's'}`
}

export function DateRangePicker({
  value, onChange, marked = [], label = 'Dates', placeholder = 'Select start and end',
}: {
  value: Partial<DateRange>
  onChange: (next: Partial<DateRange>) => void
  /** Ranges to shade for context, e.g. this crew member's existing leave. */
  marked?: DateRange[]
  label?: string
  placeholder?: string
}) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [month, setMonth] = useState(() => startOfMonth(value.start ? parseISO(value.start) : new Date()))

  // Close on outside click or Escape, like every other popover in the app.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  function openPicker() {
    if (value.start) setMonth(startOfMonth(parseISO(value.start)))
    setOpen(true)
  }

  // Picking the start: no start yet, a range already complete, or a day before it.
  const choosingEnd = !!value.start && !value.end
  function pick(day: string) {
    if (!choosingEnd || day < value.start!) {
      onChange({ start: day, end: undefined })
      return
    }
    onChange({ start: value.start, end: day })
    setHover(null)
    setOpen(false)
  }

  const previewEnd = choosingEnd && hover && hover >= value.start! ? hover : value.end
  const inRange = (d: string) => !!value.start && !!previewEnd && d >= value.start && d <= previewEnd
  const markedOn = (d: string) => marked.some((r) => d >= r.start && d <= r.end)

  const gridStart = startOfWeek(month, { weekStartsOn: 1 })
  const gridEnd = addDays(startOfWeek(endOfMonth(month), { weekStartsOn: 1 }), 6)
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const today = iso(new Date())

  const summary = value.start && value.end ? formatRange(value.start, value.end)
    : value.start ? `${format(parseISO(value.start), 'd MMM yyyy')} – pick the last day`
    : placeholder

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="block text-ws-xs text-ws-text-muted">{label}</label>
      <button
        id={id}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`mt-ws-1 flex w-full min-w-0 items-center gap-ws-2 rounded-ws-sm border bg-ws-steel-3 px-ws-2 py-ws-1 text-left text-ws-sm focus:border-ws-gold focus:outline-none ${open ? 'border-ws-gold' : 'border-ws-line'} ${value.start ? 'text-ws-text' : 'text-ws-text-faint'}`}
      >
        <CalendarRange className="h-4 w-4 shrink-0 text-ws-gold" strokeWidth={1.5} aria-hidden />
        <span className="truncate">{summary}</span>
      </button>

      {open && (
        <div role="dialog" aria-label="Choose a date range" className="absolute left-0 z-40 mt-ws-1 w-[18.5rem] max-w-[calc(100vw-2.5rem)] rounded-ws-md border border-ws-line-strong bg-ws-steel-2 p-ws-3 shadow-ws-lg">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
            <p className="font-mono text-ws-sm text-ws-text" aria-live="polite">{format(month, 'MMMM yyyy')}</p>
            <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <div className="mt-ws-2 grid grid-cols-7 text-center font-mono text-[10px] uppercase tracking-ws-wide text-ws-text-faint">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="py-ws-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-y-px" onMouseLeave={() => setHover(null)}>
            {days.map((day) => {
              const d = iso(day)
              const isStart = d === value.start
              const isEnd = d === previewEnd
              const between = inRange(d) && !isStart && !isEnd
              const other = !isSameMonth(day, month)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pick(d)}
                  onMouseEnter={() => setHover(d)}
                  onFocus={() => setHover(d)}
                  aria-label={`${format(day, 'EEEE d MMMM yyyy')}${markedOn(d) ? ', already on leave' : ''}`}
                  aria-pressed={isStart || isEnd || between}
                  className={[
                    'relative h-9 font-mono text-ws-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ws-gold',
                    isStart || isEnd ? 'rounded-ws-sm bg-ws-gold font-semibold text-ws-text-on-gold'
                      : between ? 'bg-ws-gold-glow text-ws-text'
                      : 'rounded-ws-sm text-ws-text hover:bg-ws-steel-3',
                    other && !(isStart || isEnd || between) ? 'opacity-40' : '',
                    d === today && !(isStart || isEnd) ? 'underline decoration-ws-gold underline-offset-4' : '',
                  ].join(' ')}
                >
                  {format(day, 'd')}
                  {markedOn(d) && <span aria-hidden className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isStart || isEnd ? 'bg-ws-text-on-gold' : 'bg-ws-seagreen'}`} />}
                </button>
              )
            })}
          </div>
          <div className="mt-ws-2 flex items-center justify-between gap-ws-2 border-t border-ws-line pt-ws-2 text-ws-xs text-ws-text-muted">
            <span>{choosingEnd ? 'Now pick the last day.' : 'Pick the first day.'}</span>
            {marked.length > 0 && <span className="flex items-center gap-ws-1"><span aria-hidden className="h-1 w-1 rounded-full bg-ws-seagreen" /> existing leave</span>}
          </div>
        </div>
      )}
    </div>
  )
}
