import { describe, expect, it } from 'vitest'
import { effectiveWindow, monthWindow, windowProblem, type GenerationWindow } from './GenerationWindowPicker'

const w = (p: Partial<GenerationWindow>): GenerationWindow =>
  ({ mode: 'weeks', horizon_weeks: 4, start: '', end: '', ...p })
const TODAY = '2026-11-24'

describe('monthWindow', () => {
  it('spans the first to the last day', () => {
    expect(monthWindow('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(monthWindow('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })
})

describe('effectiveWindow', () => {
  it('weeks runs from today, inclusive of the final day', () => {
    expect(effectiveWindow(w({ mode: 'weeks', horizon_weeks: 1 }), TODAY)).toEqual({ start: TODAY, end: '2026-11-30' })
  })

  it('clamps the cap at 13 weeks and the floor at 1', () => {
    expect(effectiveWindow(w({ horizon_weeks: 99 }), TODAY).end).toEqual(effectiveWindow(w({ horizon_weeks: 13 }), TODAY).end)
    expect(effectiveWindow(w({ horizon_weeks: 0 }), TODAY).end).toEqual(effectiveWindow(w({ horizon_weeks: 1 }), TODAY).end)
  })

  // Watches already stood are never rewritten, so a begun window starts today.
  it('a window that has already begun starts today', () => {
    expect(effectiveWindow(w({ mode: 'month', start: '2026-11-01', end: '2026-11-30' }), TODAY))
      .toEqual({ start: TODAY, end: '2026-11-30' })
  })

  it('a future window is taken as given', () => {
    expect(effectiveWindow(w({ mode: 'month', start: '2026-12-01', end: '2026-12-31' }), TODAY))
      .toEqual({ start: '2026-12-01', end: '2026-12-31' })
  })
})

describe('windowProblem', () => {
  it('accepts a sound window', () => {
    expect(windowProblem(w({ horizon_weeks: 4 }), TODAY)).toBeNull()
    expect(windowProblem(w({ mode: 'range', start: '2026-12-01', end: '2026-12-31' }), TODAY)).toBeNull()
  })

  it('bounds the week count to the engine cap', () => {
    expect(windowProblem(w({ horizon_weeks: 0 }), TODAY)).toMatch(/1 and 13/)
    expect(windowProblem(w({ horizon_weeks: 14 }), TODAY)).toMatch(/1 and 13/)
  })

  it('refuses an incomplete, backwards, passed or oversized window', () => {
    expect(windowProblem(w({ mode: 'range', start: '2026-12-01', end: '' }), TODAY)).toMatch(/start and end/)
    expect(windowProblem(w({ mode: 'range', start: '2026-12-05', end: '2026-12-01' }), TODAY)).toMatch(/ends before/)
    expect(windowProblem(w({ mode: 'range', start: '2026-09-01', end: '2026-09-30' }), TODAY)).toMatch(/already passed/)
    // 92 days inclusive — one over the cap.
    expect(windowProblem(w({ mode: 'range', start: '2026-12-01', end: '2027-03-02' }), TODAY)).toMatch(/91 days/)
  })

  it('accepts exactly 91 days', () => {
    expect(windowProblem(w({ mode: 'range', start: '2026-12-01', end: '2027-03-01' }), TODAY)).toBeNull()
  })

  // A window that started before today but has not finished is still usable:
  // it clamps rather than being refused.
  it('accepts a window that began but has not ended', () => {
    expect(windowProblem(w({ mode: 'month', start: '2026-11-01', end: '2026-11-30' }), TODAY)).toBeNull()
  })
})
