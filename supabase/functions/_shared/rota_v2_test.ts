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
  // A Sunday stood is also the last watch stood. (Before 28 Nov 2026 this base
  // left last_watch_date empty; with only two crew every day relaxes a rule, and
  // the back-to-back preference reads last_watch_date for the day before.)
  const base={a:{...zeroEntry('a'),last_weekend_date:'2026-09-20',last_watch_date:'2026-09-20'},b:zeroEntry('b')}
  const p=run([crew('a'),crew('b')],[lane('new')],{base})
  assert.equal(p.assignments.find(a=>a.watch_date==='2026-09-21')!.crew_id,'b')
  const needed=run([crew('a'),crew('b')],[lane('new'),lane('other')],{base})
  assert.equal(needed.assignments.filter(a=>a.watch_date==='2026-09-21').length,2)
  assert.equal(needed.events.filter(e=>e.watch_date==='2026-09-21'&&e.reason_code==='constraint_relaxed_monday_exclusion').length,1)
})
// 24 Nov 2026: narrowing a window re-plans only the days inside it. Days the
// older generation still covers are RETAINED, not retired.
Deno.test('canonical versions preserve the old past and the tail a narrowed window no longer covers', () => {
  const versions=[
    {id:'old',start_date:'2026-09-01',end_date:'2026-10-01',generated_at:'2026-09-01'},
    {id:'new',start_date:'2026-09-10',end_date:'2026-09-17',generated_at:'2026-09-10'},
  ]
  const asg=(schedule_id:string,watch_date:string) => ({schedule_id,watch_date,lane_id:'old-lane',crew_id:'a',day_type:'weekday' as const,is_friday:false})
  const p=canonicalHistory(versions,[asg('old','2026-09-05'),asg('old','2026-09-12'),asg('new','2026-09-12'),asg('old','2026-09-20')],[],'2026-09-22')
  assert.deepEqual(p.assignments.map(a=>a.schedule_id+':'+a.watch_date),['old:2026-09-05','new:2026-09-12','old:2026-09-20'])
})

Deno.test('a date no generation covers is owned by nobody', () => {
  const versions=[{id:'only',start_date:'2026-09-01',end_date:'2026-09-30',generated_at:'2026-09-01'}]
  const asg=(schedule_id:string,watch_date:string) => ({schedule_id,watch_date,lane_id:'l',crew_id:'a',day_type:'weekday' as const,is_friday:false})
  const p=canonicalHistory(versions,[asg('only','2026-08-31'),asg('only','2026-09-15')],[],'2026-12-31')
  assert.deepEqual(p.assignments.map(a=>a.watch_date),['2026-09-15'])
})

// The retained tail is reported separately so generation can score it: it is
// rostered, but it is not being re-planned by this run.
Deno.test('canonicalHistory separates the retained tail from the replanned window', () => {
  const versions=[
    {id:'nov',start_date:'2026-11-01',end_date:'2026-11-30',generated_at:'2026-10-28'},
    {id:'narrow',start_date:'2026-11-05',end_date:'2026-11-15',generated_at:'2026-11-04'},
  ]
  const asg=(schedule_id:string,watch_date:string) => ({schedule_id,watch_date,lane_id:'l',crew_id:'a',day_type:'weekday' as const,is_friday:false})
  const rows=[asg('nov','2026-11-02'),asg('nov','2026-11-10'),asg('narrow','2026-11-10'),asg('nov','2026-11-20'),asg('nov','2026-11-28')]
  const p=canonicalHistory(versions,rows,[],'2026-11-05','2026-11-15')
  // before the window: ordinary history
  assert.deepEqual(p.assignments.map(a=>a.watch_date),['2026-11-02'])
  // beyond the window: retained, still owned by the older generation
  assert.deepEqual(p.retainedAssignments.map(a=>a.schedule_id+':'+a.watch_date),['nov:2026-11-20','nov:2026-11-28'])
})

Deno.test('generation scores the retained tail it did not replan', () => {
  const people=[crew('a'),crew('b')]
  const tail:PlannedAssignment[]=[{lane_id:'1',crew_id:'a',watch_date:'2026-11-20',day_type:'weekday',is_friday:false}]
  const opportunities=[{crew_id:'a',watch_date:'2026-11-20'},{crew_id:'b',watch_date:'2026-11-20'}]
  const without=run(people,[lane('1')])
  const with_=run(people,[lane('1')],{retained:{assignments:tail,opportunities}})
  const total=(p:{scores:{crew_id:string;total_watches:number}[]},id:string)=>p.scores.find(s=>s.crew_id===id)!.total_watches
  assert.equal(total(with_,'a'),total(without,'a')+1)
  assert.equal(total(with_,'b'),total(without,'b'))
  // the tail is scored, never re-planned into this window's assignments
  assert.equal(with_.assignments.filter(a=>a.watch_date==='2026-11-20').length,0)
  assert.deepEqual(with_.assignments,without.assignments)
})

Deno.test('someone appearing only in the retained tail is still scored', () => {
  const tail:PlannedAssignment[]=[{lane_id:'retired',crew_id:'ghost',watch_date:'2026-11-20',day_type:'weekday',is_friday:false}]
  const p=run([crew('a')],[lane('1')],{retained:{assignments:tail,opportunities:[{crew_id:'ghost',watch_date:'2026-11-20'}]}})
  assert.equal(p.scores.find(s=>s.crew_id==='ghost')!.total_watches,1)
})

