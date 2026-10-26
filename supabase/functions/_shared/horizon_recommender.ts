import { planGlobal, type RotaLane } from './rota_v2.ts'
import type { Crew, LeaveRange, CharterRange, ScheduleSettings } from './schedule_engine.ts'
import type { Ledger } from './fairness_engine.ts'

export interface HorizonCandidate {
  weeks: number
  min_score: number
  average_score: number
  score_spread: number
  gaps: number
  // Every forced relaxation, Monday-after-weekend and Friday-into-weekend alike
  // (fairness.md §8): a horizon that forces fewer of them is the fairer rota.
  relaxed_constraints: number
  coverage: number
  cycle_complete: boolean
}

export interface HorizonRecommendation {
  suggested_weeks: number
  candidates: HorizonCandidate[]
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

export function recommendHorizon(input: {
  startDate: string
  settings: ScheduleSettings
  lanes: RotaLane[]
  crew: Crew[]
  base: Ledger
  leave?: LeaveRange[]
  charters?: CharterRange[]
}): HorizonRecommendation {
  const eligible = input.crew.filter(c => c.eligible)
  const poolSizes = input.lanes.map(l => eligible.filter(c => !!c.department && l.departments.includes(c.department)).length)
  const largestPool = Math.max(1, ...poolSizes)
  const candidates: HorizonCandidate[] = []
  for (let weeks = 1; weeks <= 13; weeks++) {
    const plan = planGlobal({ ...input, settings: { ...input.settings, horizon_weeks: weeks } })
    const scores = plan.scores.map(s => s.fairness_score).filter((s): s is number => s != null)
    const minScore = scores.length ? Math.min(...scores) : 0
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const required = plan.events.length
    const coverage = required ? plan.assignments.length / required : 1
    candidates.push({
      weeks, min_score: minScore, average_score: average,
      score_spread: scores.length ? Math.max(...scores) - minScore : 0,
      gaps: plan.gaps.length,
      relaxed_constraints: plan.events.filter(e => e.reason_code.startsWith('constraint_relaxed_')).length,
      coverage, cycle_complete: weeks >= largestPool,
    })
  }

  const best = [...candidates].sort((a, b) => b.coverage - a.coverage || a.gaps - b.gaps || a.relaxed_constraints - b.relaxed_constraints || b.min_score - a.min_score || a.score_spread - b.score_spread || a.weeks - b.weeks)[0]
  // Prefer a complete crew rotation when it is within three score points of the
  // best result. This avoids recommending 10 weeks for a 13-person annual cycle.
  const complete = candidates.filter(c => c.cycle_complete && c.coverage >= best.coverage - 0.01)
  const completeBest = complete.length ? Math.max(...complete.map(c => c.min_score)) : best.min_score
  const eligibleShortlist = complete.filter(c => c.min_score >= completeBest - 3)
  const fallback = candidates.filter(c => c.coverage >= best.coverage - 0.01 && c.min_score >= best.min_score - 3)
  const chosen = (eligibleShortlist.length ? eligibleShortlist : fallback).sort((a, b) => a.weeks - b.weeks)[0] ?? best
  const confidence = chosen.gaps === 0 && chosen.coverage === 1 && chosen.cycle_complete ? 'high' : chosen.coverage === 1 ? 'medium' : 'low'
  const cycleText = chosen.cycle_complete ? `meets the nominal rotation length for the largest eligible pool (${largestPool} crew)` : `the largest eligible pool has ${largestPool} crew, so the 13-week limit cannot meet a full nominal cycle`
  const reason = `${chosen.weeks} weeks gives a projected minimum fairness score of ${Math.round(chosen.min_score)}%, ${chosen.gaps} projected gaps, and ${cycleText}.`
  return { suggested_weeks: chosen.weeks, candidates, reason, confidence }
}
