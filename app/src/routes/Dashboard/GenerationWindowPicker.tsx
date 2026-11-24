// The generation window, chosen where it matters: in the regenerate dialog
// (docs/regenerate-window.md).
//
// Self-contained and presentational — it owns no persistence. The caller saves
// through `set_generation_window` and then generates, so the window the captain
// sees is the window the run uses.
//
// The same caps the engine and the table enforce: 1–13 weeks, or an explicit
// span of at most 91 days. A window that has already begun clamps to today when
// it runs; the engine never rewrites a watch already stood.
import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'

export type WindowMode = 'weeks' | 'month' | 'range'

export interface GenerationWindow {
  mode: WindowMode
  horizon_weeks: number
  start: string
  end: string
}

const MODES: { value: WindowMode; label: string }[] = [
  { value: 'weeks', label: 'Weeks ahead' },
  { value: 'month', label: 'A month' },
  { value: 'range', label: 'Date range' },
]

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayISO = () => iso(new Date())
const field = 'w-full rounded-ws-sm border border-ws-line-strong bg-ws-navy-deep px-ws-3 py-ws-2 text-ws-sm text-ws-text'

export function monthWindow(month: string): { start: string; end: string } {
  const first = parseISO(`${month}-01`)
  return { start: iso(startOfMonth(first)), end: iso(endOfMonth(first)) }
}

/** What the run will actually cover: a begun window starts today. */
export function effectiveWindow(w: GenerationWindow, today = todayISO()) {
  if (w.mode === 'weeks') {
    const weeks = Math.max(1, Math.min(13, Math.trunc(w.horizon_weeks) || 1))
    return { start: today, end: iso(addDays(parseISO(today), weeks * 7 - 1)) }
  }
  const start = w.start < today ? today : w.start
  return { start, end: w.end }
}

/** Null when the window is usable; otherwise why it is not. */
export function windowProblem(w: GenerationWindow, today = todayISO()): string | null {
  if (w.mode === 'weeks') {
    return w.horizon_weeks >= 1 && w.horizon_weeks <= 13 ? null : 'Choose between 1 and 13 weeks.'
  }
  if (!w.start || !w.end) return 'Set a start and end date.'
  if (w.end < w.start) return 'The window ends before it starts.'
  if (w.end < today) return 'That window has already passed. Pick one that ends today or later.'
  if (differenceInCalendarDays(parseISO(w.end), parseISO(w.start)) > 90) {
    return 'A window covers at most 91 days (~3 months).'
  }
  return null
}

export function GenerationWindowPicker({ value, onChange }: {
  value: GenerationWindow
  onChange: (next: GenerationWindow) => void
}) {
  const set = (patch: Partial<GenerationWindow>) => onChange({ ...value, ...patch })
  const problem = windowProblem(value)
  const span = problem ? null : effectiveWindow(value)
  const clamped = !!span && value.mode !== 'weeks' && span.start !== value.start

  return (
    <div className="space-y-ws-3">
      <fieldset className="space-y-ws-2">
        <legend className="block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">How much to generate</legend>
        <div className="grid grid-cols-3 gap-ws-2">
          {MODES.map((m) => (
            <label key={m.value} className={`flex cursor-pointer items-center justify-center gap-ws-2 rounded-ws-sm border px-ws-2 py-ws-2 text-ws-xs text-ws-text ${value.mode === m.value ? 'border-ws-gold bg-ws-gold-ghost' : 'border-ws-line hover:border-ws-line-strong'}`}>
              <input
                type="radio" name="regen-window-mode" value={m.value}
                checked={value.mode === m.value}
                onChange={() => set(m.value === 'month'
                  ? { mode: 'month', ...monthWindow((value.start || todayISO()).slice(0, 7)) }
                  : { mode: m.value })}
                className="h-3.5 w-3.5 accent-ws-gold"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {value.mode === 'weeks' && (
        <div>
          <label htmlFor="regen-weeks" className="block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Weeks from today</label>
          <input
            id="regen-weeks" type="number" min={1} max={13} className={`${field} mt-ws-2`}
            value={value.horizon_weeks}
            onChange={(e) => set({ horizon_weeks: Number(e.target.value) })}
          />
        </div>
      )}

      {value.mode === 'month' && (
        <div>
          <label htmlFor="regen-month" className="block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Month</label>
          <input
            id="regen-month" type="month" className={`${field} mt-ws-2`}
            value={(value.start || todayISO()).slice(0, 7)}
            onChange={(e) => e.target.value && set(monthWindow(e.target.value))}
          />
        </div>
      )}

      {value.mode === 'range' && (
        <div className="grid grid-cols-2 gap-ws-3">
          <div>
            <label htmlFor="regen-from" className="block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">From</label>
            <input id="regen-from" type="date" className={`${field} mt-ws-2`} value={value.start} onChange={(e) => set({ start: e.target.value })} />
          </div>
          <div>
            <label htmlFor="regen-to" className="block text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">To</label>
            <input id="regen-to" type="date" className={`${field} mt-ws-2`} value={value.end} min={value.start || undefined} onChange={(e) => set({ end: e.target.value })} />
          </div>
        </div>
      )}

      {problem
        ? <p role="alert" className="text-ws-xs text-ws-alert">{problem}</p>
        : span && (
            <p className="text-ws-xs text-ws-text-muted">
              Generates <span className="font-semibold text-ws-gold">{format(parseISO(span.start), 'd MMM')} – {format(parseISO(span.end), 'd MMM yyyy')}</span>
              {clamped && <> · starts today, because watches already stood are never rewritten</>}
            </p>
          )}
    </div>
  )
}
