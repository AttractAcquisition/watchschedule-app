import { strict as assert } from 'node:assert'
import { blockFor, checkOverride, type OverrideCrew } from './manual_override.ts'
import { planGlobal, replayGlobal, globalScores, type RotaLane } from './rota_v2.ts'
import type { Crew, LeaveRange, PlannedAssignment, ScheduleSettings, WeekendStructure } from './schedule_engine.ts'

// 2026-10-26 is a Monday; the weekend before is Sat 24 / Sun 25.
const crew = (id: string, extra: Partial<OverrideCrew> = {}): OverrideCrew =>
  ({ id, full_name: id, department: 'deck', eligible: true, available_from: '2020-01-01', ...extra })

const everyDay = () => true
const check = (
  people: OverrideCrew, days: string[],
  opts: { standing?: string[]; structure?: WeekendStructure; leave?: LeaveRange[]; departments?: string[]; scheduled?: (d: string) => boolean } = {},
) => {
  const standing = new Set(opts.standing ?? [])
  return checkOverride({
    crew: people, days, laneDepartments: opts.departments ?? ['deck'], laneLabel: 'Lane 1',
    structure: opts.structure ?? 'per_day', leave: opts.leave ?? [], scheduled: opts.scheduled ?? everyDay,
    stood: (id, d) => standing.has(`${id}:${d}`),
  })
}
const codes = (r: { violations: { code: string }[] }) => r.violations.map(v => v.code).sort()

Deno.test('a block moves together: the weekend structure decides which days one change covers', () => {
  const scheduled = (d: string) => d >= '2026-10-19' && d <= '2026-11-01'
  const span = (target: string, structure: WeekendStructure) => blockFor(target, '2026-10-19', '2026-11-01', structure, scheduled)
  assert.deepEqual(span('2026-10-24', 'per_day'), ['2026-10-24'])
  assert.deepEqual(span('2026-10-24', 'sat_sun_block'), ['2026-10-24', '2026-10-25'])
  assert.deepEqual(span('2026-10-25', 'sat_sun_block'), ['2026-10-24', '2026-10-25'])
  assert.deepEqual(span('2026-10-25', 'fri_sat_sun_block'), ['2026-10-23', '2026-10-24', '2026-10-25'])
  assert.deepEqual(span('2026-10-22', 'fri_sat_sun_block'), ['2026-10-22'])
  // Outside the window, or a day the schedule never covered, is not editable.
  assert.deepEqual(span('2026-11-02', 'per_day'), [])
  assert.deepEqual(blockFor('2026-10-24', '2026-10-19', '2026-11-01', 'per_day', d => d !== '2026-10-24'), [])
})

Deno.test('a clean swap breaks nothing', () => {
  const r = check(crew('a'), ['2026-10-28'], { standing: ['b:2026-10-28'] })
  assert.deepEqual(r.violations, [])
  assert.deepEqual(r.blockers, [])
})

Deno.test('one person, one watch a day — a double booking is refused, not consented', () => {
  const r = check(crew('a'), ['2026-10-28'], { standing: ['a:2026-10-28'] })
  assert.deepEqual(r.blockers.map(b => b.code), ['already_on_watch'])
})

Deno.test('the Monday-after-weekend rule is caught from either end', () => {
  assert.deepEqual(codes(check(crew('a'), ['2026-10-26'], { standing: ['a:2026-10-25'] })), ['monday_after_weekend'])
  assert.deepEqual(codes(check(crew('a'), ['2026-10-26'], { standing: ['a:2026-10-24'] })), ['monday_after_weekend'])
  // Assigning the weekend when the same person already holds that Monday.
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24'], { standing: ['a:2026-10-26'] })), ['monday_after_weekend'])
  // A Monday two weeks on from the last weekend is fine.
  assert.deepEqual(codes(check(crew('a'), ['2026-10-26'], { standing: ['a:2026-10-19'] })), [])
})

Deno.test('the Friday-to-weekend rule is caught from either end, and is exempt under fri_sat_sun_block', () => {
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24'], { standing: ['a:2026-10-23'] })), ['friday_into_weekend'])
  assert.deepEqual(codes(check(crew('a'), ['2026-10-25'], { standing: ['a:2026-10-23'] })), ['friday_into_weekend'])
  assert.deepEqual(codes(check(crew('a'), ['2026-10-23'], { standing: ['a:2026-10-25'] })), ['friday_into_weekend'])
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24'], { standing: ['a:2026-10-23'], structure: 'fri_sat_sun_block' })), [])
  // The block's own Friday is its lead day, so it is never a violation of itself.
  assert.deepEqual(codes(check(crew('a'), ['2026-10-23', '2026-10-24', '2026-10-25'], { structure: 'fri_sat_sun_block' })), [])
})

