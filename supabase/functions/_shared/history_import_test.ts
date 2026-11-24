import { strict as assert } from 'node:assert'
import { contiguousRuns, matchCrewName, parseHistoryCsv, resolveHistory, splitCsvLine, toIsoDate } from './history_import.ts'

const CREW = [
  { id: 'a', full_name: 'Greta Pearson' },
  { id: 'b', full_name: 'Elisa Moreau' },
  { id: 'c', full_name: 'Greta Nilsson' },
]

Deno.test('a CSV line honours quotes, embedded commas and escaped quotes', () => {
  assert.deepEqual(splitCsvLine('2026-11-05,Greta Pearson'), ['2026-11-05', 'Greta Pearson'])
  assert.deepEqual(splitCsvLine('2026-11-05,"Pearson, Greta",Lane 1'), ['2026-11-05', 'Pearson, Greta', 'Lane 1'])
  assert.deepEqual(splitCsvLine('a,"say ""hi""辞"'), ['a', 'say "hi"辞'])
  assert.deepEqual(splitCsvLine('a,,c'), ['a', '', 'c'])
})

Deno.test('dates are read day-first, and nonsense is refused rather than guessed', () => {
  assert.equal(toIsoDate('2026-11-05'), '2026-11-05')
  assert.equal(toIsoDate('05/11/2026'), '2026-11-05')
  assert.equal(toIsoDate('5-11-2026'), '2026-11-05')
  assert.equal(toIsoDate('2026-02-30'), null)
  assert.equal(toIsoDate('next tuesday'), null)
  assert.equal(toIsoDate(''), null)
})

Deno.test('a CSV parses with flexible headers, a BOM and CRLF', () => {
  const csv = '﻿Watch Date,Crew Name,Lane\r\n2026-11-05,Greta Pearson,Lane 1\r\n\r\n2026-11-06,Elisa Moreau,\r\n'
  const p = parseHistoryCsv(csv)
  assert.deepEqual(p.errors, [])
  assert.deepEqual(p.rows, [
    { date: '2026-11-05', crew: 'Greta Pearson', lane: 'Lane 1' },
    { date: '2026-11-06', crew: 'Elisa Moreau' },
  ])
})

Deno.test('a bad line is reported by number and the rest still imports', () => {
  const p = parseHistoryCsv('date,crew\n2026-11-05,Greta Pearson\nnot-a-date,Elisa Moreau\n2026-11-07,\n2026-11-08,Elisa Moreau')
  assert.equal(p.rows.length, 2)
  assert.equal(p.errors.length, 2)
  assert.ok(p.errors[0].includes('Line 3'))
  assert.ok(p.errors[1].includes('Line 4'))
})

Deno.test('a file without the required columns is refused outright', () => {
  assert.ok(parseHistoryCsv('foo,bar\n1,2').errors[0].includes('date'))
  assert.ok(parseHistoryCsv('').errors[0].includes('empty'))
})

Deno.test('a name matches one crew member or nobody — never a guess', () => {
  assert.equal(matchCrewName('Greta Pearson', CREW), 'a')
  assert.equal(matchCrewName('  elisa   MOREAU ', CREW), 'b')
  assert.equal(matchCrewName('Elisa', CREW), 'b')
  // two Gretas: ambiguous, so no match rather than the wrong watch
  assert.equal(matchCrewName('Greta', CREW), null)
  assert.equal(matchCrewName('Nobody Here', CREW), null)
  assert.equal(matchCrewName('', CREW), null)
})

Deno.test('resolution dedupes a crew-day, reports misses, and refuses the future', () => {
  const rows = [
    { date: '2026-11-05', crew: 'Greta Pearson' },
    { date: '2026-11-05', crew: 'Greta Pearson' },
    { date: '2026-11-06', crew: 'Who Dis' },
    { date: '2026-12-25', crew: 'Elisa Moreau' },
  ]
  const r = resolveHistory(rows, CREW, '2026-11-24')
  assert.deepEqual(r.records, [{ crew_id: 'a', watch_date: '2026-11-05' }])
  assert.deepEqual(r.unmatched, ['Who Dis'])
  assert.equal(r.rejected.length, 1)
  assert.ok(r.rejected[0].includes('not a past date'))
})

Deno.test('a later row wins the same crew-day, so a corrected re-upload sticks', () => {
  const r = resolveHistory([
    { date: '2026-11-05', crew: 'Greta Pearson', lane: 'Lane 1' },
    { date: '2026-11-05', crew: 'Greta Pearson', lane: 'Lane 2' },
  ], CREW, '2026-11-24')
  assert.equal(r.records.length, 1)
  assert.equal(r.records[0].lane, 'Lane 2')
})

Deno.test('records sort by date then crew, so an import is deterministic', () => {
  const r = resolveHistory([
    { date: '2026-11-06', crew: 'Elisa Moreau' },
    { date: '2026-11-05', crew: 'Elisa Moreau' },
    { date: '2026-11-05', crew: 'Greta Pearson' },
  ], CREW, '2026-11-24')
  assert.deepEqual(r.records.map(x => x.watch_date + ':' + x.crew_id), ['2026-11-05:a', '2026-11-05:b', '2026-11-06:b'])
})

Deno.test('contiguous runs stay tight, so an import never blankets the gaps between records', () => {
  assert.deepEqual(contiguousRuns([]), [])
  assert.deepEqual(contiguousRuns(['2026-11-05']).map(r => r.start + '..' + r.end), ['2026-11-05..2026-11-05'])
  assert.deepEqual(
    contiguousRuns(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-20', '2026-11-21']).map(r => r.start + '..' + r.end),
    ['2026-11-05..2026-11-07', '2026-11-20..2026-11-21'],
  )
  // duplicates collapse, order does not matter, and a month boundary is contiguous
  assert.deepEqual(
    contiguousRuns(['2026-12-01', '2026-11-30', '2026-11-30']).map(r => r.start + '..' + r.end),
    ['2026-11-30..2026-12-01'],
  )
})
