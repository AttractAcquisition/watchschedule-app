// manual_override.ts — the captain's per-day assignment change
// (docs/manual-override.md, 26 October 2026).
//
// A manual override changes WHO stands one lane's watch on one day (or one
// weekend block). It never re-plans the rest of the schedule: the engine owns
// generation, the captain owns this one cell. Fairness is then recomputed by
// the ordinary replay — the same ledger maths as generation, over the amended
// assignments — so the score always describes the rota the crew actually work.
//
// Nothing here writes: these are pure predicates. The Edge Function evaluates
// them, the captain consents to anything they break, and `apply_manual_override`
// persists the result.
import { addDays, isoWeekday } from './fairness_engine.ts'
import type { LeaveRange, WeekendStructure } from './schedule_engine.ts'

// A rule the engine itself would never break — the captain may still override it,
// but only by acknowledging this exact code. A caution is a fairness/rest concern
// the engine prices rather than forbids; it is surfaced for the same consent.
export type Severity = 'rule' | 'caution'
export interface Violation { code: string; severity: Severity; message: string }
// A blocker cannot be consented away: it would produce a rota the data model
// does not admit (two watches for one person on one day) or one nobody asked for.
export interface Blocker { code: string; message: string }

export const FAR_FUTURE = '9999-12-31'

const human = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const list = (days: string[]) => days.map(human).join(', ')

// The block of days one selection covers, derived EXACTLY as planGlobal derives
// it (rota_v2.ts): walk the scheduled dates from the start of the window, and a
// weekend structure claims the days following its lead. Returns every day the
// change must move together — a sat_sun_block cannot have one half reassigned.
export function blockFor(
  target: string, start: string, end: string, structure: WeekendStructure, scheduled: (d: string) => boolean,
): string[] {
  if (target < start || target > end || !scheduled(target)) return []
  const covered = new Set<string>()
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (!scheduled(date) || covered.has(date)) continue
    const wd = isoWeekday(date)
    const length = structure === 'fri_sat_sun_block' && wd === 5 ? 3 : structure !== 'per_day' && wd === 6 ? 2 : 1
    const days = Array.from({ length }, (_, i) => addDays(date, i)).filter(scheduled)
    for (const d of days) covered.add(d)
    if (days.includes(target)) return days
  }
  return [target]
}

export interface OverrideCrew {
  id: string
  full_name: string
  department: string | null
  eligible: boolean
  available_from: string
}

export interface OverrideCheck {
  crew: OverrideCrew
  days: string[] // the whole block being reassigned
  laneDepartments: string[]
  laneLabel: string
  structure: WeekendStructure
  leave: LeaveRange[]
  scheduled: (d: string) => boolean
  // Did this crew member stand a watch on `date`, EXCLUDING the rows this
  // override replaces? Covers every lane and every schedule version, so the
  // neighbour rules read the rota as the crew actually experience it.
  stood: (crewId: string, date: string) => boolean
}

// The Saturday that opens the weekend `date` belongs to (date is Sat or Sun).
const weekendSaturday = (date: string) => (isoWeekday(date) === 6 ? date : addDays(date, -1))

/**
 * Everything assigning `crew` to `days` would break. `violations` need the
 * captain's explicit consent (every code echoed back in `acknowledge`);
 * `blockers` are refused outright.
 */
