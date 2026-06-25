// A1 — WhatsApp Export (additions.md Phase A1). A PURE, read-only client formatter
// over the CURRENT schedule's assignments + crew the dashboard already holds via
// RLS-scoped reads. It recomputes nothing and never touches fairness data — it
// only re-presents existing assignments as day-keyed plain text for a WhatsApp paste.
import { format, parseISO } from 'date-fns'
import type { DashboardData } from './useDashboardData'

const firstName = (full: string) => full.trim().split(/\s+/)[0] || full

// "6–12 Oct" (same month) · "28 Sep – 4 Oct" (same year) · "28 Dec 2026 – 4 Jan 2027".
export function dateRangeLabel(start: string, end: string): string {
  const s = parseISO(start)
  const e = parseISO(end)
  if (start === end) return format(s, 'd MMM')
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()
  if (sameMonth) return `${format(s, 'd')}–${format(e, 'd MMM')}`
  if (sameYear) return `${format(s, 'd MMM')} – ${format(e, 'd MMM')}`
  return `${format(s, 'd MMM yyyy')} – ${format(e, 'd MMM yyyy')}`
}

// Day-keyed plain text (the format Alex set):
//   <vessel> — Watch Schedule | 6–12 Oct
//   Mon 6 — Tom                         (solo)
//   Mon 6 — Deck: Tom | Interior: Luke  (dual/triple)
// Plain text only — no markdown, no emoji. Returns '' if there is no schedule.
export function formatWhatsApp(data: DashboardData, vesselName: string): string {
  const { schedule, assignments, lanes, crewById } = data
  if (!schedule) return ''

  const header = `${vesselName} — Watch Schedule | ${dateRangeLabel(schedule.start_date, schedule.end_date)}`
  const isSolo = lanes.length === 1 && lanes[0].kind === 'solo'

  // who stood (lane,date) — straight from the stored assignments
  const byKey = new Map(assignments.map((a) => [`${a.watch_date}:${a.lane_id}`, a.crew_id]))
  const who = (date: string, laneId: string, blank: string) => {
    const id = byKey.get(`${date}:${laneId}`)
    if (!id) return blank
    return firstName(crewById.get(id)?.full_name ?? '?')
  }

  const dates = [...new Set(assignments.map((a) => a.watch_date))].sort()
  const lines = dates.map((d) => {
    const dayLabel = format(parseISO(d), 'EEE d')
    if (isSolo) return `${dayLabel} — ${who(d, lanes[0].id, '(unfilled)')}`
    const parts = lanes.map((l) => `${l.label}: ${who(d, l.id, '—')}`)
    return `${dayLabel} — ${parts.join(' | ')}`
  })

  return [header, '', ...lines].join('\n')
}

// Write to the clipboard; returns true on success, false when the clipboard API
// is unavailable or blocked (the caller then shows the manual-copy fallback).
export async function writeClipboard(
  text: string,
  clipboard: Clipboard | undefined = typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
): Promise<boolean> {
  try {
    if (!clipboard?.writeText) return false
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
