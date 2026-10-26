import { strict as assert } from 'node:assert'
import { recommendHorizon } from './horizon_recommender.ts'

const settings = { horizon_weeks: 4, include_weekends: true, weekday_rotation_anchor: 0, weekend_rotation_anchor: 0, weekend_structure: 'per_day' as const }
const run = (n: number, weekend_structure: 'per_day' | 'sat_sun_block' | 'fri_sat_sun_block' = settings.weekend_structure) => recommendHorizon({
  startDate: '2026-09-21', settings: { ...settings, weekend_structure },
  lanes: [{ id: 'deck', label: 'Deck', departments: ['deck'], position: 1 }], base: {},
  crew: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, department: 'deck', eligible: true, available_from: '2020-01-01' })),
})

Deno.test('13 crew recommends the 13-week complete rotation', () => {
  const result = run(13)
  assert.equal(result.suggested_weeks, 13)
  assert.equal(result.confidence, 'high')
  assert.equal(result.candidates.length, 13)
})

Deno.test('small crew can use a shorter complete horizon', () => {
  const result = run(3)
  assert.ok(result.suggested_weeks >= 3 && result.suggested_weeks <= 13)
  assert.ok(result.candidates.find(c => c.weeks === result.suggested_weeks)?.cycle_complete)
})

Deno.test('block weekend settings are included in the comparison', () => {
  const daily = run(7, 'per_day')
  const block = run(7, 'fri_sat_sun_block')
  assert.notDeepEqual(daily.candidates.map(c => c.min_score), block.candidates.map(c => c.min_score))
})
