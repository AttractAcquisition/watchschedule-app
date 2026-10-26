import type { DashboardData } from './useDashboardData'
import { DEPARTMENTS } from '../../lib/classifyDepartment'
import { DEPT_LABEL } from '../Settings/watchSettings'

// Department headings are presentation only; a person has one vessel-wide score.
export function fairnessGroups(data: DashboardData) {
  const included = new Set(data.ledger.map(r => r.crew_id))
  return DEPARTMENTS.map(department => ({
    id: department, label: DEPT_LABEL[department],
    members: data.crew.filter(c => c.department === department && included.has(c.id))
      .sort((a,b) => a.full_name.localeCompare(b.full_name)),
  })).filter(g => g.members.length > 0)
}
