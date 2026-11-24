// Parsing and matching for "Upload past watches" (docs/history-import.md).
//
// Pure: no I/O, no writes, no Supabase. The browser sends raw CSV text or typed
// rows and the server decides what they mean, so the client never holds a copy
// of the matching rules — the same reasoning as the override's rule predicates.
//
// The crew matcher is shared with seed-fairness's image extraction, so a name
// read off a photo and a name typed into a CSV resolve identically.

export interface RawHistoryRow {
  date: string
  crew: string
  lane?: string
}

export interface HistoryParse {
  rows: RawHistoryRow[]
  /** Human-readable, line-numbered problems. Parsing continues past each one. */
  errors: string[]
}

const DATE_KEYS = ['date', 'watch_date', 'watch date', 'day']
const CREW_KEYS = ['crew', 'crew_name', 'crew name', 'name', 'watchkeeper']
const LANE_KEYS = ['lane', 'lane_label', 'lane name', 'watch']

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** One CSV line into fields, honouring quotes, embedded commas and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out.map(f => f.trim())
}

/**
 * Normalise a written date to ISO. Accepts YYYY-MM-DD, DD/MM/YYYY and
 * DD-MM-YYYY. Day-first is deliberate: this is a European maritime product and
 * 05/11/2026 means 5 November aboard. Ambiguous US-style input is the reason
 * the CSV template ships with ISO dates.
 */
export function toIsoDate(value: string): string | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return isRealDate(v) ? v : null
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!m) return null
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return isRealDate(iso) ? iso : null
}

function isRealDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Parse an uploaded CSV. A header row is required so the columns are
 * unambiguous; the template the UI offers matches it.
 */
export function parseHistoryCsv(text: string): HistoryParse {
  const rows: RawHistoryRow[] = []
  const errors: string[] = []
  // Strip a BOM, tolerate CRLF, ignore blank lines.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length)
  if (!lines.length) return { rows, errors: ['That file is empty.'] }

  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase())
  const dateAt = header.findIndex(h => DATE_KEYS.includes(h))
  const crewAt = header.findIndex(h => CREW_KEYS.includes(h))
  const laneAt = header.findIndex(h => LANE_KEYS.includes(h))
  if (dateAt < 0 || crewAt < 0) {
    return { rows, errors: ['The first row must name the columns, including a "date" column and a "crew" column.'] }
  }

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    const rawDate = fields[dateAt] ?? ''
    const crew = (fields[crewAt] ?? '').trim()
    if (!rawDate && !crew) continue
    const date = toIsoDate(rawDate)
    if (!date) { errors.push(`Line ${i + 1}: "${rawDate}" is not a date we recognise (use YYYY-MM-DD).`); continue }
    if (!crew) { errors.push(`Line ${i + 1}: no crew member named.`); continue }
    const lane = laneAt >= 0 ? (fields[laneAt] ?? '').trim() : ''
    rows.push({ date, crew, ...(lane ? { lane } : {}) })
  }
  return { rows, errors }
}

export interface MatchableCrew { id: string; full_name: string }

/**
 * Resolve a written name to exactly one crew member. Ambiguity is a miss, never
 * a guess: putting the wrong person on a watch corrupts fairness silently.
 */
export function matchCrewName(name: string, crew: MatchableCrew[]): string | null {
  const r = norm(name)
  if (!r) return null
  const exact = crew.filter(c => norm(c.full_name) === r)
  if (exact.length) return exact.length === 1 ? exact[0].id : null
  const partial = crew.filter(c => {
    const tokens = norm(c.full_name).split(' ')
    return tokens.includes(r) || tokens.map(t => t[0]).join('') === r
  })
  return partial.length === 1 ? partial[0].id : null
}

export interface ResolvedHistory {
  /** One watch per crew member per day; later rows win a collision. */
  records: { crew_id: string; watch_date: string; lane?: string }[]
  unmatched: string[]
  rejected: string[]
}

/**
 * Turn parsed rows into watch records. Future dates are rejected: this imports
 * what was stood, and the generator owns what is still to come.
 */
export function resolveHistory(rows: RawHistoryRow[], crew: MatchableCrew[], today: string): ResolvedHistory {
  const byKey = new Map<string, { crew_id: string; watch_date: string; lane?: string }>()
  const unmatched = new Set<string>()
  const rejected: string[] = []
  for (const row of rows) {
    if (row.date >= today) { rejected.push(`${row.crew} on ${row.date}: not a past date`); continue }
    const id = matchCrewName(row.crew, crew)
    if (!id) { unmatched.add(row.crew); continue }
    byKey.set(`${id}:${row.date}`, { crew_id: id, watch_date: row.date, ...(row.lane ? { lane: row.lane } : {}) })
  }
  const records = [...byKey.values()].sort((a, b) =>
    a.watch_date < b.watch_date ? -1 : a.watch_date > b.watch_date ? 1 : a.crew_id < b.crew_id ? -1 : a.crew_id > b.crew_id ? 1 : 0)
  return { records, unmatched: [...unmatched], rejected }
}

/**
 * Maximal contiguous runs of dates, so an import that lands where no generation
 * reaches can be stored as tight schedule ranges instead of one span that would
 * blanket every date between the first and last record.
 */
export function contiguousRuns(dates: string[]): { start: string; end: string; dates: string[] }[] {
  const sorted = [...new Set(dates)].sort()
  const runs: { start: string; end: string; dates: string[] }[] = []
  for (const date of sorted) {
    const last = runs[runs.length - 1]
    if (last && nextDay(last.end) === date) { last.end = date; last.dates.push(date) }
    else runs.push({ start: date, end: date, dates: [date] })
  }
  return runs
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
