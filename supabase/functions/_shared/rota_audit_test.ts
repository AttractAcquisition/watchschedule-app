import { strict as assert } from 'node:assert'
import { planGlobal, type RotaLane } from './rota_v2.ts'
import { auditRota, findPatterns, dayWeight } from './rota_audit.ts'
import { isoWeekday, zeroEntry, type Ledger } from './fairness_engine.ts'
import type { Crew, ScheduleSettings, PlannedAssignment } from './schedule_engine.ts'

const crew = (id: string, extra = {}): Crew => ({ id, department: 'deck', eligible: true, available_from: '2020-01-01', ...extra })
const lane = (id: string, departments = ['deck'], position = 1): RotaLane => ({ id, label: id, departments, position })
const settings: ScheduleSettings = { horizon_weeks: 5, include_weekends: true, weekday_rotation_anchor: 0, weekend_rotation_anchor: 0, weekend_structure: 'sat_sun_block' }

const names = ['greta', 'elisa', 'silvio', 'sienna', 'jessica', 'alexander']
const december = (overrides = {}) => planGlobal({
  crew: names.map(id => crew(id)), lanes: [lane('bridge')],
  startDate: '2026-12-01', endDate: '2026-12-31', settings, base: {}, ...overrides,
})
const audit = (p: ReturnType<typeof planGlobal>, extra = {}) => auditRota({
  assignments: p.assignments, ledger: p.ledger, crew: names.map(id => crew(id)),
  lanes: [lane('bridge')], settings, ...extra,
})

Deno.test('audit: a freshly generated rota has no improving swap', () => {
  // The defensibility claim in one assertion — if this ever fails, the engine
  // left value on the table and the audit will say exactly where.
  const r = audit(december())
  assert.ok(r.considered > 100, 'pairs were actually examined: ' + r.considered)
  assert.deepEqual(r.improvable, [], 'engine output should be locally optimal')
})

Deno.test('audit: the swap that looks better but is not', () => {
  // Asked of the live December rota: why not give Sienna the Friday and Greta
  // the Wednesday? It spreads Fridays over four people instead of three — and
  // it makes the burden LESS even, because Sienna already stands that week's
  // weekend and a Friday weighs more than a Wednesday. The audit must not
  // offer it.
  const p = december()
  const fri = p.assignments.find(a => a.watch_date === '2026-12-25')!
  const wed = p.assignments.find(a => a.watch_date === '2026-12-23')!
  const r = audit(p)
  const proposed = r.improvable.find(s =>
    (s.from.watch_date === fri.watch_date && s.to.watch_date === wed.watch_date) ||
    (s.from.watch_date === wed.watch_date && s.to.watch_date === fri.watch_date))
  assert.equal(proposed, undefined, 'swapping a Friday onto someone already carrying that weekend is not an improvement')
})

