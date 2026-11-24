import { describe, expect, it } from 'vitest'
import { defaultPrintMonth, monthBounds, monthsWithRota, periodDates } from './printPeriod'

describe('monthBounds', () => {
  it('covers the whole month, leap years included', () => {
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' })
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
})

describe('periodDates', () => {
  const scheduled = ['2026-10-31', '2026-11-01', '2026-11-15', '2026-12-01']
  const assignments = [{ watch_date: '2026-11-15' }, { watch_date: '2026-11-20' }]

  it('keeps only the days inside the period', () => {
    const { start, end } = monthBounds('2026-11')
    expect(periodDates(scheduled, assignments, start, end)).toEqual(['2026-11-01', '2026-11-15', '2026-11-20'])
  })

  it('includes a day that carries a watch but was never in scheduled_dates', () => {
    const { start, end } = monthBounds('2026-11')
    // 20 Nov comes only from an assignment — an imported day on a legacy snapshot.
    expect(periodDates([], assignments, start, end)).toEqual(['2026-11-15', '2026-11-20'])
  })

  it('deduplicates and sorts', () => {
    const { start, end } = monthBounds('2026-11')
    expect(periodDates(['2026-11-15', '2026-11-15'], [{ watch_date: '2026-11-15' }], start, end)).toEqual(['2026-11-15'])
  })

  it('returns nothing for a month with no rota', () => {
    const { start, end } = monthBounds('2026-09')
    expect(periodDates(scheduled, assignments, start, end)).toEqual([])
  })
})

describe('monthsWithRota', () => {
  it('lists every month holding anything, newest first', () => {
    expect(monthsWithRota(['2026-09-01', '2026-11-30'], [{ watch_date: '2026-12-02' }]))
      .toEqual(['2026-12', '2026-11', '2026-09'])
  })

  it('is empty when there is no rota at all', () => {
    expect(monthsWithRota([], [])).toEqual([])
  })
})

describe('defaultPrintMonth', () => {
  it('offers the month being looked at when it holds a rota', () => {
    expect(defaultPrintMonth(['2026-12', '2026-11'], '2026-11-24')).toBe('2026-11')
  })

  it('falls back to the most recent month that holds one', () => {
    expect(defaultPrintMonth(['2026-09', '2026-08'], '2026-11-24')).toBe('2026-09')
  })

  it('falls back to the current month when nothing is rostered', () => {
    expect(defaultPrintMonth([], '2026-11-24')).toBe('2026-11')
  })
})
