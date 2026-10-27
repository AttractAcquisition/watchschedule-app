import { strict as assert } from 'node:assert'
import { checkPins, enginePins, pinnedCrewForBlock, pinsNeedingConsent, type PinLane, type WatchPin } from './watch_pins.ts'
import type { OverrideCrew } from './manual_override.ts'
import type { LeaveRange, WeekendStructure } from './schedule_engine.ts'

// November 2026: Fri 13, Sat 14, Sun 15, Mon 16. The weekend before is 7/8.
const member = (id: string, extra: Partial<OverrideCrew> = {}): OverrideCrew =>
  ({ id, full_name: id, department: 'deck', eligible: true, available_from: '2020-01-01', ...extra })
const deck: PinLane = { id: 'lane1', label: 'Deck', departments: ['deck'] }
const pin = (id: string, crew_member_id: string, watch_date: string, extra: Partial<WatchPin> = {}): WatchPin =>
  ({ id, crew_member_id, lane_id: 'lane1', watch_date, acknowledged: [], ...extra })

interface Opts {
  crew?: OverrideCrew[]; lanes?: PinLane[]; structure?: WeekendStructure; leave?: LeaveRange[]
  start?: string; end?: string; scheduled?: (d: string) => boolean; stoodBefore?: string[]
}
const evaluate = (pins: WatchPin[], o: Opts = {}) => {
  const facts = new Set(o.stoodBefore ?? [])
  return checkPins({
    pins, crew: o.crew ?? [member('a'), member('b')], lanes: o.lanes ?? [deck],
    structure: o.structure ?? 'per_day', leave: o.leave ?? [],
    start: o.start ?? '2026-11-01', end: o.end ?? '2026-11-30',
    scheduled: o.scheduled ?? (() => true),
    stoodBefore: (id, d) => facts.has(`${id}:${d}`),
  })
}
const codes = (p: { violations: { code: string }[] }) => p.violations.map(v => v.code).sort()

// The contract this whole module exists for.
Deno.test('a lone weekend pin breaks nothing — the days around it are not facts yet', () => {
  const [p] = evaluate([pin('p1', 'a', '2026-11-14')])
  assert.deepEqual(p.violations, [])
  assert.deepEqual(p.blockers, [])
  assert.equal(p.applies, true)
  assert.deepEqual(p.days, ['2026-11-14'])
  // Nor does a lone Friday, or a lone Monday.
  assert.deepEqual(codes(evaluate([pin('p2', 'a', '2026-11-13')])[0]), [])
  assert.deepEqual(codes(evaluate([pin('p3', 'a', '2026-11-16')])[0]), [])
})

Deno.test('pin against pin: the Monday after a pinned weekend is caught from either end', () => {
  const [sat, mon] = evaluate([pin('p1', 'a', '2026-11-14'), pin('p2', 'a', '2026-11-16')])
  assert.deepEqual(codes(sat), ['monday_after_weekend'])
  assert.deepEqual(codes(mon), ['monday_after_weekend'])
  // Different people, same pair of days: nobody's rest is broken.
  const pair = evaluate([pin('p1', 'a', '2026-11-14'), pin('p2', 'b', '2026-11-16')])
  assert.deepEqual(pair.flatMap(codes), [])
})

Deno.test('history before the window is a fact; a day inside it is not', () => {
  // They stood the weekend before the window opened — a real watch, already stood.
  const [withHistory] = evaluate([pin('p1', 'a', '2026-11-16')], { stoodBefore: ['a:2026-11-14'] })
  assert.deepEqual(codes(withHistory), ['monday_after_weekend'])
  // The same Monday with nothing behind it: the generator simply will not hand
  // them that weekend, so there is nothing to consent to.
  assert.deepEqual(codes(evaluate([pin('p1', 'a', '2026-11-16')])[0]), [])
})

Deno.test('the Friday-to-weekend rule fires between pins both ways, and is exempt under fri_sat_sun_block', () => {
  const [fri, sat] = evaluate([pin('p1', 'a', '2026-11-13'), pin('p2', 'a', '2026-11-14')])
  assert.ok(codes(fri).includes('friday_into_weekend'))
  assert.ok(codes(sat).includes('friday_into_weekend'))
  // A pinned Friday whose weekend was stood before the window.
  const [carried] = evaluate([pin('p1', 'a', '2026-11-13')], { stoodBefore: ['a:2026-11-14'] })
  assert.deepEqual(codes(carried), ['friday_into_weekend'])
  // Under fri_sat_sun_block the Friday leads the block, so there is no run to break.
  const [block] = evaluate([pin('p1', 'a', '2026-11-13')], { structure: 'fri_sat_sun_block' })
  assert.deepEqual(block.days, ['2026-11-13', '2026-11-14', '2026-11-15'])
  assert.deepEqual(codes(block), [])
})

Deno.test('both halves of one weekend pinned to one person', () => {
  const [sat, sun] = evaluate([pin('p1', 'a', '2026-11-14'), pin('p2', 'a', '2026-11-15')])
  assert.ok(codes(sat).includes('both_weekend_days'))
  assert.ok(codes(sun).includes('both_weekend_days'))
  // A sat_sun_block covers both days by construction, so it is one pin, not a clash.
  const [one] = evaluate([pin('p1', 'a', '2026-11-14')], { structure: 'sat_sun_block' })
  assert.deepEqual(one.days, ['2026-11-14', '2026-11-15'])
  assert.deepEqual(codes(one), [])
})

