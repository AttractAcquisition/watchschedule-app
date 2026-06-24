// FairnessPanel — one fairness chip per crew member, grouped by the tier's
// fairness scope (frontend.md §4.5): Solo -> single ungrouped list (one shared
// pool); Dual/Triple -> grouped by the selected department lanes. Fairness is
// per lane, so a member's chip uses the ledger row for (lane, crew). Reads only.
import { FairnessChip } from './FairnessChip'
import type { DashboardData, Lane, LedgerRow } from './useDashboardData'

const DEPT_LABEL: Record<string, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }

export function FairnessPanel({ data }: { data: DashboardData }) {
  const { lanes, crew, ledger } = data
  const ledgerByKey = new Map<string, LedgerRow>(ledger.map((r) => [`${r.lane_id}:${r.crew_id}`, r]))
  const isSolo = lanes.length === 1 && lanes[0].kind === 'solo'

  // crew eligible for a lane (solo = all eligible; dept lane = eligible in dept)
  const laneMembers = (lane: Lane) =>
    crew.filter((c) => c.eligible && (lane.kind === 'solo' || c.department === lane.department))

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      <p className="ws-eyebrow">— Fairness</p>
      <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Per-crew balance</h2>

      {lanes.length === 0 && (
        <p className="mt-ws-4 text-ws-sm text-ws-text-muted">No active watch lanes yet.</p>
      )}

      {lanes.map((lane) => {
        const members = laneMembers(lane)
        return (
          <div key={lane.id} className="mt-ws-5">
            {!isSolo && (
              <p className="mb-ws-3 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold">
                {lane.department ? (DEPT_LABEL[lane.department] ?? lane.label) : lane.label}
              </p>
            )}
            {members.length === 0 ? (
              <p className="text-ws-sm text-ws-text-faint">No eligible crew in this lane.</p>
            ) : (
              <div className="grid gap-ws-3 sm:grid-cols-2">
                {members.map((c) => (
                  <FairnessChip key={c.id} crew={c} row={ledgerByKey.get(`${lane.id}:${c.id}`)} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