Deno.test('an empty retained tail leaves generation bit-for-bit unchanged', () => {
  const people=[crew('a'),crew('b'),crew('c')]
  assert.deepEqual(run(people,[lane('1')],{retained:{assignments:[],opportunities:[]}}),run(people,[lane('1')]))
})
Deno.test('history replay deduplicates and preserves global balances after regrouping', () => {
  const a: PlannedAssignment={lane_id:'retired',crew_id:'a',watch_date:'2026-09-18',day_type:'weekday',is_friday:true}
  const opp=[{crew_id:'a',watch_date:a.watch_date},{crew_id:'b',watch_date:a.watch_date}]
  const base=replayGlobal({},[a,a],[...opp,...opp])
  assert.equal(base.a.total_watches,1); assert.equal(base.a.weekday_opportunities,1)
  const p=run([crew('a'),crew('b')],[lane('regrouped')],{base})
  // The carried Friday still counts: b stands at least as many of this window's
  // Fridays as a, so the two end within one of each other. (Which Friday b
  // takes first is no longer the 25th: with two crew every Friday breaks rule
  // 1b, and b holds the Saturday after it — fairness.md §8 rule 2d.)
  const fridays=p.assignments.filter(a=>a.is_friday)
  assert.ok(fridays.filter(f=>f.crew_id==='b').length>=fridays.filter(f=>f.crew_id==='a').length)
  assert.ok(Math.abs(p.ledger.a.friday_watches-p.ledger.b.friday_watches)<=1)
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
    // Scarcity order decides the weekend first, so rule 1b — one constraint with
    // one evaluation point — is now read off the Friday leading INTO the weekend
    // rather than off the weekend looking back. Same violation, same single
    // relaxation, named on the day that causes it.
    assert.equal(p.events.find(e => e.watch_date === '2026-09-25')?.reason_code, 'constraint_relaxed_friday_exclusion')
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

// --- Fixed watches (docs/fixed-watches.md) ---------------------------------
// 2026-09-21 is a Monday; the window's weekends are 26/27 Sep, 3/4, 10/11, 17/18 Oct.
const WEEKEND_DAYS = ['2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11', '2026-10-17', '2026-10-18']

Deno.test('a fixed watch is honoured exactly, and the engine plans the rest around it', () => {
  const pins = [{ lane_id: '1', crew_id: 'c', watch_date: '2026-09-26' }]
  const p = run(['a', 'b', 'c'].map(id => crew(id)), [lane('1')], { pins })
  assert.equal(p.assignments.find(a => a.watch_date === '2026-09-26')?.crew_id, 'c')
  assert.equal(p.gaps.length, 0)
  // The pin is recorded as the reason, not dressed up as a fairness match.
  const event = p.events.find(e => e.watch_date === '2026-09-26')!
  assert.equal(event.reason_code, 'fixed_watch')
  assert.equal((event.detail as { pinned: boolean }).pinned, true)
})

Deno.test('a pinned watch lands on the ledger, so fairness absorbs it', () => {
  const pins = WEEKEND_DAYS.map(d => ({ lane_id: '1', crew_id: 'c', watch_date: d }))
  const p = run(['a', 'b', 'c'].map(id => crew(id)), [lane('1')], { pins })
  const score = (id: string) => p.scores.find(s => s.crew_id === id)!
  assert.equal(score('c').weekend_watches, WEEKEND_DAYS.length)
  assert.equal(score('a').weekend_watches, 0)
  assert.equal(score('b').weekend_watches, 0)
  // Standing every weekend, c is carrying more than their share.
  assert.ok(score('c').deviation > 0)
  // And the rest rule still protects them: no Monday straight off those weekends.
  for (const monday of ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']) {
    assert.ok(!p.assignments.some(a => a.watch_date === monday && a.crew_id === 'c'))
  }
})

Deno.test('a pinned person is reserved vessel-wide for that day', () => {
  const pins = [{ lane_id: '2', crew_id: 'a', watch_date: '2026-09-26' }]
  const p = run(['a', 'b', 'c'].map(id => crew(id)), [lane('1'), lane('2')], { pins })
  const day = p.assignments.filter(a => a.watch_date === '2026-09-26')
  assert.equal(day.find(a => a.lane_id === '2')?.crew_id, 'a')
  assert.ok(!day.some(a => a.lane_id === '1' && a.crew_id === 'a'))
  assert.equal(new Set(day.map(a => a.crew_id)).size, day.length)
})

Deno.test('a pinned crew member outside every lane pool still stands, and is scored for it', () => {
  const pins = [{ lane_id: '1', crew_id: 'x', watch_date: '2026-09-26' }]
  const p = run([crew('a'), crew('x', 'interior')], [lane('1', ['deck'])], { pins })
  assert.equal(p.assignments.find(a => a.watch_date === '2026-09-26')?.crew_id, 'x')
  const x = p.scores.find(s => s.crew_id === 'x')!
  assert.equal(x.total_watches, 1)
  assert.ok(x.weekend_opportunities > 0)
})

Deno.test('pins never disturb determinism', () => {
  const pins = [
    { lane_id: '1', crew_id: 'c', watch_date: '2026-09-26' },
    { lane_id: '2', crew_id: 'a', watch_date: '2026-10-03' },
  ]
  const people = ['a', 'b', 'c', 'd'].map(id => crew(id))
  const lanes = [lane('1'), lane('2')]
  assert.deepEqual(run(people, lanes, { pins }), run(people, lanes, { pins: [...pins].reverse() }))
})

Deno.test('a pin on a day the schedule never covers is simply ignored', () => {
  const people = ['a', 'b', 'c'].map(id => crew(id))
  const plain = run(people, [lane('1')])
  // Weekends off: a weekend pin has nothing to attach to.
  const pins = [{ lane_id: '1', crew_id: 'c', watch_date: '2026-09-26' }]
  const noWeekends = { settings: { ...settings, include_weekends: false } }
  assert.deepEqual(
    run(people, [lane('1')], { ...noWeekends, pins }),
    run(people, [lane('1')], noWeekends),
  )
  // An unknown lane or crew id cannot smuggle anything in either.
  assert.deepEqual(run(people, [lane('1')], { pins: [{ lane_id: 'nope', crew_id: 'c', watch_date: '2026-09-26' }] }), plain)
  assert.deepEqual(run(people, [lane('1')], { pins: [{ lane_id: '1', crew_id: 'nope', watch_date: '2026-09-26' }] }), plain)
})

// Legacy 4, 24 Nov 2026: Greta was pinned to Sat 28 + Sun 29 under
// sat_sun_block. Generation then handed her the Friday before it too, because
// the Friday-into-weekend rule only ever looked BACKWARDS. A clean candidate
// was going spare and nobody had consented to anything — the pin's own consent
// check had found no violation, since on the day it was made the Friday was
// not yet a fact either.
Deno.test('a pin is a fact for the Friday leading into it', () => {
  const people = ['a', 'b', 'c'].map(id => crew(id))
  const block: ScheduleSettings = { ...settings, weekend_structure: 'sat_sun_block' }
  // 2026-09-25 is a Friday; 26/27 the weekend it leads into.
  const pins = [
    { lane_id: '1', crew_id: 'c', watch_date: '2026-09-26' },
    { lane_id: '1', crew_id: 'c', watch_date: '2026-09-27' },
  ]
  const p = run(people, [lane('1')], { settings: block, pins })
  const who = (d: string) => p.assignments.find(a => a.watch_date === d)?.crew_id
  // The pin stands, both halves of the block.
  assert.equal(who('2026-09-26'), 'c')
  assert.equal(who('2026-09-27'), 'c')
  // ...and the Friday before it goes to somebody else.
  assert.notEqual(who('2026-09-25'), 'c')
})

Deno.test('a pin is a fact for the Monday following it', () => {
  const people = ['a', 'b', 'c'].map(id => crew(id))
  const block: ScheduleSettings = { ...settings, weekend_structure: 'sat_sun_block' }
  // 2026-09-28 is the Monday after the 26/27 weekend.
  const pins = [{ lane_id: '1', crew_id: 'c', watch_date: '2026-09-28' }]
  const p = run(people, [lane('1')], { settings: block, pins })
  const who = (d: string) => p.assignments.find(a => a.watch_date === d)?.crew_id
  assert.equal(who('2026-09-28'), 'c')
  // The weekend before a pinned Monday must not also be theirs.
  assert.notEqual(who('2026-09-26'), 'c')
})

Deno.test('the forward pin check still yields rather than leave a day uncovered', () => {
  // One eligible person: the rule is relaxed, not used as an excuse for a gap.
  const block: ScheduleSettings = { ...settings, weekend_structure: 'sat_sun_block' }
  const pins = [{ lane_id: '1', crew_id: 'a', watch_date: '2026-09-26' }]
  const p = run([crew('a')], [lane('1')], { settings: block, pins })
  assert.equal(p.assignments.find(a => a.watch_date === '2026-09-25')?.crew_id, 'a')
  assert.equal(p.gaps.filter(g => g.watch_date === '2026-09-25').length, 0)
})

Deno.test('forward pin awareness does not disturb determinism', () => {
  const people = ['a', 'b', 'c', 'd'].map(id => crew(id))
  const block: ScheduleSettings = { ...settings, weekend_structure: 'sat_sun_block' }
  const pins = [{ lane_id: '1', crew_id: 'c', watch_date: '2026-09-26' }]
  assert.deepEqual(
    run(people, [lane('1')], { settings: block, pins }),
    run(people, [lane('1')], { settings: block, pins }),
  )
})


// ---------------------------------------------------------------------------
// fairness.md rule 1c — same-week weekday spacing (24 November 2026)
// ---------------------------------------------------------------------------

// The vessel the defect was reported on: one lane, six eligible crew,
// sat_sun_block. Before rule 1c this produced Greta 1+4 Dec, Elisa 8+11 Dec
// and Silvio 15+18 Dec — a Tuesday and the Friday of the same week, three days
// apart, every time, while the TOTALS stayed balanced. That is the signature of
// a burden rate with no concept of a week: Friday is chosen on its own ladder
// (W_FRIDAY_SELECT) and kept landing on whoever the weekday rotation had
// already used on the Tuesday.
const december = (overrides = {}) => planGlobal({
  crew: ['greta', 'elisa', 'silvio', 'sienna', 'jessica', 'alexander'].map(id => crew(id)),
  lanes: [lane('bridge')],
  startDate: '2026-12-01',
  settings: { ...settings, horizon_weeks: 4, weekend_structure: 'sat_sun_block' },
  base: {},
  ...overrides,
})

// crew -> the ISO weeks in which they stand more than one weekday watch
const repeatWeeks = (plan: { assignments: PlannedAssignment[] }) => {
  const seen = new Map<string, number>()
  for (const a of plan.assignments) {
    if (isoWeekday(a.watch_date) >= 6) continue
    const k = a.crew_id + ':' + addDays(a.watch_date, 1 - isoWeekday(a.watch_date))
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k).sort()
}

Deno.test('rule 1c: six crew never stand two weekday watches in one ISO week', () => {
  const plan = december()
  assert.deepEqual(repeatWeeks(plan), [])
  // and the rota is still fully covered — spacing must not create gaps
  assert.equal(plan.assignments.filter(a => isoWeekday(a.watch_date) < 6).length,
    new Set(plan.assignments.filter(a => isoWeekday(a.watch_date) < 6).map(a => a.watch_date)).size)
  // no relaxation was needed: five weekday slots, six candidates
  assert.equal(plan.events.filter(e => e.reason_code === 'constraint_relaxed_week_exclusion').length, 0)
})

Deno.test('rule 1c: a weekend is not CHECKED against the week it falls in', () => {
  // Every crew member has already spent this ISO week's weekday slot. The
  // weekdays must therefore all relax — but the weekend block of the same week
  // is a different rotation and must be assigned cleanly, unrelaxed.
  const weekOf = (d: string) => addDays(d, 1 - isoWeekday(d))
  const spent = ['greta', 'elisa', 'silvio', 'sienna', 'jessica', 'alexander'].map(id => id + ':' + weekOf('2026-12-01'))
  const plan = december({ weekdayWeeks: spent, settings: { ...settings, horizon_weeks: 1, weekend_structure: 'sat_sun_block' } })
  const kind = (d: string) => plan.events.find(e => e.watch_date === d)!.reason_code
  for (const d of ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
    assert.equal(kind(d), 'constraint_relaxed_week_exclusion', d + ' had no clean candidate left')
  for (const d of ['2026-12-05', '2026-12-06'])
    assert.equal(kind(d), 'global_fairness_match', d + ' is a weekend — rule 1c must not touch it')
})

Deno.test('rule 1c: a weekend is not COUNTED towards the week either', () => {
  // Five crew, one lane: a week holds five weekday slots plus one weekend
  // block — six duties for five people. Somebody must stand twice, and because
  // weekday repeats are excluded it has to be a weekday AND that week's
  // weekend. If the weekend counted towards the week, this would be impossible
  // and the engine would be forced into a recorded relaxation instead.
  const weekOf = (d: string) => addDays(d, 1 - isoWeekday(d))
  const plan = planGlobal({
    crew: ['a', 'b', 'c', 'd', 'e'].map(id => crew(id)),
    lanes: [lane('bridge')],
    startDate: '2026-12-07',
    settings: { ...settings, horizon_weeks: 1, weekend_structure: 'sat_sun_block' },
    base: {},
  })
  assert.deepEqual(repeatWeeks(plan), [], 'no weekday repeats')
  assert.equal(plan.events.filter(e => e.reason_code === 'constraint_relaxed_week_exclusion').length, 0,
    'nothing had to be forced')
  const pairs = new Set<string>()
  for (const a of plan.assignments) {
    const others = plan.assignments.filter(o => o.crew_id === a.crew_id && weekOf(o.watch_date) === weekOf(a.watch_date))
    if (others.some(o => isoWeekday(o.watch_date) < 6) && others.some(o => isoWeekday(o.watch_date) >= 6)) pairs.add(a.crew_id)
  }
  assert.ok(pairs.size > 0, 'somebody stands a weekday and that same week\'s weekend, freely')
})

Deno.test('rule 1c yields rather than leave a weekday uncovered', () => {
  // Three crew, five weekday slots: a repeat is unavoidable. Coverage wins and
  // the relaxation is RECORDED, per fairness.md section 8 rule 2c.
  const plan = planGlobal({
    crew: ['a', 'b', 'c'].map(id => crew(id)),
    lanes: [lane('bridge')],
    startDate: '2026-12-01',
    settings: { ...settings, horizon_weeks: 1, weekend_structure: 'sat_sun_block' },
    base: {},
  })
  const weekdays = plan.assignments.filter(a => isoWeekday(a.watch_date) < 6)
  assert.equal(weekdays.length, 5, 'every weekday still covered')
  assert.equal(plan.events.filter(e => e.reason_code === 'no_eligible_crew').length, 0)
  assert.ok(plan.events.some(e => e.reason_code === 'constraint_relaxed_week_exclusion'),
    'the forced repeat is recorded, never silent')
  assert.ok(repeatWeeks(plan).length > 0, 'and it genuinely is a repeat')
})

Deno.test('rule 1c: a week the window only half covers is spaced from the facts either side', () => {
  // Window opens Wednesday 2 Dec. Monday 30 Nov and Tuesday 1 Dec belong to the
  // SAME ISO week and were stood by `a` and `b` under an earlier generation —
  // neither is being replanned, so both are fact. Rule 1c must see them.
  const weekOf = (d: string) => addDays(d, 1 - isoWeekday(d))
  const plan = planGlobal({
    crew: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => crew(id)),
    lanes: [lane('bridge')],
    startDate: '2026-12-02',
    settings: { ...settings, horizon_weeks: 1, weekend_structure: 'sat_sun_block' },
    base: {},
    weekdayWeeks: ['a:' + weekOf('2026-11-30'), 'b:' + weekOf('2026-12-01')],
  })
  const firstWeek = plan.assignments
    .filter(a => isoWeekday(a.watch_date) < 6 && weekOf(a.watch_date) === weekOf('2026-12-02'))
    .map(a => a.crew_id)
  assert.ok(!firstWeek.includes('a'), 'a already stood the Monday of this week')
  assert.ok(!firstWeek.includes('b'), 'b already stood the Tuesday of this week')
  assert.equal(firstWeek.length, 3, 'Wed/Thu/Fri still covered')
  assert.equal(new Set(firstWeek).size, 3)
})

Deno.test('rule 1c never disturbs determinism', () => {
  const a = december()
  const b = december()
  assert.deepEqual(a.assignments, b.assignments)
  assert.deepEqual(a.events, b.events)
  // and the same holds with facts supplied from outside the window
  const w = ['greta:2026-11-30', 'elisa:2026-12-07']
  assert.deepEqual(december({ weekdayWeeks: w }).assignments, december({ weekdayWeeks: w }).assignments)
  // an empty fact list is identical to none at all
  assert.deepEqual(december({ weekdayWeeks: [] }).assignments, a.assignments)
})

// ---------------------------------------------------------------------------
// schedule.md §5 — scarcity order: weekend, Friday, Monday, then the rest
// ---------------------------------------------------------------------------

const vessel = (overrides = {}) => planGlobal({
  crew: ['greta', 'elisa', 'silvio', 'sienna', 'jessica', 'alexander'].map(id => crew(id)),
  lanes: [lane('bridge')],
  startDate: '2026-12-01', endDate: '2026-12-31',
  settings: { ...settings, horizon_weeks: 5, weekend_structure: 'sat_sun_block' },
  base: {},
  ...overrides,
})

Deno.test('scarcity order: Fridays spread instead of falling to whoever is left', () => {
  // Filling Mon->Fri in date order let rule 1c exclude the whole pool before
  // Friday was reached, so W_FRIDAY_SELECT had nothing to choose between and
  // one person drew every Friday. Deciding Friday from the full pool fixes it.
  const fridays = vessel().assignments.filter(a => isoWeekday(a.watch_date) === 5)
  assert.equal(fridays.length, 4)
  assert.equal(new Set(fridays.map(a => a.crew_id)).size, 4, 'four Fridays, four different people')
  // ...and rule 1c still holds at the same time
  assert.deepEqual(repeatWeeks(vessel()), [])
})

Deno.test('scarcity order: both neighbour rules survive being evaluated from the other side', () => {
  const p = vessel()
  const on = new Map(p.assignments.map(a => [a.watch_date, a.crew_id]))
  for (const [date, id] of on) {
    const wd = isoWeekday(date)
    // rule 1b: nobody stands a Friday into their own weekend
    if (wd === 5) {
      assert.notEqual(on.get(addDays(date, 1)), id, date + ': Friday into Saturday')
      assert.notEqual(on.get(addDays(date, 2)), id, date + ': Friday into Sunday')
    }
    // rule 2: nobody stands the Monday after their own weekend
    if (wd === 1) {
      assert.notEqual(on.get(addDays(date, -1)), id, date + ': Monday after Sunday')
      assert.notEqual(on.get(addDays(date, -2)), id, date + ': Monday after Saturday')
    }
  }
  assert.equal(p.events.filter(e => e.reason_code.startsWith('constraint_relaxed')).length, 0)
})

Deno.test('scarcity order: days are decided out of order but returned in date order', () => {
  const p = vessel()
  const dates = p.assignments.map(a => a.watch_date)
  assert.deepEqual(dates, [...dates].sort(), 'assignments must read as a rota')
  const ev = p.events.map(e => e.watch_date)
  assert.deepEqual(ev, [...ev].sort())
})

Deno.test('scarcity order: the published ledger is built chronologically', () => {
  // Selection runs weekend-first, so an incrementally-updated ledger would end
  // the run with last_watch_date pointing at whichever midweek day was decided
  // last. It is inherited as the next generation's base, so it has to be right.
  const p = vessel()
  for (const [id, e] of Object.entries(p.ledger)) {
    const own = p.assignments.filter(a => a.crew_id === id).map(a => a.watch_date)
    if (!own.length) continue
    assert.equal(e.last_watch_date, own[own.length - 1], id + ' last_watch_date')
    const weekends = own.filter(d => isoWeekday(d) >= 6)
    if (weekends.length) assert.equal(e.last_weekend_date, weekends[weekends.length - 1], id + ' last_weekend_date')
  }
})

Deno.test('scarcity order never disturbs determinism', () => {
  assert.deepEqual(vessel().assignments, vessel().assignments)
  assert.deepEqual(vessel().events, vessel().events)
  assert.deepEqual(vessel().ledger, vessel().ledger)
})

// ---------------------------------------------------------------------------
// fairness.md Step B — Friday turn-taking is a COUNT, not a rate
// ---------------------------------------------------------------------------

Deno.test('Friday: whose turn it is outranks how big their denominator is', () => {
  // Reproduces 25 December on the reported vessel. Everyone is level on one
  // Friday, so the turn key ties and `cost` decides. Scoring the Friday as
  // friday_watches/weekday_opportunities handed it to Greta — 2.0/36 beat
  // Alexander's 2.0/18 — purely because she had served longest, while she was
  // already the MOST worked person aboard. Burden has to decide that tie.
  const person = (id: string, friday: number, weekday: number, opp: number) =>
    ({ ...zeroEntry(id), friday_watches: friday, weekday_watches: weekday, total_watches: weekday, weekday_opportunities: opp, weekend_opportunities: 0 })
  const base = {
    greta: person('greta', 1, 9, 36),      // most opportunities AND most burden
    elisa: person('elisa', 1, 9, 36),
    jessica: person('jessica', 1, 6, 35),
    silvio: person('silvio', 1, 6, 26),
    alexander: person('alexander', 1, 2, 18), // fewest opportunities, least burden
  }
  // A single Friday to award.
  const p = planGlobal({
    crew: Object.keys(base).map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-25', endDate: '2026-12-25',
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base,
  })
  const winner = p.assignments.find(a => a.watch_date === '2026-12-25')!.crew_id
  assert.equal(winner, 'alexander', 'with turns level, the least-burdened takes the Friday')
  assert.notEqual(winner, 'greta', 'never the biggest denominator')
})

Deno.test('Friday: nobody takes a second while anyone is a turn behind', () => {
  // greta has had none; everyone else has had two. The turn key must put her
  // first however much burden she is carrying elsewhere.
  const person = (id: string, friday: number, weekday: number) =>
    ({ ...zeroEntry(id), friday_watches: friday, weekday_watches: weekday, total_watches: weekday, weekday_opportunities: 30, weekend_opportunities: 0 })
  const base = {
    greta: person('greta', 0, 20),   // carrying the most, but a turn behind
    elisa: person('elisa', 2, 2),
    silvio: person('silvio', 2, 2),
  }
  const p = planGlobal({
    crew: ['greta', 'elisa', 'silvio'].map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-25', endDate: '2026-12-25',
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base,
  })
  assert.equal(p.assignments[0].crew_id, 'greta', 'the turn comes first')
})

Deno.test('Friday turn-taking changes nothing on other weekdays', () => {
  // fridayTurn is zero on every non-Friday, so Mon-Thu selection is untouched.
  const person = (id: string, friday: number, weekday: number) =>
    ({ ...zeroEntry(id), friday_watches: friday, weekday_watches: weekday, total_watches: weekday, weekday_opportunities: 30, weekend_opportunities: 0 })
  const base = { a: person('a', 0, 12), b: person('b', 5, 2) }
  const p = planGlobal({
    crew: ['a', 'b'].map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-23', endDate: '2026-12-23',   // a Wednesday
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base,
  })
  assert.equal(p.assignments[0].crew_id, 'b', 'b carries far less weekday burden; Fridays are irrelevant here')
})

Deno.test('Friday: standing one sends you to the back of the queue', () => {
  // Reported from production: Silvio on 18 AND 25 December. By the 25th every
  // crew member was level on one cumulative Friday — three earned in December,
  // three carried from November — so the turn count tied and `cost` decided.
  // Silvio's smaller opportunity count made him marginally cheapest, one week
  // after his last Friday. Counting turns is not a rota on its own.
  // Silvio is genuinely the least-worked aboard — 8 watches against 11-13 —
  // so the burden rate rightly favours him. That is exactly the trap: being
  // owed a watch is not the same as being owed THIS Friday, a week after the
  // last one.
  const person = (id: string, weekday: number, opp: number) =>
    ({ ...zeroEntry(id), friday_watches: 1, weekday_watches: weekday, total_watches: weekday, weekday_opportunities: opp, weekend_opportunities: 0 })
  const base = {
    silvio: person('silvio', 4, 24),     // cheapest by cost — and stood last Friday
    greta: person('greta', 9, 31),
    jessica: person('jessica', 8, 30),
  }
  const run = (lastFriday?: Record<string, string>) => planGlobal({
    crew: ['silvio', 'greta', 'jessica'].map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-25', endDate: '2026-12-25',
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base, lastFriday,
  }).assignments[0].crew_id

  assert.equal(run(), 'silvio', 'without a queue, cost alone hands it back to Silvio')
  assert.notEqual(run({ silvio: '2026-12-18', greta: '2026-11-06', jessica: '2026-11-13' }), 'silvio',
    'with a queue, the man who just stood one goes last')
  assert.equal(run({ silvio: '2026-12-18', greta: '2026-11-06', jessica: '2026-11-13' }), 'greta',
    'and it goes to whoever stood one longest ago')
})

Deno.test('Friday: never having stood one beats any date', () => {
  const person = (id: string, friday: number) =>
    ({ ...zeroEntry(id), friday_watches: friday, weekday_watches: 6, total_watches: 6, weekday_opportunities: 30, weekend_opportunities: 0 })
  // Equal turns at zero: the one with no recorded Friday at all sorts first.
  const base = { a: person('a', 0), b: person('b', 0) }
  const p = planGlobal({
    crew: ['a', 'b'].map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-25', endDate: '2026-12-25',
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base,
    lastFriday: { a: '2026-11-20' },   // b has never stood one
  })
  assert.equal(p.assignments[0].crew_id, 'b')
})

Deno.test('Friday: the queue never overrides whose turn it is', () => {
  // greta is a turn behind but stood hers only last week; the COUNT still wins.
  const person = (id: string, friday: number) =>
    ({ ...zeroEntry(id), friday_watches: friday, weekday_watches: 6, total_watches: 6, weekday_opportunities: 30, weekend_opportunities: 0 })
  const base = { greta: person('greta', 0), elisa: person('elisa', 2) }
  const p = planGlobal({
    crew: ['greta', 'elisa'].map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-25', endDate: '2026-12-25',
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base,
    lastFriday: { greta: '2026-12-18', elisa: '2026-01-02' },
  })
  assert.equal(p.assignments[0].crew_id, 'greta', 'turn count outranks the queue')
})

Deno.test('Friday queue changes nothing on other weekdays, and keeps determinism', () => {
  const person = (id: string, friday: number, weekday: number) =>
    ({ ...zeroEntry(id), friday_watches: friday, weekday_watches: weekday, total_watches: weekday, weekday_opportunities: 30, weekend_opportunities: 0 })
  const base = { a: person('a', 0, 12), b: person('b', 5, 2) }
  const opts = { crew: ['a', 'b'].map(id => crew(id)), lanes: [lane('bridge')],
    startDate: '2026-12-23', endDate: '2026-12-23',
    settings: { ...settings, horizon_weeks: 1, include_weekends: false }, base,
    lastFriday: { a: '2026-12-18', b: '2026-01-02' } }
  const p = planGlobal(opts)
  assert.equal(p.assignments[0].crew_id, 'b', 'a Wednesday ignores the Friday queue entirely')
  assert.deepEqual(planGlobal(opts).assignments, p.assignments)
})

// ---------------------------------------------------------------------------
// fairness.md §8 rule 2d (28 November 2026): when a rule has to bend, bend it
// away from the days either side. Tester feedback: "crew doing 2 watches in a
// row (apart from the weekends)".
// ---------------------------------------------------------------------------
// Sat->Sun is never a back-to-back (the weekend is its own rotation, or one
// block); Fri->Sat is one block under fri_sat_sun_block.
const NEIGHBOUR_BLOCK = (structure: string, d: string) =>
  isoWeekday(d) === 6 || (structure === 'fri_sat_sun_block' && isoWeekday(d) === 5)
const backToBack = (p: ReturnType<typeof planGlobal>, structure: string) => {
  const on = new Set(p.assignments.map(a => a.crew_id + ':' + a.watch_date))
  return p.assignments.filter(a => on.has(a.crew_id + ':' + addDays(a.watch_date, 1)) && !NEIGHBOUR_BLOCK(structure, a.watch_date))
}

Deno.test('rule 2d: the production week — a forced weekday repeat no longer lands on consecutive days', () => {
  // Rebuilt from the tester's vessel (Solo, Fri-Sun block, six crew, December
  // 2026). p1..p6 sort as the real crew ids do, so tie-breaks match. Leave cut
  // the pool to four for 21-27 Dec: the Fri-Sun block takes one, the Monday
  // rule another for Monday, so one weekday repeat is forced. The engine put it
  // on Wed 23 AND Thu 24 for the same person, as production showed.
  const people = [['p1','deck'],['p2','interior'],['p3','engineering'],['p4','interior'],['p5','officer'],['p6','officer']]
    .map(([id, department]) => crew(id, department, { available_from: '2026-11-27' }))
  const leave = [
    { crew_id: 'p4', start: '2026-11-26', end: '2026-12-07' }, { crew_id: 'p2', start: '2026-12-09', end: '2027-02-09' },
    { crew_id: 'p4', start: '2026-12-29', end: '2027-01-04' }, { crew_id: 'p1', start: '2026-11-30', end: '2026-12-27' }]
  const input = { crew: people, lanes: [lane('L', ['engineering', 'deck', 'officer', 'interior'])], startDate: '2026-12-01', endDate: '2026-12-31',
    settings: { ...settings, weekend_structure: 'fri_sat_sun_block' as const }, base: {}, leave }
  const p = planGlobal(input)
  assert.equal(p.gaps.length, 0)
  assert.deepEqual(backToBack(p, 'fri_sat_sun_block'), [])
  const week = p.assignments.filter(a => a.watch_date >= '2026-12-21' && a.watch_date <= '2026-12-24')
  assert.notEqual(week[2].crew_id, week[3].crew_id) // Wed 23 / Thu 24
  // The repeat is still recorded as the week rule bending, never hidden.
  assert.ok(p.events.some(e => e.watch_date >= '2026-12-21' && e.watch_date <= '2026-12-24' && e.reason_code === 'constraint_relaxed_week_exclusion'))
  assert.deepEqual(planGlobal(input), p)
  assert.deepEqual(planGlobal({ ...input, crew: [...people].reverse() }), p)
})

Deno.test('rule 2d: no weekday back-to-back while a non-adjacent option exists, every structure, 4-7 crew', () => {
  for (const weekend_structure of ['per_day', 'sat_sun_block', 'fri_sat_sun_block'] as const) for (const n of [4, 5, 6, 7]) {
    const people = Array.from({ length: n }, (_, i) => crew('c' + i))
    const p = run(people, [lane('1')], { startDate: '2026-11-30', settings: { ...settings, horizon_weeks: 8, weekend_structure } })
    assert.deepEqual(backToBack(p, weekend_structure).map(a => a.watch_date), [], `${weekend_structure} with ${n} crew`)
  }
})

Deno.test('rule 2d: a clean candidate is never marked back-to-back, so normal weeks are untouched', () => {
  for (const weekend_structure of ['per_day', 'sat_sun_block', 'fri_sat_sun_block'] as const) {
    const p = run(['a','b','c','d','e','f'].map(id => crew(id)), [lane('1')], { settings: { ...settings, horizon_weeks: 8, weekend_structure } })
    for (const e of p.events) for (const c of (e.detail as { candidates: { back_to_back: boolean; monday_relaxed: boolean; friday_relaxed: boolean; week_relaxed: boolean }[] }).candidates) {
      if (c.back_to_back) assert.ok(c.monday_relaxed || c.friday_relaxed || c.week_relaxed)
    }
  }
})

Deno.test('rule 2d: coverage still wins — a one-person pool stands consecutive days, flagged', () => {
  const p = run([crew('a'), crew('b')], [lane('1')], { leave: [{ crew_id: 'b', start: '2026-09-21', end: '2026-09-27' }] })
  const week = p.assignments.filter(a => a.watch_date <= '2026-09-27')
  assert.equal(week.length, 7)
  assert.ok(week.every(a => a.crew_id === 'a'))
  const flagged = p.events.filter(e => e.watch_date <= '2026-09-27' && (e.detail as { back_to_back: boolean }).back_to_back)
  assert.ok(flagged.length > 0)
})

Deno.test('rule 2d: facts beyond the window count — the day before (ledger + stored week) and the retained tail after', () => {
  const people = [crew('c0'), crew('c1'), crew('c2')]
  const per_day = { ...settings, horizon_weeks: 2, weekend_structure: 'per_day' as const }
  const withFact = (p: ReturnType<typeof planGlobal>, fact: PlannedAssignment) => backToBack({ ...p, assignments: [...p.assignments, fact] }, 'per_day')
  // Before: the window opens on Friday 25 Sep; c0 stood Thursday 24 (the
  // incoming ledger, and the week as generate-schedule reads it from stored
  // assignments). Ignoring that fact put c0 on the Friday.
  const thu: PlannedAssignment = { lane_id: '1', crew_id: 'c0', watch_date: '2026-09-24', day_type: 'weekday', is_friday: false }
  const before = run(people, [lane('1')], { settings: per_day, startDate: '2026-09-25', endDate: '2026-10-04',
    base: { c0: { ...zeroEntry('c0'), last_watch_date: '2026-09-24', total_watches: 1, weekday_watches: 1 } },
    weekdayWeeks: ['c0:2026-09-21'] })
  assert.deepEqual(withFact(before, thu), [])
  // After: c1 already holds Friday 2 Oct in an older, retained generation, so
  // Thursday 1 Oct — the window's last day — is not theirs.
  const fri: PlannedAssignment = { lane_id: '1', crew_id: 'c1', watch_date: '2026-10-02', day_type: 'weekday', is_friday: true }
  const after = run(people, [lane('1')], { settings: per_day, startDate: '2026-09-22', endDate: '2026-10-01',
    retained: { assignments: [fri], opportunities: [] } })
  assert.deepEqual(withFact(after, fri), [])
})

// ---------------------------------------------------------------------------
// fairness.md §7 (28 November 2026): the captain's "who goes first" order —
// settings.rota_priority. Tester feedback: "choose who to favour".
// ---------------------------------------------------------------------------
const six = ['a', 'b', 'c', 'd', 'e', 'f']
const month = (rota_priority: string[] | null | undefined, weekend_structure: ScheduleSettings['weekend_structure'] = 'per_day', base = {}, startDate = '2026-12-01', endDate = '2026-12-31') =>
  planGlobal({ crew: six.map(id => crew(id)), lanes: [lane('1')], startDate, endDate, base, settings: { ...settings, weekend_structure, rota_priority } })

Deno.test('priority: no order set is byte-identical to before (null, undefined and empty)', () => {
  const legacy = month(undefined)
  assert.deepEqual(month(null), legacy)
  assert.deepEqual(month([]), legacy)
})

Deno.test('priority: the first-listed carries the month\'s extra watch, weekend and a Friday', () => {
  for (const first of ['f', 'c']) {
    const order = [first, ...six.filter(id => id !== first)]
    const p = month(order)
    const totals = six.map(id => p.ledger[id].total_watches)
    assert.equal(p.ledger[first].total_watches, Math.max(...totals), `${first} totals ${totals}`)
    assert.equal(p.ledger[first].weekend_watches, Math.max(...six.map(id => p.ledger[id].weekend_watches)))
    assert.ok(p.ledger[first].friday_watches >= 1)
    // ...and the last-listed the least. Within one month the order can tilt a
    // watch from the bottom of the list to the top, so the gap may be two
    // where the unordered engine manages one; it is never wider than that
    // here, and the six-month test below holds it to the unordered bound.
    assert.equal(p.ledger[order[order.length - 1]].total_watches, Math.min(...totals))
    assert.ok(Math.max(...totals) - Math.min(...totals) <= 2)
  }
})

Deno.test('priority: never outranks fairness — someone already ahead is not handed more', () => {
  // 'f' is listed first but arrives already carrying ten weekday watches.
  const base = Object.fromEntries(six.map(id => [id, { ...zeroEntry(id), weekday_opportunities: 20, weekend_opportunities: 8 }]))
  base.f = { ...base.f, total_watches: 10, weekday_watches: 10 }
  const p = month(['f', 'a', 'b', 'c', 'd', 'e'], 'per_day', base)
  const weekdaysFor = (id: string) => p.assignments.filter(x => x.crew_id === id && x.day_type === 'weekday').length
  assert.ok(six.filter(id => id !== 'f').every(id => weekdaysFor(id) >= weekdaysFor('f')))
})

Deno.test('priority: bounded — six months running never widen the spread beyond the unordered engine', () => {
  for (const ws of ['per_day', 'sat_sun_block', 'fri_sat_sun_block'] as const) {
    const spreadOver = (order: string[] | null) => {
      let base = {}, worst = 0
      for (let m = 0; m < 6; m++) {
        const start = addDays('2027-01-04', m * 28)
        const p = month(order, ws, base, start, addDays(start, 27))
        base = p.ledger
        const t = six.map(id => p.ledger[id].total_watches)
        worst = Math.max(worst, Math.max(...t) - Math.min(...t))
      }
      return worst
    }
    assert.ok(spreadOver(['e', 'a', 'f', 'b', 'd', 'c']) <= spreadOver(null), ws)
  }
})

Deno.test('priority: unknown and duplicate ids are ignored, unlisted crew follow, input order does not matter', () => {
  const listed = month(['c', 'a'])
  assert.deepEqual(month(['ghost', 'c', 'c', 'a', 'ghost']), listed)
  // c and a lead; the unlisted follow in id order — the same as listing them.
  assert.deepEqual(month(['c', 'a', 'b', 'd', 'e', 'f']), listed)
  const reversed = planGlobal({ crew: [...six].reverse().map(id => crew(id)), lanes: [lane('1')], startDate: '2026-12-01', endDate: '2026-12-31', base: {}, settings: { ...settings, rota_priority: ['c', 'a'] } })
  assert.deepEqual(reversed, listed)
})

Deno.test('priority: when an order is set the legacy rotation anchors no longer apply', () => {
  const withAnchors = planGlobal({ crew: six.map(id => crew(id)), lanes: [lane('1')], startDate: '2026-12-01', endDate: '2026-12-31', base: {},
    settings: { ...settings, weekday_rotation_anchor: 3, weekend_rotation_anchor: 2, rota_priority: ['d', 'b'] } })
  assert.deepEqual(withAnchors, month(['d', 'b']))
  // ...and still do while it is empty.
  const anchoredOnly = planGlobal({ crew: six.map(id => crew(id)), lanes: [lane('1')], startDate: '2026-12-01', endDate: '2026-12-31', base: {},
    settings: { ...settings, weekday_rotation_anchor: 3, weekend_rotation_anchor: 2 } })
  assert.notDeepEqual(anchoredOnly, month(null))
})