Deno.test('two weekends running is a caution, not a refusal', () => {
  const [, second] = evaluate([pin('p1', 'a', '2026-11-07'), pin('p2', 'a', '2026-11-14')])
  assert.ok(codes(second).includes('consecutive_weekends'))
  assert.equal(second.violations.find(v => v.code === 'consecutive_weekends')?.severity, 'caution')
  assert.deepEqual(second.blockers, [])
})

Deno.test('static facts always apply: leave, joining date, eligibility and the lane pool', () => {
  const leave = [{ crew_id: 'a', start: '2026-11-10', end: '2026-11-16' }]
  assert.ok(codes(evaluate([pin('p1', 'a', '2026-11-14')], { leave })[0]).includes('on_leave'))
  assert.ok(codes(evaluate([pin('p1', 'a', '2026-11-14')], {
    crew: [member('a', { available_from: '2026-12-01' })],
  })[0]).includes('not_joined'))
  assert.ok(codes(evaluate([pin('p1', 'a', '2026-11-14')], {
    crew: [member('a', { eligible: false })],
  })[0]).includes('ineligible'))
  assert.ok(codes(evaluate([pin('p1', 'a', '2026-11-14')], {
    crew: [member('a', { department: 'interior' })],
  })[0]).includes('outside_lane_pool'))
})

Deno.test('consent is per pin, and a newly appearing violation re-opens it', () => {
  const acknowledged = { acknowledged: ['on_leave'] }
  const leave = [{ crew_id: 'a', start: '2026-11-10', end: '2026-11-16' }]
  const [done] = evaluate([pin('p1', 'a', '2026-11-14', acknowledged)], { leave })
  assert.deepEqual(codes(done), ['on_leave'])
  assert.deepEqual(done.unacknowledged, [])
  assert.deepEqual(pinsNeedingConsent([done]), [])
  // Their department changes afterwards: a code they never agreed to appears.
  const [reopened] = evaluate([pin('p1', 'a', '2026-11-14', acknowledged)], {
    leave, crew: [member('a', { department: 'interior' })],
  })
  assert.deepEqual(reopened.unacknowledged, ['outside_lane_pool'])
  assert.equal(pinsNeedingConsent([reopened]).length, 1)
})

Deno.test('a pin that cannot apply is inert, not an error', () => {
  const inert = (p: WatchPin, o: Opts = {}) => evaluate([p], o)[0]
  const after = inert(pin('p1', 'a', '2026-12-25'))
  assert.equal(after.applies, false)
  assert.match(after.inert_reason!, /outside the generation window/)
  assert.equal(inert(pin('p1', 'a', '2026-10-01')).applies, false)
  // Charter-paused, or weekends switched off.
  assert.equal(inert(pin('p1', 'a', '2026-11-14'), { scheduled: d => d !== '2026-11-14' }).applies, false)
  // A retired lane, and a crew member who has left.
  assert.match(inert(pin('p1', 'a', '2026-11-14'), { lanes: [] }).inert_reason!, /lane is no longer active/)
  assert.match(inert(pin('p1', 'z', '2026-11-14'), {}).inert_reason!, /no longer on the crew list/)
  // Inert pins raise nothing and reach the engine as nothing.
  assert.deepEqual(after.violations, [])
  assert.deepEqual(enginePins([after]), [])
})

Deno.test('an inert pin is not a fact for anyone else', () => {
  // The weekend pin falls outside the window, so it cannot justify refusing the Monday.
  const pins = [pin('p1', 'a', '2026-10-24'), pin('p2', 'a', '2026-11-16')]
  const [weekend, monday] = evaluate(pins, { start: '2026-11-01' })
  assert.equal(weekend.applies, false)
  assert.deepEqual(codes(monday), [])
})

Deno.test('the engine is handed exactly the pins that apply, in a fixed order', () => {
  const pins = [
    pin('p2', 'b', '2026-11-16', { lane_id: 'lane2' }),
    pin('p1', 'a', '2026-11-14'),
    pin('p3', 'a', '2026-12-25'),
  ]
  const evaluated = evaluate(pins, { lanes: [deck, { id: 'lane2', label: 'Interior', departments: ['deck'] }] })
  assert.deepEqual(evaluated.map(p => p.id), ['p1', 'p2', 'p3'])
  assert.deepEqual(enginePins(evaluated), [
    { lane_id: 'lane1', crew_id: 'a', watch_date: '2026-11-14' },
    { lane_id: 'lane2', crew_id: 'b', watch_date: '2026-11-16' },
  ])
})

Deno.test('a block is claimed by the earliest pinned day in it', () => {
  const days = ['2026-11-14', '2026-11-15']
  const pins = [
    { lane_id: 'lane1', crew_id: 'b', watch_date: '2026-11-15' },
    { lane_id: 'lane1', crew_id: 'a', watch_date: '2026-11-14' },
  ]
  assert.equal(pinnedCrewForBlock(pins, 'lane1', days), 'a')
  assert.equal(pinnedCrewForBlock(pins, 'lane2', days), null)
  assert.equal(pinnedCrewForBlock(pins, 'lane1', ['2026-11-20']), null)
})
