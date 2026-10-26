import { dateRangeLabel } from './whatsappExport'
import type { DashboardData } from './useDashboardData'
import { fairnessGroups } from './fairnessGroups'
export function formatFairnessText(data: DashboardData, vesselName: string): string {
  const ledger = new Map(data.ledger.map(r => [r.crew_id, r]))
  const range = data.schedule ? dateRangeLabel(data.schedule.start_date, data.schedule.end_date) : ''
  const lines = [`${vesselName} — Vessel-wide fairness${range ? ' | ' + range : ''}`, 'Includes projected watches. All watch crew compared together.']
  if (data.ledger.some(r => r.history_estimated)) lines.push('Historical availability is estimated.')
  for (const group of fairnessGroups(data)) {
    lines.push('', group.label)
    for (const c of group.members) {
      const r = ledger.get(c.id)!
      const score = r.fairness_score == null ? '—' : Math.round(r.fairness_score) + '%'
      lines.push(`- ${c.full_name}: ${score} (${r.balance ?? 'not rated'} fair share; watches ${r.total_watches}, wknd ${r.weekend_watches}, Fri ${r.friday_watches}; available days ${r.weekday_opportunities + r.weekend_opportunities})`)
    }
  }
  return lines.join('\n')
}
