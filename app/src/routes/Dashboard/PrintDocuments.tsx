// B3 — Print/PDF documents (Schedule + Fairness). PURE, props-only presentational
// components rendered into the print layer (PrintLayer, portaled to <body>).
// Authored LIGHT and on-brand from the --ws-print-* tokens: white paper, navy
// ink, gold accent — NOT the dark screen UI. Read-only over the data the
// dashboard already holds (assignments / fairness_ledger); recomputes nothing.
import { format, parseISO } from 'date-fns'
import { dateRangeLabel } from './whatsappExport'
import type { DashboardData, Lane } from './useDashboardData'

const DEPT_LABEL: Record<string, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }
const laneTitle = (l: Lane) => (l.department ? (DEPT_LABEL[l.department] ?? l.label) : l.label)

function PrintHeader({ vesselName, eyebrow, range, tier }: { vesselName: string; eyebrow: string; range?: string; tier?: string }) {
  return (
    <header className="mb-ws-5 flex items-end justify-between border-b border-ws-print-line pb-ws-3">
      <div>
        <p className="font-mono text-ws-xs uppercase tracking-ws-wide text-ws-print-gold">{eyebrow}</p>
        <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-print-ink">{vesselName}</h1>
        {range && <p className="mt-ws-1 font-mono text-ws-sm text-ws-print-muted">{range}</p>}
      </div>
      {tier && (
        <span className="rounded-ws-full border border-ws-print-gold px-ws-3 py-ws-1 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-print-gold">
          {tier} watch
        </span>
      )}
    </header>
  )
}

function PrintFooter() {
  return (
    <p className="mt-ws-5 border-t border-ws-print-line pt-ws-2 font-mono text-ws-xs text-ws-print-muted">
      Generated {format(new Date(), 'd MMM yyyy, HH:mm')} · watchschedule.com
    </p>
  )
}

export function SchedulePrintDoc({ data, vesselName, tier }: { data: DashboardData; vesselName: string; tier?: string }) {
  const { schedule, assignments, lanes, crewById } = data
  const range = schedule ? dateRangeLabel(schedule.start_date, schedule.end_date) : undefined
  const dates = [...new Set(assignments.map((a) => a.watch_date))].sort()
  const scheduled = new Set(assignments.map((a) => a.watch_date))
  const byKey = new Map(assignments.map((a) => [`${a.lane_id}:${a.watch_date}`, a.crew_id]))
  const who = (laneId: string, date: string) => {
    const id = byKey.get(`${laneId}:${date}`)
    if (id) return crewById.get(id)?.full_name ?? '—'
    return scheduled.has(date) ? '⚠ gap' : '—'
  }
  const isFri = (d: string) => parseISO(d).getDay() === 5
  const isWknd = (d: string) => { const g = parseISO(d).getDay(); return g === 0 || g === 6 }

  return (
    <article className="min-h-screen bg-ws-print-bg p-ws-6 font-ui text-ws-print-ink">
      <PrintHeader vesselName={vesselName} eyebrow="Watch schedule" range={range} tier={tier} />
      <table className="w-full border-collapse text-ws-sm">
        <thead>
          <tr>
            <th className="border border-ws-print-line bg-ws-print-weekend px-ws-2 py-ws-1 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-print-muted">Date</th>
            {lanes.map((l) => (
              <th key={l.id} className="border border-ws-print-line bg-ws-print-weekend px-ws-2 py-ws-1 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-print-ink">{laneTitle(l)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => (
            <tr key={d} className={isWknd(d) ? 'bg-ws-print-weekend' : ''}>
              <td className={`border border-ws-print-line px-ws-2 py-ws-1 font-mono text-ws-xs ${isFri(d) ? 'border-l-2 border-l-ws-print-gold font-semibold text-ws-print-ink' : 'text-ws-print-muted'}`}>
                {format(parseISO(d), 'EEE d MMM')}
              </td>
              {lanes.map((l) => (
                <td key={l.id} className="border border-ws-print-line px-ws-2 py-ws-1 text-ws-print-ink">{who(l.id, d)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-ws-3 flex flex-wrap gap-ws-4 font-mono text-ws-xs text-ws-print-muted">
        <span><span className="font-semibold text-ws-print-gold">|</span> Friday (weighted)</span>
        <span><span className="inline-block h-3 w-3 border border-ws-print-line bg-ws-print-weekend align-middle" /> Weekend (separate rotation)</span>
        <span>⚠ gap — no eligible crew</span>
      </div>
      <PrintFooter />
    </article>
  )
}

export function FairnessPrintDoc({ data, vesselName, tier }: { data: DashboardData; vesselName: string; tier?: string }) {
  const { schedule, lanes, crew, ledger } = data
  const range = schedule ? dateRangeLabel(schedule.start_date, schedule.end_date) : undefined
  const ledgerByKey = new Map(ledger.map((r) => [`${r.lane_id}:${r.crew_id}`, r]))
  const isSolo = lanes.length === 1 && lanes[0].kind === 'solo'
  const laneMembers = (lane: Lane) => crew.filter((c) => c.eligible && (lane.kind === 'solo' || c.department === lane.department))
  const cols = ['Crew', 'Position', 'Score', 'Total', 'Wknd', 'Fri', 'Consec', 'Last on watch']

  return (
    <article className="min-h-screen bg-ws-print-bg p-ws-6 font-ui text-ws-print-ink">
      <PrintHeader vesselName={vesselName} eyebrow="Fairness — per-crew balance" range={range} tier={tier} />
      {lanes.map((lane) => {
        const members = laneMembers(lane)
        return (
          <section key={lane.id} className="mb-ws-5">
            {!isSolo && <p className="mb-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-print-gold">{laneTitle(lane)}</p>}
            {members.length === 0 ? (
              <p className="text-ws-sm text-ws-print-muted">No eligible crew in this lane.</p>
            ) : (
              <table className="w-full border-collapse text-ws-sm">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c} className="border border-ws-print-line bg-ws-print-weekend px-ws-2 py-ws-1 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-print-muted">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((c) => {
                    const r = ledgerByKey.get(`${lane.id}:${c.id}`)
                    const score = r?.fairness_score != null ? `${Math.round(r.fairness_score)}%` : '—'
                    return (
                      <tr key={c.id}>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 text-ws-print-ink">{c.full_name}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 text-ws-print-muted">{c.position}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 font-mono font-semibold text-ws-print-gold">{score}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 font-mono text-ws-print-ink">{r?.total_watches ?? 0}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 font-mono text-ws-print-ink">{r?.weekend_watches ?? 0}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 font-mono text-ws-print-ink">{r?.friday_watches ?? 0}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 font-mono text-ws-print-ink">{r?.consecutive_run ?? 0}</td>
                        <td className="border border-ws-print-line px-ws-2 py-ws-1 font-mono text-ws-print-muted">{r?.last_watch_date ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
      <PrintFooter />
    </article>
  )
}
