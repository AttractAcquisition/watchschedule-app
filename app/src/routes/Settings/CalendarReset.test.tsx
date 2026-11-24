import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CalendarReset } from './CalendarReset'

const invoke = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))
vi.mock('../../auth/AuthGate', () => ({ useAuth: () => ({ profile: { vessel_id: 'v1' } }) }))

const renderIt = (cleared: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><CalendarReset cleared={cleared} /></QueryClientProvider>)
}

describe('CalendarReset', () => {
  beforeEach(() => invoke.mockReset())

  it('makes clear a two-step action, and says nothing is deleted', async () => {
    invoke.mockResolvedValue({ data: { applied: true }, error: null })
    renderIt(false)
    await userEvent.click(screen.getByRole('button', { name: /clear all watches/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Nothing is deleted/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Restore cleared watches/i)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: /clear all watches/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('restore-rota', { body: { action: 'clear_calendar' } }))
  })

  it('cancelling the confirm changes nothing', async () => {
    renderIt(false)
    await userEvent.click(screen.getByRole('button', { name: /clear all watches/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('offers restore once cleared, with no confirm step', async () => {
    invoke.mockResolvedValue({ data: { applied: true }, error: null })
    renderIt(true)
    expect(screen.queryByRole('button', { name: /clear all watches/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /restore cleared watches/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('restore-rota', { body: { action: 'restore_calendar' } }))
    expect(await screen.findByRole('status')).toHaveTextContent(/restored/i)
  })

  it('surfaces a server refusal rather than claiming success', async () => {
    invoke.mockResolvedValue({ data: { error: 'The rota changed while you were working. Please try again.' }, error: null })
    renderIt(true)
    await userEvent.click(screen.getByRole('button', { name: /restore cleared watches/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/rota changed/i)
  })
})
