// B3 — Fairness → plain text (WhatsApp/clipboard). PURE, read-only over the
// fairness_ledger + crew the dashboard already holds. Mirrors the on-screen
// FairnessPanel grouping (Solo = one pool; Dual/Triple = per selected department
// lane). Recomputes nothing — scores come straight from the ledger. Reuses the
// A1 clipboard pattern at the call site (writeClipboard + fallback).
import { dateRangeLabel } from './whatsappExport'
import type { DashboardData, Lane } from './useDashboardData'

const DEPT_LABEL: Record<string, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }

export function formatFairnessText(data: DashboardData, vesselName: string): string {
  const { lanes, crew, ledger, schedule } = data
  const ledgerByKey = new Map(ledger.map((r) => [`${r.lane_id}:${r.crew_id}`, r]))
  const isSolo = lanes.length === 1 && lanes[0].kind === 'solo'
  const range = schedule ? dateRangeLabel(schedule.start_date, schedule.end_date) : ''
  const header = `${vesselName} — Fairness summary${range ? ` | ${range}` : ''}`

  const laneMembers = (lane: Lane) =>
    crew.filter((c) => c.eligible && (lane.kind === 'solo' || c.department === lane.department))

  const lines: string[] = []
  for (const lane of lanes) {
    if (!isSolo) lines.push('', lane.department ? (DEPT_LABEL[lane.department] ?? lane.label) : lane.label)
    const members = laneMembers(lane)
    if (members.length === 0) { lines.push('- (no eligible crew)'); continue }
    for (const c of members) {
      const r = ledgerByKey.get(`${lane.id}:${c.id}`)
      const score = r?.fairness_score != null ? `${Math.round(r.fairness_score)}%` : '—'
      lines.push(`- ${c.full_name}: ${score} (watches ${r?.total_watches ?? 0}, wknd ${r?.weekend_watches ?? 0}, Fri ${r?.friday_watches ?? 0})`)
    }
  }
  return [header, ...lines].join('\n')
}
