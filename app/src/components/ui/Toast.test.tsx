import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Toast, TOAST_DURATION_MS } from './Toast'

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('announces the message politely without stealing focus', () => {
    render(<Toast message="Fairness score has been updated" onDismiss={() => {}} />)
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Fairness score has been updated')
    expect(toast).toHaveAttribute('aria-live', 'polite')
    expect(toast).not.toHaveFocus()
  })

  it('dismisses itself after about three seconds', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Fairness score has been updated" onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 1) })
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('fades before it goes, rather than vanishing mid-read', () => {
    render(<Toast message="Fairness score has been updated" onDismiss={() => {}} />)
    expect(screen.getByRole('status').className).toContain('opacity-100')
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 300) })
    expect(screen.getByRole('status').className).toContain('opacity-0')
  })

  it('clears its timers on unmount, so a closed toast cannot fire late', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<Toast message="x" onDismiss={onDismiss} />)
    unmount()
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS * 2) })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
