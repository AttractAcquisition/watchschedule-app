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

Deno.test('audit: every swap it reports is a real, legal, ordered improvement', () => {
  // The engine is GREEDY — it commits each day against the ledger as it stood
  // at that moment — so a finished month can still hold improvements it could
  // not have seen. Surfacing them is the audit's entire purpose, and asserting
  // "always zero" would only be asserting that the engine is already optimal,
  // which it is not and does not claim to be. What must hold is that every
  // suggestion is genuine: positive, ordered, and legal.
  const r = audit(december())
  assert.ok(r.considered > 100, 'pairs were actually examined: ' + r.considered)
  for (const s of r.improvable) {
    assert.ok(s.gain > 0, 'no zero-gain noise')
    assert.notEqual(s.from.crew_id, s.to.crew_id)
    assert.ok(isoWeekday(s.from.watch_date) < 6 && isoWeekday(s.to.watch_date) < 6, 'weekday-to-weekday only')
  }
  const gains = r.improvable.map(s => s.gain)
  assert.deepEqual(gains, [...gains].sort((a, b) => b - a), 'best first')
  assert.deepEqual(r.improvable, audit(december()).improvable, 'deterministic')
})

Deno.test('audit: no suggestion ever unbalances the Friday rotation', () => {
  const p = december()
  const r = audit(p)
  const fridays = new Map<string, number>()
  for (const a of p.assignments) if (isoWeekday(a.watch_date) === 5) fridays.set(a.crew_id, (fridays.get(a.crew_id) ?? 0) + 1)
  const variance = (m: Map<string, number>) => {
    const v = names.map(id => m.get(id) ?? 0)
    const mean = v.reduce((x, y) => x + y, 0) / v.length
    return v.reduce((x, y) => x + (y - mean) ** 2, 0) / v.length
  }
  const before = variance(fridays)
  for (const s of r.improvable) {
    const fFrom = isoWeekday(s.from.watch_date) === 5, fTo = isoWeekday(s.to.watch_date) === 5
    if (fFrom === fTo) continue
    const after = new Map(fridays)
    const giver = fFrom ? s.from.crew_id : s.to.crew_id, taker = fFrom ? s.to.crew_id : s.from.crew_id
    after.set(giver, (after.get(giver) ?? 0) - 1); after.set(taker, (after.get(taker) ?? 0) + 1)
    assert.ok(variance(after) <= before + 1e-9, 'rotation must never be traded for a rounder total')
  }
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
  assert.deepEqual(fc.ahead, ['jessica'])
  assert.equal(fc.spread, 3)
  // Deterministic ordering.
  assert.deepEqual(p, findPatterns([
    a('jessica', '2026-12-11'), a('jessica', '2026-12-18'), a('jessica', '2026-12-25'),
    a('silvio', '2026-12-07'), a('silvio', '2026-12-14'), a('silvio', '2026-12-21'),
    a('sienna', '2026-12-05'), a('sienna', '2026-12-12'),
    a('greta', '2026-12-02'),
  ], 'sat_sun_block'))
})

Deno.test('audit: Friday concentration is judged CUMULATIVELY, not per window', () => {
  const p = december()
  assert.ok(!audit(p).patterns.some(x => x.code === 'friday_concentration'), 'Fridays are spread')

  // The false positive this replaced: eight Fridays across six people is
  // 2,2,1,1,1,1 — the only distribution available — yet counting the window
  // alone showed "Greta 2, Jessica 0" and reported a concentration, because
  // Jessica had taken her turn the month before.
  const a = (crew_id: string, watch_date: string): PlannedAssignment =>
    ({ lane_id: 'bridge', crew_id, watch_date, day_type: 'weekday', is_friday: true })
  const window = [a('greta', '2026-12-04'), a('elisa', '2026-12-11'), a('silvio', '2026-12-18'),
                  a('greta', '2026-12-25'), a('sienna', '2027-01-01')]
  const cumulative: Ledger = Object.fromEntries(
    [['greta', 2], ['sienna', 2], ['elisa', 1], ['jessica', 1], ['silvio', 1], ['alexander', 1]]
      .map(([id, f]) => [id, { ...zeroEntry(id as string), friday_watches: f as number }]))
  assert.ok(!findPatterns(window, 'sat_sun_block', cumulative).some(x => x.code === 'friday_concentration'),
    'a turn taken last month still counts')
  // A genuine two-turn gap is still reported — the check was narrowed, not removed.
  const lopsided: Ledger = Object.fromEntries(
    [['greta', 3], ['sienna', 1], ['elisa', 1], ['jessica', 0], ['silvio', 1], ['alexander', 1]]
      .map(([id, f]) => [id, { ...zeroEntry(id as string), friday_watches: f as number }]))
  const found = findPatterns(window, 'sat_sun_block', lopsided).find(x => x.code === 'friday_concentration')
  assert.ok(found, 'three turns against none is a real concentration')
  assert.equal((found!.detail as Record<string, unknown>).basis, 'cumulative')
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
