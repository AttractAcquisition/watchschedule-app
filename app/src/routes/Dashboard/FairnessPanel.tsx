// Department-separated presentation of vessel-wide fairness.
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { FairnessExportButtons } from './FairnessExportButtons'
import { GaugeBar } from '../../components/ui/GaugeBar'
import { BAND_BAR, BAND_TEXT, scoreBand } from './fairness'
import type { Crew, DashboardData, LedgerRow } from './useDashboardData'

import { fairnessGroups } from './fairnessGroups'

export function FairnessPanel({ data, vesselName, onPrint, showHeading = true, showExport = true }: { data: DashboardData; vesselName: string; onPrint: () => void; showHeading?: boolean; showExport?: boolean }) {
  const groups = fairnessGroups(data)
  const ledgerByKey = new Map<string, LedgerRow>(data.ledger.map(r => [r.crew_id, r]))
  const averageWatches = data.ledger.length ? data.ledger.reduce((sum, row) => sum + row.total_watches, 0) / data.ledger.length : 0

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      {(showHeading || showExport) && (
        <div className="flex flex-wrap items-start justify-between gap-ws-3">
          {showHeading && <div>
            <p className="ws-eyebrow">— Fairness</p>
            <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Per-crew balance</h2>
          </div>}
          {showExport && <FairnessExportButtons data={data} vesselName={vesselName} onPrint={onPrint} />}
        </div>
      )}

      {data.ledger.length === 0 && (
        <p className="mt-ws-4 text-ws-sm text-ws-text-muted">Regenerate the schedule to calculate vessel-wide fairness.</p>
      )}

      {data.ledger.length > 0 && <p className="mt-ws-2 text-ws-xs text-ws-text-muted">Compared across all watch crew · includes the projected schedule. Department headings do not change the comparison.</p>}
      {data.ledger.some(r => r.history_estimated) && <p className="mt-ws-2 text-ws-xs text-ws-text-faint">Older availability is estimated; new schedules record it exactly.</p>}
      {groups.map((group, index) => {
        const members = group.members
        return (
          <div
            key={group.id}
            className={index === 0 && !showHeading && !showExport ? 'mt-0' : 'mt-ws-5'}
          >
            <p className="mb-ws-3 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold">
              {group.label}
            </p>
            {members.length === 0 ? (
              <p className="text-ws-sm text-ws-text-faint">No eligible crew in this lane.</p>
            ) : (
              <FairnessTable members={members} ledgerByKey={ledgerByKey} averageWatches={averageWatches} />
            )}
          </div>
        )
      })}
    </section>
  )
}

function FairnessTable({ members, ledgerByKey, averageWatches }: { members: Crew[]; ledgerByKey: Map<string, LedgerRow>; averageWatches: number }) {
  const [expandedCrewId, setExpandedCrewId] = useState<string | null>(null)
  return (
    <div className="overflow-x-auto rounded-ws-sm border border-ws-line">
      <table className="w-full min-w-[36rem] border-collapse text-ws-sm">
        <thead className="bg-ws-steel-3 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">
          <tr>
            <th className="px-ws-3 py-ws-2 font-medium">Crew member</th>
            <th className="px-ws-3 py-ws-2 font-medium">Position</th>
            <th className="w-28 px-ws-3 py-ws-2 text-right font-medium">Score</th>
            <th className="w-44 px-ws-3 py-ws-2 font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {members.map((crew) => {
            const row = ledgerByKey.get(crew.id)
            const score = row?.fairness_score != null ? Math.round(row.fairness_score) : null
            const band = score != null ? scoreBand(score) : null
            const expanded = expandedCrewId === crew.id
            return (
              <FragmentRow key={crew.id} crew={crew} row={row} score={score} band={band} averageWatches={averageWatches} expanded={expanded} onToggle={() => setExpandedCrewId(expanded ? null : crew.id)} />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FragmentRow({ crew, row, score, band, averageWatches, expanded, onToggle }: { crew: Crew; row: LedgerRow | undefined; score: number | null; band: ReturnType<typeof scoreBand> | null; averageWatches: number; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-ws-line first:border-t-0">
        <td className="px-ws-3 py-ws-3">
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex items-center gap-ws-2 text-left text-ws-text hover:text-ws-gold">
            <ChevronDown className={`h-4 w-4 shrink-0 text-ws-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={1.5} aria-hidden />
            <span className="font-medium">{crew.full_name}</span>
          </button>
        </td>
        <td className="px-ws-3 py-ws-3 text-ws-text-muted">{crew.position}</td>
        <td className={`px-ws-3 py-ws-3 text-right font-mono font-semibold ${band ? BAND_TEXT[band] : 'text-ws-text-faint'}`}>{score != null ? `${score}%` : '—'}</td>
        <td className="px-ws-3 py-ws-3"><GaugeBar value={score ?? 0} barClass={band ? BAND_BAR[band] : 'bg-ws-steel-3'} /></td>
      </tr>
      {expanded && (
        <tr className="border-t border-ws-line bg-ws-steel-2">
          <td colSpan={4} className="px-ws-5 py-ws-3">
            <dl className="grid grid-cols-2 gap-x-ws-6 gap-y-ws-2 sm:grid-cols-5 text-ws-sm">
              {[
                ['Total watches', row?.total_watches ?? 0],
                ['Vessel average', averageWatches.toFixed(1)],
                ['Difference', row ? `${row.total_watches - averageWatches > 0 ? '+' : ''}${(row.total_watches - averageWatches).toFixed(1)}` : '—'],
                ['Available watch days', (row?.weekday_opportunities ?? 0) + (row?.weekend_opportunities ?? 0)],
                ['Vessel comparison', row?.balance === 'over' ? 'Above fair share' : row?.balance === 'under' ? 'Below fair share' : 'Balanced'],
                ['Weekends', row?.weekend_watches ?? 0],
                ['Fridays', row?.friday_watches ?? 0],
                ['Consecutive run', row?.consecutive_run ?? 0],
                ['Last on watch', row?.last_watch_date ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ws-xs text-ws-text-muted">{label}</dt>
                  <dd className="mt-ws-1 font-mono text-ws-text">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}
