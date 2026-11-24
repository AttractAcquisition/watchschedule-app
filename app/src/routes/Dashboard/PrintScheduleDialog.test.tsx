import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintScheduleDialog } from './PrintScheduleDialog'
import type { DashboardData } from './useDashboardData'

const data = (scheduledDates: string[], assignments: { watch_date: string }[] = []) =>
  ({ scheduledDates, assignments }) as unknown as DashboardData

describe('PrintScheduleDialog', () => {
  it('offers every month holding a rota, newest first', async () => {
    render(<PrintScheduleDialog data={data(['2026-09-10', '2026-11-05', '2026-12-02'])} onPrint={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /print or save as pdf/i }))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['December 2026', 'November 2026', 'September 2026'])
  })

  // The month being looked at, not merely the newest schedule.
  it('prints the chosen month, not the current schedule', async () => {
    const onPrint = vi.fn()
    render(<PrintScheduleDialog data={data(['2026-09-10', '2026-12-02'])} onPrint={onPrint} />)
    await userEvent.click(screen.getByRole('button', { name: /print or save as pdf/i }))
    await userEvent.selectOptions(screen.getByLabelText('Month'), '2026-09')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onPrint).toHaveBeenCalledWith({ start: '2026-09-01', end: '2026-09-30' })
  })

  it('says how many days it will print', async () => {
    render(<PrintScheduleDialog data={data(['2026-11-05', '2026-11-06'])} onPrint={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /print or save as pdf/i }))
    expect(screen.getByText(/2 days rostered/)).toBeInTheDocument()
  })

  it('is unavailable when nothing is rostered anywhere', () => {
    render(<PrintScheduleDialog data={data([])} onPrint={vi.fn()} />)
    expect(screen.getByRole('button', { name: /print or save as pdf/i })).toBeDisabled()
  })

  it('cancelling prints nothing', async () => {
    const onPrint = vi.fn()
    render(<PrintScheduleDialog data={data(['2026-11-05'])} onPrint={onPrint} />)
    await userEvent.click(screen.getByRole('button', { name: /print or save as pdf/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onPrint).not.toHaveBeenCalled()
  })

  it('warns that the browser dialog decides printer or PDF', async () => {
    render(<PrintScheduleDialog data={data(['2026-11-05'])} onPrint={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /print or save as pdf/i }))
    expect(screen.getByText(/browser opens its own print dialog/i)).toBeInTheDocument()
  })
})
