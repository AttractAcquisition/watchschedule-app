import { strict as assert } from 'node:assert'
import { planGlobal, validateLanes, canonicalHistory, replayGlobal, seedHistory, type RotaLane } from './rota_v2.ts'
import { zeroEntry, addDays } from './fairness_engine.ts'
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
