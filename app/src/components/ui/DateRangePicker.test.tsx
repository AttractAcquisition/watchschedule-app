import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateRangePicker, formatRange, type DateRange } from './DateRangePicker'

function Harness({ initial = {}, marked }: { initial?: Partial<DateRange>; marked?: DateRange[] }) {
  const [value, setValue] = useState<Partial<DateRange>>(initial)
  return (
    <>
      <DateRangePicker label="Leave dates" value={value} onChange={setValue} marked={marked} />
      <output data-testid="value">{`${value.start ?? ''}|${value.end ?? ''}`}</output>
    </>
  )
}

const day = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) })

describe('DateRangePicker', () => {
  it('picks a start and an end in two clicks and closes', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ start: '2026-12-01' }} />)
    // Reopen at the start month; the start is set, so the next click is the end.
    await user.click(screen.getByRole('button', { name: /Leave dates/ }))
    await user.click(day('Monday 7 December 2026'))
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-01|2026-12-07')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Leave dates/ })).toHaveTextContent('1 Dec – 7 Dec 2026 · 7 days')
  })

  it('starts over when the second click is before the start', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ start: '2026-12-10' }} />)
    await user.click(screen.getByRole('button', { name: /Leave dates/ }))
    await user.click(day('Thursday 3 December 2026'))
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-03|')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(day('Saturday 5 December 2026'))
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-03|2026-12-05')
  })

  it('a complete range is replaced from the next click', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ start: '2026-12-01', end: '2026-12-04' }} />)
    await user.click(screen.getByRole('button', { name: /Leave dates/ }))
    await user.click(day('Tuesday 15 December 2026'))
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-15|')
  })

  it('allows a single-day range and marks existing leave', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ start: '2026-12-29' }} marked={[{ start: '2026-12-29', end: '2027-01-04' }]} />)
    await user.click(screen.getByRole('button', { name: /Leave dates/ }))
    expect(day('Wednesday 30 December 2026')).toHaveAccessibleName(/already on leave/)
    expect(day('Monday 28 December 2026')).not.toHaveAccessibleName(/already on leave/)
    await user.click(day('Tuesday 29 December 2026'))
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-29|2026-12-29')
  })

  it('formats ranges across years and single days', () => {
    expect(formatRange('2026-12-29', '2027-01-04')).toBe('29 Dec 2026 – 4 Jan 2027 · 7 days')
    expect(formatRange('2026-12-25', '2026-12-25')).toBe('25 Dec 2026 · 1 day')
  })
})
