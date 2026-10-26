import { strict as assert } from 'node:assert'
import { planGlobal, validateLanes, canonicalHistory, replayGlobal, seedHistory, generationEnd, generationWindow, spanWeeks, MAX_WINDOW_DAYS, type RotaLane } from './rota_v2.ts'
import { zeroEntry, addDays, isoWeekday } from './fairness_engine.ts'
import type { Crew, ScheduleSettings, PlannedAssignment } from './schedule_engine.ts'

const crew = (id: string, department = 'deck', extra = {}): Crew => ({ id, department, eligible: true, available_from: '2020-01-01', ...extra })
const lane = (id: string, departments = ['deck'], position = 1): RotaLane => ({ id, label: id, departments, position })
const settings: ScheduleSettings = { horizon_weeks: 4, include_weekends: true, weekday_rotation_anchor: 0, weekend_rotation_anchor: 0, weekend_structure: 'per_day' }
const run = (people: Crew[], lanes: RotaLane[], overrides = {}) => planGlobal({ crew: people, lanes, startDate: '2026-09-21', settings, base: {}, ...overrides })

Deno.test('historical imports deduplicate crew/date and ignore future records', () => {
  const r={crew_id:'a',watch_date:'2026-09-18',assigned:true}
  const h=seedHistory([{...r,assigned:false},r,r,{...r,watch_date:'2026-10-01'}],'2026-09-22')
  assert.equal(h.assignments.length,1)
  assert.equal(h.opportunities.length,1)
  assert.equal(replayGlobal({},h.assignments,h.opportunities).a.friday_watches,1)
})