export function checkOverride(input: OverrideCheck): { violations: Violation[]; blockers: Blocker[] } {
  const { crew, days, structure, stood } = input
  const violations: Violation[] = []
  const blockers: Blocker[] = []
  const inBlock = new Set(days)
  const add = (code: string, severity: Severity, message: string) => {
    if (!violations.some(v => v.code === code)) violations.push({ code, severity, message })
  }

  // One person, one watch a day — the invariant publish_rota enforces for
  // generated rotas. Never consentable: it is a double-booking, not a rule call.
  const clash = days.filter(d => stood(crew.id, d))
  if (clash.length) {
    blockers.push({ code: 'already_on_watch', message: `${crew.full_name} is already on watch on ${list(clash)}.` })
  }

  for (const d of days) {
    const wd = isoWeekday(d)

    // fairness.md §4 A.1 — no Monday watch straight off a weekend watch. Checked
    // in both directions: a manual edit can land on either end of the pair.
    if (wd === 1 && (stood(crew.id, addDays(d, -1)) || stood(crew.id, addDays(d, -2)))) {
      add('monday_after_weekend', 'rule', `${crew.full_name} stood this weekend — a Monday watch on ${human(d)} breaks the Monday-after-weekend rule.`)
    }
    if (wd >= 6) {
      const monday = addDays(weekendSaturday(d), 2)
      if (!inBlock.has(monday) && stood(crew.id, monday)) {
        add('monday_after_weekend', 'rule', `${crew.full_name} is on watch on ${human(monday)} — a ${human(d)} watch breaks the Monday-after-weekend rule.`)
      }
    }

    // fairness.md §1b (26 Oct 2026) — nobody runs a Friday into that weekend.
    // Exempt under fri_sat_sun_block, where the Friday leads the block itself.
    if (structure !== 'fri_sat_sun_block') {
      if (wd >= 6) {
        const friday = addDays(weekendSaturday(d), -1)
        if (!inBlock.has(friday) && stood(crew.id, friday)) {
          add('friday_into_weekend', 'rule', `${crew.full_name} stands the Friday before — a ${human(d)} watch breaks the Friday-to-weekend rule.`)
        }
      }
      if (wd === 5) {
        const weekend = [addDays(d, 1), addDays(d, 2)].filter(x => !inBlock.has(x) && stood(crew.id, x))
        if (weekend.length) {
          add('friday_into_weekend', 'rule', `${crew.full_name} stands ${list(weekend)} — a Friday watch on ${human(d)} breaks the Friday-to-weekend rule.`)
        }
      }
    }

    // Both halves of one weekend — the double weekend watch.
    if (wd >= 6) {
      const other = wd === 6 ? addDays(d, 1) : addDays(d, -1)
      if (!inBlock.has(other) && input.scheduled(other) && stood(crew.id, other)) {
        add('both_weekend_days', 'rule', `${crew.full_name} would stand both days of this weekend (${list([d, other].sort())}).`)
      }
    }

    // Two weekends running — priced by the engine, not forbidden by it.
    if (wd >= 6) {
      const sat = weekendSaturday(d)
      const near = [-7, -6, 7, 8].map(n => addDays(sat, n)).filter(x => !inBlock.has(x) && stood(crew.id, x))
      if (near.length) {
        add('consecutive_weekends', 'caution', `${crew.full_name} is on watch the ${near[0] < d ? 'previous' : 'following'} weekend (${list(near)}) as well.`)
      }
    }

    if (input.leave.some(l => l.crew_id === crew.id && d >= l.start && d <= l.end)) {
      add('on_leave', 'rule', `${crew.full_name} is on booked leave on ${human(d)}.`)
    }
    if (d < crew.available_from) {
      add('not_joined', 'rule', `${crew.full_name} does not join the vessel until ${human(crew.available_from)}.`)
    }
  }

  // An unbroken run the engine's consecutive-run penalty would have avoided.
  let back = 0
  for (let d = addDays(days[0], -1); input.scheduled(d) && stood(crew.id, d); d = addDays(d, -1)) back++
  let forward = 0
  for (let d = addDays(days[days.length - 1], 1); input.scheduled(d) && stood(crew.id, d); d = addDays(d, 1)) forward++
  const run = back + days.length + forward
  if (run >= 4) {
    add('long_consecutive_run', 'caution', `${crew.full_name} would be on watch ${run} days in a row.`)
  }

  if (!crew.eligible) {
    add('ineligible', 'rule', `${crew.full_name} is marked not eligible for watches.`)
  }
  if (!crew.department || !input.laneDepartments.includes(crew.department)) {
    add('outside_lane_pool', 'rule', `${crew.full_name}${crew.department ? ` (${crew.department})` : ''} is not in ${input.laneLabel}'s departments (${input.laneDepartments.join(', ')}). Their watches stay on the fairness ledger, but the generator will not pick them for this lane.`)
  }

  return { violations, blockers }
}
