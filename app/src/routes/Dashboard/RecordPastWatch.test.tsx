import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecordPastWatch } from './RecordPastWatch'
import type { DashboardData } from './useDashboardData'

const invoke = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

const crew = [
  { id: 'c1', full_name: 'Greta Pearson', position: 'Deckhand', department: 'deck', eligible: true, updated_at: '' },
  { id: 'c2', full_name: 'Silvio Latkovic', position: '2nd Engineer', department: 'engineering', eligible: false, updated_at: '' },
]
const data = { crew, crewById: new Map(crew.map((c) => [c.id, c])) } as unknown as DashboardData

const renderIt = (onRecorded = vi.fn(), onClose = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecordPastWatch
        data={data}
        target={{ laneId: 'l1', laneLabel: 'Lane 1', date: '2026-10-05' }}
        vesselId="v1" onClose={onClose} onRecorded={onRecorded}
      />
    </QueryClientProvider>,
  )
  return { onRecorded, onClose }
}

describe('RecordPastWatch', () => {
  beforeEach(() => invoke.mockReset())

  it('names the day and lists departed crew too', () => {
    renderIt()
    expect(screen.getByText(/Mon 5 Oct 2026/)).toBeInTheDocument()
    const select = screen.getByLabelText(/who stood it/i)
    expect(select).toHaveTextContent('Greta Pearson')
    expect(select).toHaveTextContent('Silvio Latkovic (no longer on watch)')
  })

  it('will not record until someone is chosen', async () => {
    renderIt()
    expect(screen.getByRole('button', { name: /record watch/i })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText(/who stood it/i), 'c1')
    expect(screen.getByRole('button', { name: /record watch/i })).toBeEnabled()
  })

  it('records through the import path, not the override', async () => {
    invoke.mockResolvedValue({ data: { applied: true, imported: 1 }, error: null })
    const { onRecorded, onClose } = renderIt()
    await userEvent.selectOptions(screen.getByLabelText(/who stood it/i), 'c2')
    await userEvent.click(screen.getByRole('button', { name: /record watch/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('import-watch-history', {
      body: { records: [{ crew_id: 'c2', watch_date: '2026-10-05' }] },
    }))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('treats "nothing imported" as a failure rather than success', async () => {
    invoke.mockResolvedValue({ data: { applied: true, imported: 0 }, error: null })
    const { onRecorded, onClose } = renderIt()
    await userEvent.selectOptions(screen.getByLabelText(/who stood it/i), 'c1')
    await userEvent.click(screen.getByRole('button', { name: /record watch/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onRecorded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a server refusal', async () => {
    invoke.mockResolvedValue({ data: { error: 'Set up your watch lanes before importing past watches.' }, error: null })
    renderIt()
    await userEvent.selectOptions(screen.getByLabelText(/who stood it/i), 'c1')
    await userEvent.click(screen.getByRole('button', { name: /record watch/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/watch lanes/i)
  })
})