Deno.test('every subset, overlapping departments, and fewer lanes are valid; tier caps are enforced', () => {
  for (const tier of ['solo', 'dual', 'triple']) validateLanes([lane('a', ['deck', 'interior', 'officer', 'engineering'])], tier)
  validateLanes([lane('a'), lane('b'), lane('c')], 'triple')
  assert.throws(() => validateLanes([lane('a'), lane('b')], 'solo'))
  assert.throws(() => validateLanes([lane('a'), lane('b'), lane('c')], 'dual'))
  assert.throws(() => validateLanes([], 'triple'))
  assert.throws(() => validateLanes([lane('a', [])], 'triple'))
  assert.throws(() => validateLanes([lane('a', ['invalid'])], 'triple'))
})
Deno.test('overlap never double-books or multiplies available days', () => {
  const p = run(['a','b','c','d'].map(id => crew(id)), [lane('1'),lane('2'),lane('3')])
  assert.equal(p.assignments.length, 28*3)
  assert.equal(new Set(p.assignments.map(a => a.crew_id+':'+a.watch_date)).size, p.assignments.length)
  for (const r of p.scores) assert.equal(r.weekday_opportunities + r.weekend_opportunities,28)
  assert.equal(p.opportunities.length,4*28)
  assert.deepEqual(p,run(['d','c','b','a'].map(id => crew(id)),[lane('3'),lane('2'),lane('1')]))
})
Deno.test('joint matching reserves the only candidate for the restricted lane', () => {
  const p=run([crew('a','deck'),crew('b','interior')],[lane('flex',['deck','interior'],1),lane('restricted',['deck'],2)])
  assert.equal(p.gaps.length,0)
  assert.ok(p.assignments.filter(a => a.lane_id === 'restricted').every(a => a.crew_id === 'a'))
})
Deno.test('not enough people reports gaps without double booking', () => {
  const p=run([crew('a')],[lane('1'),lane('2'),lane('3')])
  assert.equal(p.assignments.length,28)
  assert.equal(p.gaps.length,56)
})
Deno.test('two versus five isolated crew exposes vessel-wide unfairness', () => {
  const p=run([crew('i1','interior'),crew('i2','interior'),...['d1','d2','d3','d4','d5'].map(id => crew(id))],
    [lane('interior',['interior']),lane('deck',['deck'],2)], { settings: { ...settings, horizon_weeks: 10 } })
  const i=p.scores.filter(s => s.crew_id.startsWith('i')), d=p.scores.filter(s => s.crew_id.startsWith('d'))
  assert.ok(i.every(s => s.balance === 'over' && s.fairness_score! < 85))
  assert.ok(d.every(s => s.balance === 'under'))
  assert.equal(i.reduce((sum,s)=>sum+s.total_watches,0)/i.length,35)
  assert.equal(d.reduce((sum,s)=>sum+s.total_watches,0)/d.length,14)
})
Deno.test('eligibility, joining date, leave, excluded departments, and charter pauses', () => {
  const p=run([crew('a'),crew('b','deck',{eligible:false}),crew('c','officer'),crew('d','deck',{available_from:'2026-09-25'})],
    [lane('1')], { leave:[{crew_id:'a',start:'2026-09-23',end:'2026-09-24'}],charters:[{start:'2026-09-26',end:'2026-09-27'}] })
  assert.ok(!p.assignments.some(a => ['b','c'].includes(a.crew_id)))
  assert.ok(!p.assignments.some(a => ['2026-09-26','2026-09-27'].includes(a.watch_date)))
  assert.ok(!p.opportunities.some(a => a.crew_id==='a' && ['2026-09-23','2026-09-24'].includes(a.watch_date)))
  assert.ok(!p.opportunities.some(a => a.crew_id==='d' && a.watch_date<'2026-09-25'))
})
Deno.test('weekend blocks use the same person, all-days availability, and global Monday rest', () => {
  const p=run([crew('a'),crew('b'),crew('c')],[lane('1')],{
    settings:{...settings,weekend_structure:'fri_sat_sun_block'},
    leave:[{crew_id:'a',start:'2026-09-27',end:'2026-09-27'}] })
  const block=p.assignments.filter(a => a.watch_date>='2026-09-25'&&a.watch_date<='2026-09-27')
  assert.equal(new Set(block.map(a => a.crew_id)).size,1)
  assert.notEqual(block[0].crew_id,'a')
  assert.notEqual(p.assignments.find(a=>a.watch_date==='2026-09-28')?.crew_id,block[0].crew_id)
  assert.equal(p.opportunities.filter(o=>o.crew_id==='a' && o.watch_date>='2026-09-25'&&o.watch_date<='2026-09-27').length,0)
})
Deno.test('global Monday rest follows a person after moving lanes; relax only for coverage', () => {
  const base={a:{...zeroEntry('a'),last_weekend_date:'2026-09-20'},b:zeroEntry('b')}
  const p=run([crew('a'),crew('b')],[lane('new')],{base})
  assert.equal(p.assignments[0].crew_id,'b')
  const needed=run([crew('a'),crew('b')],[lane('new'),lane('other')],{base})
  assert.equal(needed.assignments.filter(a=>a.watch_date==='2026-09-21').length,2)
  assert.equal(needed.events.filter(e=>e.watch_date==='2026-09-21'&&e.reason_code==='constraint_relaxed_monday_exclusion').length,1)
})
Deno.test('canonical versions preserve old past and discard superseded future, including shorter horizons', () => {
  const versions=[
    {id:'old',start_date:'2026-09-01',end_date:'2026-10-01',generated_at:'2026-09-01'},
    {id:'new',start_date:'2026-09-10',end_date:'2026-09-17',generated_at:'2026-09-10'},
  ]
  const asg=(schedule_id:string,watch_date:string) => ({schedule_id,watch_date,lane_id:'old-lane',crew_id:'a',day_type:'weekday' as const,is_friday:false})
  const p=canonicalHistory(versions,[asg('old','2026-09-05'),asg('old','2026-09-12'),asg('new','2026-09-12'),asg('old','2026-09-20')],[],'2026-09-22')
  assert.deepEqual(p.assignments.map(a=>a.schedule_id+':'+a.watch_date),['old:2026-09-05','new:2026-09-12'])
})
Deno.test('history replay deduplicates and preserves global balances after regrouping', () => {
  const a: PlannedAssignment={lane_id:'retired',crew_id:'a',watch_date:'2026-09-18',day_type:'weekday',is_friday:true}
  const opp=[{crew_id:'a',watch_date:a.watch_date},{crew_id:'b',watch_date:a.watch_date}]
  const base=replayGlobal({},[a,a],[...opp,...opp])
  assert.equal(base.a.total_watches,1); assert.equal(base.a.weekday_opportunities,1)
  const p=run([crew('a'),crew('b')],[lane('regrouped')],{base})
  assert.equal(p.assignments[0].crew_id,'b')
  assert.equal(p.ledger.a.total_watches+p.ledger.b.total_watches,29)
  assert.equal(base.a.total_watches,1)
  assert.deepEqual(p,run([crew('a'),crew('b')],[lane('regrouped')],{base}))
})
Deno.test('no weekends, horizon bounds, no opportunities, and long deterministic run', () => {
  const p=run([crew('a','deck',{available_from:'2027-01-01'})],[lane('1')],{settings:{...settings,horizon_weeks:13,include_weekends:false}})
  assert.equal(p.gaps.length,65);assert.equal(p.scores[0].fairness_score,null)
  assert.equal(p.end_date,addDays('2026-09-21',90))
})