Deno.test('both days of one weekend, and two weekends running', () => {
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24'], { standing: ['a:2026-10-25'] })), ['both_weekend_days'])
  // A sat_sun_block covers both days itself — that is the structure, not a breach.
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24', '2026-10-25'], { structure: 'sat_sun_block' })), [])
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24'], { standing: ['a:2026-10-17'] })), ['consecutive_weekends'])
  assert.deepEqual(codes(check(crew('a'), ['2026-10-24'], { standing: ['a:2026-10-31'] })), ['consecutive_weekends'])
})

Deno.test('availability, eligibility and lane membership each need their own consent', () => {
  assert.deepEqual(codes(check(crew('a'), ['2026-10-28'], { leave: [{ crew_id: 'a', start: '2026-10-27', end: '2026-10-29' }] })), ['on_leave'])
  assert.deepEqual(codes(check(crew('a', { available_from: '2026-11-01' }), ['2026-10-28'])), ['not_joined'])
  assert.deepEqual(codes(check(crew('a', { eligible: false }), ['2026-10-28'])), ['ineligible'])
  assert.deepEqual(codes(check(crew('a', { department: 'interior' }), ['2026-10-28'])), ['outside_lane_pool'])
  assert.deepEqual(codes(check(crew('a', { department: null }), ['2026-10-28'])), ['outside_lane_pool'])
  // Every broken rule is listed, so every one of them is consented to separately.
  const many = check(crew('a', { eligible: false, department: 'interior' }), ['2026-10-26'], { standing: ['a:2026-10-25'] })
  assert.deepEqual(codes(many), ['ineligible', 'monday_after_weekend', 'outside_lane_pool'])
})

Deno.test('a long unbroken run is flagged as a caution', () => {
  assert.deepEqual(codes(check(crew('a'), ['2026-10-28'], { standing: ['a:2026-10-26', 'a:2026-10-27'] })), [])
  const r = check(crew('a'), ['2026-10-28'], { standing: ['a:2026-10-25', 'a:2026-10-26', 'a:2026-10-27'] })
  assert.ok(codes(r).includes('long_consecutive_run'))
  assert.ok(r.violations.find(v => v.code === 'long_consecutive_run')!.message.includes('4 days'))
  // An unscheduled day breaks the run, so a gap in the rota is not a run.
  assert.ok(!codes(check(crew('a'), ['2026-10-28'], {
    standing: ['a:2026-10-25', 'a:2026-10-26', 'a:2026-10-27'], scheduled: d => d !== '2026-10-26',
  })).includes('long_consecutive_run'))
})

// --- the recompute path: an override is scored by the generation maths -------
const person = (id: string, department = 'deck'): Crew => ({ id, department, eligible: true, available_from: '2020-01-01' })
const lane = (id: string, departments = ['deck'], position = 1): RotaLane => ({ id, label: id, departments, position })
const settings: ScheduleSettings = { horizon_weeks: 6, include_weekends: true, weekday_rotation_anchor: 0, weekend_rotation_anchor: 0, weekend_structure: 'per_day' }
const plan = planGlobal({ startDate: '2026-09-21', settings, lanes: [lane('1'), lane('2', ['deck'], 2)], crew: ['a', 'b', 'c', 'd', 'e'].map(id => person(id)), base: {} })

Deno.test('replaying a published rota reproduces the generator ledger exactly', () => {
  // This is what the override does after amending one day: it never runs a
  // second fairness formula, it replays the stored rota. With nothing amended
  // the replay must land byte-identically on the generator's own ledger.
  const replayed = replayGlobal({}, plan.assignments, plan.opportunities)
  assert.deepEqual(replayed, plan.ledger)
  assert.deepEqual(globalScores(replayed, plan.scores.map(s => s.crew_id)), plan.scores)
})

Deno.test('an override moves exactly one watch, and the scores follow it', () => {
  const day = plan.assignments[20]
  const replacement = ['a', 'b', 'c', 'd', 'e'].find(id =>
    !plan.assignments.some(a => a.watch_date === day.watch_date && a.crew_id === id))!
  const amended: PlannedAssignment[] = [
    ...plan.assignments.filter(a => !(a.lane_id === day.lane_id && a.watch_date === day.watch_date)),
    { ...day, crew_id: replacement },
  ]
  // The crew member taking the watch gains the opportunity for that day too.
  const after = replayGlobal({}, amended, [...plan.opportunities, { crew_id: replacement, watch_date: day.watch_date }])
  assert.equal(after[day.crew_id].total_watches, plan.ledger[day.crew_id].total_watches - 1)
  assert.equal(after[replacement].total_watches, plan.ledger[replacement].total_watches + 1)
  // Denominators are untouched for everyone: the day was always an opportunity.
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    assert.equal(after[id].weekday_opportunities, plan.ledger[id].weekday_opportunities)
    assert.equal(after[id].weekend_opportunities, plan.ledger[id].weekend_opportunities)
  }
  const ids = plan.scores.map(s => s.crew_id)
  const before = globalScores(plan.ledger, ids)
  const now = globalScores(after, ids)
  assert.notDeepEqual(now, before)
  // And the swap is reversible: putting it back restores the published scores.
  assert.deepEqual(globalScores(replayGlobal({}, plan.assignments, plan.opportunities), ids), before)
})