Deno.test('audit: a deliberately lopsided rota IS reported, best swap first', () => {
  // Hand-built: `heavy` takes every Friday, `light` takes Wednesdays. Trading a
  // Friday for a Wednesday must show up as the fairest single move available.
  const assignments: PlannedAssignment[] = []
  const ledger: Ledger = {}
  const add = (id: string, date: string) => {
    assignments.push({ lane_id: 'bridge', crew_id: id, watch_date: date, day_type: 'weekday', is_friday: isoWeekday(date) === 5 })
    const e = ledger[id] ??= zeroEntry(id)
    e.weekday_watches++; e.friday_watches += isoWeekday(date) === 5 ? 1 : 0
  }
  for (const d of ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']) add('heavy', d)
  for (const d of ['2026-12-02', '2026-12-09', '2026-12-16', '2026-12-23']) add('light', d)
  for (const id of ['heavy', 'light']) { ledger[id].weekday_opportunities = 23; ledger[id].weekend_opportunities = 0 }

  const r = auditRota({ assignments, ledger, crew: [crew('heavy'), crew('light')], lanes: [lane('bridge')], settings })
  assert.ok(r.improvable.length > 0, 'a 4-Friday/0-Friday split must be improvable')
  const best = r.improvable[0]
  assert.ok(best.gain > 0)
  const dates = [best.from.watch_date, best.to.watch_date].map(d => isoWeekday(d)).sort()
  assert.deepEqual(dates, [3, 5], 'the best move trades a Wednesday for a Friday')
  // Ordering is by gain and then by date/crew — never by iteration accident.
  assert.deepEqual(r.improvable, auditRota({ assignments, ledger, crew: [crew('heavy'), crew('light')], lanes: [lane('bridge')], settings }).improvable)
})

Deno.test('audit: an improving swap that breaks a rule is never offered', () => {
  // Same lopsided shape, but `light` is on leave for every Friday. The numbers
  // still say "give light a Friday"; the rules say no, and the rules win.
  const assignments: PlannedAssignment[] = []
  const ledger: Ledger = {}
  const add = (id: string, date: string) => {
    assignments.push({ lane_id: 'bridge', crew_id: id, watch_date: date, day_type: 'weekday', is_friday: isoWeekday(date) === 5 })
    const e = ledger[id] ??= zeroEntry(id)
    e.weekday_watches++; e.friday_watches += isoWeekday(date) === 5 ? 1 : 0
  }
  for (const d of ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']) add('heavy', d)
  for (const d of ['2026-12-02', '2026-12-09', '2026-12-16', '2026-12-23']) add('light', d)
  for (const id of ['heavy', 'light']) { ledger[id].weekday_opportunities = 23; ledger[id].weekend_opportunities = 0 }

  const leave = [{ crew_id: 'light', start: '2026-12-04', end: '2026-12-04' },
                 { crew_id: 'light', start: '2026-12-11', end: '2026-12-11' },
                 { crew_id: 'light', start: '2026-12-18', end: '2026-12-18' },
                 { crew_id: 'light', start: '2026-12-25', end: '2026-12-25' }]
  const r = auditRota({ assignments, ledger, crew: [crew('heavy'), crew('light')], lanes: [lane('bridge')], settings, leave })
  assert.ok(r.considered > 0, 'the pairs were still examined')
  assert.deepEqual(r.improvable, [], 'no legal improvement exists')
})

Deno.test('audit: rule 1c blocks a swap that would double a week', () => {
  // A swap EXCHANGES two days, so it cannot double a week on its own — the
  // conflict has to come from a day the window does not cover. `light` already
  // stood a weekday in the ISO week beginning 30 Nov, under an earlier
  // generation, so moving Friday 4 Dec onto them is a second weekday in that
  // same week. The numbers want the swap; rule 1c forbids it.
  const assignments: PlannedAssignment[] = [
    { lane_id: 'bridge', crew_id: 'heavy', watch_date: '2026-12-04', day_type: 'weekday', is_friday: true },
    { lane_id: 'bridge', crew_id: 'light', watch_date: '2026-12-09', day_type: 'weekday', is_friday: false },
  ]
  const ledger: Ledger = {
    heavy: { ...zeroEntry('heavy'), weekday_watches: 6, friday_watches: 6, weekday_opportunities: 10 },
    light: { ...zeroEntry('light'), weekday_watches: 1, weekday_opportunities: 10 },
  }
  const people = [crew('heavy'), crew('light')]
  const free = auditRota({ assignments, ledger, crew: people, lanes: [lane('bridge')], settings })
  assert.ok(free.improvable.length > 0, 'with nothing in the way the swap is an improvement')

  const blocked = auditRota({ assignments, ledger, crew: people, lanes: [lane('bridge')], settings,
    weekdayWeeks: ['light:2026-11-30'] })
  assert.deepEqual(blocked.improvable, [], 'rule 1c removes the only improvement')
})

Deno.test('audit: a swap that flattens burden by breaking the Friday rotation is refused', () => {
  // Burden-wise it is tempting to hand a Friday to whoever is carrying least.
  // If they already have one and a colleague has none, that trades the rotation
  // for a rounder number, which is not the fairness the product promises.
  const a = (crew_id: string, watch_date: string): PlannedAssignment =>
    ({ lane_id: 'bridge', crew_id, watch_date, day_type: 'weekday', is_friday: isoWeekday(watch_date) === 5 })
  const assignments = [a('one', '2026-12-04'), a('two', '2026-12-11'), a('three', '2026-12-02')]
  const ledger: Ledger = {
    one:   { ...zeroEntry('one'),   weekday_watches: 1, friday_watches: 1, weekday_opportunities: 20 },
    two:   { ...zeroEntry('two'),   weekday_watches: 9, friday_watches: 1, weekday_opportunities: 20 },
    three: { ...zeroEntry('three'), weekday_watches: 1, friday_watches: 0, weekday_opportunities: 20 },
  }
  const r = auditRota({ assignments, ledger, crew: ['one', 'two', 'three'].map(id => crew(id)), lanes: [lane('bridge')], settings })
  for (const s of r.improvable) {
    const takesFriday = isoWeekday(s.to.watch_date) === 5 ? s.from.crew_id : isoWeekday(s.from.watch_date) === 5 ? s.to.crew_id : null
    assert.notEqual(takesFriday, 'one', 'one already has a Friday while three has none')
  }
})

Deno.test('audit: patterns catch what the per-day rules cannot', () => {
  const a = (crew_id: string, watch_date: string): PlannedAssignment =>
    ({ lane_id: 'bridge', crew_id, watch_date, day_type: isoWeekday(watch_date) >= 6 ? 'weekend' : 'weekday', is_friday: isoWeekday(watch_date) === 5 })
  // The rota that started all this: one person on three Fridays, another on
  // three Mondays, a third on back-to-back weekends.
  const p = findPatterns([
    a('jessica', '2026-12-11'), a('jessica', '2026-12-18'), a('jessica', '2026-12-25'),
    a('silvio', '2026-12-07'), a('silvio', '2026-12-14'), a('silvio', '2026-12-21'),
    a('sienna', '2026-12-05'), a('sienna', '2026-12-12'),
    a('greta', '2026-12-02'),
  ], 'sat_sun_block')
  const codes = p.map(x => x.code)
  assert.ok(codes.includes('friday_concentration'), 'three Fridays on one person')
  assert.ok(codes.includes('repeated_weekday'), 'three Mondays on one person')
  assert.ok(codes.includes('consecutive_weekends'), 'two weekends running')
  const fc = p.find(x => x.code === 'friday_concentration')!.detail as Record<string, unknown>
  assert.deepEqual(fc.repeated, [{ crew_id: 'jessica', fridays: 3 }])
  // Deterministic ordering.
  assert.deepEqual(p, findPatterns([
    a('jessica', '2026-12-11'), a('jessica', '2026-12-18'), a('jessica', '2026-12-25'),
    a('silvio', '2026-12-07'), a('silvio', '2026-12-14'), a('silvio', '2026-12-21'),
    a('sienna', '2026-12-05'), a('sienna', '2026-12-12'),
    a('greta', '2026-12-02'),
  ], 'sat_sun_block'))
})

Deno.test('audit: the current December rota raises no Friday concentration', () => {
  const p = december()
  const codes = audit(p).patterns.map(x => x.code)
  assert.ok(!codes.includes('friday_concentration'), 'Fridays are spread: ' + JSON.stringify(codes))
})

Deno.test('audit: day weights match the fairness constants', () => {
  assert.equal(dayWeight('2026-12-02'), 1.0)   // Wednesday
  assert.equal(dayWeight('2026-12-04'), 1.5)   // Friday
  assert.equal(dayWeight('2026-12-05'), 1.3)   // Saturday
})

Deno.test('audit: never disturbs the plan it inspects', () => {
  const p = december()
  const before = JSON.stringify(p.assignments)
  audit(p)
  assert.equal(JSON.stringify(p.assignments), before, 'the audit reports; it never applies')
})