// fairness.md rule 3b/1b — the mirror of the Monday rest rule.
const standingByDate = (assignments: PlannedAssignment[]) => {
  const on = new Map<string, string[]>()
  for (const a of assignments) on.set(a.watch_date, [...(on.get(a.watch_date) ?? []), a.crew_id])
  return on
}
Deno.test('nobody stands a Friday into that weekend, under per_day and sat_sun_block alike', () => {
  const people = ['a','b','c','d','e'].map(id => crew(id))
  for (const weekend_structure of ['per_day','sat_sun_block'] as const) {
    const p = run(people, [lane('1')], { settings: { ...settings, weekend_structure, horizon_weeks: 13 } })
    const on = standingByDate(p.assignments)
    assert.equal(p.gaps.length, 0)
    for (const [date, ids] of on) {
      const wd = isoWeekday(date)
      if (wd < 6) continue
      const friday = addDays(date, wd === 6 ? -1 : -2)
      for (const id of ids) assert.ok(!(on.get(friday) ?? []).includes(id), `${id} stood ${friday} and ${date} under ${weekend_structure}`)
    }
  }
})
Deno.test('fri_sat_sun_block is exempt — its Friday IS the block lead', () => {
  const p = run(['a','b','c','d','e'].map(id => crew(id)), [lane('1')], { settings: { ...settings, weekend_structure: 'fri_sat_sun_block' } })
  const on = standingByDate(p.assignments)
  const blocks = [...on].filter(([d]) => isoWeekday(d) === 5)
  assert.ok(blocks.length > 0)
  for (const [friday, ids] of blocks) {
    for (const d of [addDays(friday, 1), addDays(friday, 2)]) assert.deepEqual(on.get(d), ids)
  }
})
Deno.test('a crew too small to rest relaxes the Friday rule rather than leaving the weekend uncovered', () => {
  for (const weekend_structure of ['per_day','sat_sun_block'] as const) {
    const p = run([crew('solo')], [lane('1')], { settings: { ...settings, weekend_structure } })
    assert.equal(p.gaps.length, 0)
    assert.equal(p.assignments.find(a => a.watch_date === '2026-09-26')?.crew_id, 'solo')
    assert.equal(p.events.find(e => e.watch_date === '2026-09-26')?.reason_code, 'constraint_relaxed_friday_exclusion')
    // The Monday rule still owns Mondays; the two never collide.
    assert.equal(p.events.find(e => e.watch_date === '2026-09-28')?.reason_code, 'constraint_relaxed_monday_exclusion')
  }
})
Deno.test('the Friday exclusion reaches across a generation boundary via the ledger', () => {
  // Generation starts on a Saturday; the Friday before it lives in history only.
  const base = { a: { ...zeroEntry('a'), last_watch_date: '2026-09-25', total_watches: 1, weekday_watches: 1, friday_watches: 1 }, b: zeroEntry('b') }
  const p = run([crew('a'), crew('b')], [lane('1')], { startDate: '2026-09-26', base, settings: { ...settings, weekend_structure: 'sat_sun_block' } })
  assert.equal(p.assignments.find(a => a.watch_date === '2026-09-26')?.crew_id, 'b')
  assert.equal(p.assignments.find(a => a.watch_date === '2026-09-27')?.crew_id, 'b')
})

// schedule.md §5.1 — the generation window: weeks, a month, or a range.
Deno.test('an explicit window is honoured exactly and still described in weeks', () => {
  const p = run(['a','b','c'].map(id => crew(id)), [lane('1')], { endDate: '2026-10-31' })
  assert.equal(p.start_date, '2026-09-21')
  assert.equal(p.end_date, '2026-10-31')
  assert.equal(p.horizon_weeks, 6)                       // ceil(41 / 7), a derived descriptor
  assert.equal(new Set(p.assignments.map(a => a.watch_date)).size, 41)
  assert.deepEqual(p, run(['c','b','a'].map(id => crew(id)), [lane('1')], { endDate: '2026-10-31' }))
})
Deno.test('a whole month is just a range, and the 91-day cap binds every shape', () => {
  const november = run(['a','b','c'].map(id => crew(id)), [lane('1')], { startDate: '2026-11-01', endDate: '2026-11-30' })
  assert.equal(november.end_date, '2026-11-30')
  assert.equal(new Set(november.assignments.map(a => a.watch_date)).size, 30)
  // Over-long windows and absurd horizons both clamp to the same 91 days.
  assert.equal(generationEnd('2026-09-21', 4, '2027-09-21'), addDays('2026-09-21', MAX_WINDOW_DAYS - 1))
  assert.equal(generationEnd('2026-09-21', 99), addDays('2026-09-21', 90))
  assert.equal(run(['a'].map(id => crew(id)), [lane('1')], { endDate: '2027-09-21' }).horizon_weeks, 13)
  // An end before the start degrades to a single day rather than an empty plan.
  assert.equal(generationEnd('2026-09-21', 4, '2026-09-01'), '2026-09-21')
  assert.equal(spanWeeks('2026-09-21', '2026-09-21'), 1)
})
Deno.test('weeks mode is byte-identical to the pre-window engine', () => {
  const people = ['a','b','c','d'].map(id => crew(id))
  const p = run(people, [lane('1'), lane('2', ['deck'], 2)])
  assert.equal(p.end_date, addDays('2026-09-21', 4 * 7 - 1))
  assert.equal(p.horizon_weeks, 4)
  assert.deepEqual(p, run(people, [lane('1'), lane('2', ['deck'], 2)], { endDate: null }))
})

Deno.test('the window derivation: weeks rolls forward, month/range is taken as given but never rewrites the past', () => {
  const today = '2026-10-26'
  const weeks = { schedule_start_date: '2026-11-15', generation_mode: 'weeks' as const }
  assert.deepEqual(generationWindow(weeks, today, true), { start: '2026-11-15', endDate: null })
  assert.deepEqual(generationWindow(weeks, today, false), { start: today, endDate: null })
  // A month already under way starts today, not on the 1st.
  const october = { schedule_start_date: '2026-01-01', generation_mode: 'month' as const, generation_start_date: '2026-10-01', generation_end_date: '2026-10-31' }
  assert.deepEqual(generationWindow(october, today, false), { start: today, endDate: '2026-10-31' })
  // Planning ahead keeps its own start.
  const december = { ...october, generation_start_date: '2026-12-01', generation_end_date: '2026-12-31' }
  assert.deepEqual(generationWindow(december, today, false), { start: '2026-12-01', endDate: '2026-12-31' })
  // A window wholly in the past is refused, as is a half-set one.
  assert.throws(() => generationWindow({ ...october, generation_start_date: '2026-09-01', generation_end_date: '2026-09-30' }, today, false), /already passed/)
  assert.throws(() => generationWindow({ ...october, generation_end_date: null }, today, false), /start and end date/)
})
Deno.test('a planned-ahead window never costs the crew their earlier duty in the ledger', () => {
  // November is generated, then December is planned while October is still running.
  const versions = [
    { id: 'nov', start_date: '2026-11-01', end_date: '2026-11-30', generated_at: '2026-10-20' },
    { id: 'dec', start_date: '2026-12-01', end_date: '2026-12-31', generated_at: '2026-10-26' },
  ]
  const asg = (schedule_id: string, watch_date: string) => ({ schedule_id, watch_date, lane_id: '1', crew_id: 'a', day_type: 'weekday' as const, is_friday: false })
  const past = canonicalHistory(versions, [asg('nov', '2026-11-10'), asg('dec', '2026-12-10')], [], '2026-12-15')
  assert.deepEqual(past.assignments.map(a => a.schedule_id), ['nov', 'dec'])
})
