import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportHistoryButton } from './ImportHistoryButton'
import type { DashboardData } from './useDashboardData'

const invoke = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

const crew = [
  { id: 'c1', full_name: 'Greta Pearson', position: 'Deckhand', department: 'deck', eligible: true, updated_at: '' },
  { id: 'c2', full_name: 'Elisa Moreau', position: 'Stew', department: 'interior', eligible: false, updated_at: '' },
]

const data = {
  schedule: { id: 's1', start_date: '2026-11-12', end_date: '2026-11-30', horizon_weeks: 3, generated_at: '' },
  assignments: [], scheduledDates: [], ledger: [], crew,
  lanes: [{ id: 'l1', kind: 'dept', department: null, label: 'Lane 1', active: true }],
  crewById: new Map(crew.map((c) => [c.id, c])), charters: [], leave: [],
  settingsUpdatedAt: null, plannedStart: null, hasPriorRota: false,
} as unknown as DashboardData

const renderIt = (onImported = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ImportHistoryButton data={data} vesselId="v1" onImported={onImported} />
    </QueryClientProvider>,
  )
  return onImported
}

describe('ImportHistoryButton', () => {
  beforeEach(() => invoke.mockReset())

  it('lists crew who are no longer on watch, so their history can still be credited', async () => {
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /upload past watches/i }))
    const select = screen.getByLabelText('Crew member for row 1')
    expect(select).toHaveTextContent('Greta Pearson')
    expect(select).toHaveTextContent('Elisa Moreau (no longer on watch)')
  })

  it('will not submit until a row has both a person and a date', async () => {
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /upload past watches/i }))
    const submit = screen.getByRole('button', { name: /^record/i })
    expect(submit).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Crew member for row 1'), 'c1')
    expect(submit).toBeDisabled()
  })

  it('sends only complete rows, and confirms what landed', async () => {
    invoke.mockResolvedValue({ data: { applied: true, imported: 1, crew: 1, from: '2026-11-03', to: '2026-11-03' }, error: null })
    const onImported = renderIt()
    await userEvent.click(screen.getByRole('button', { name: /upload past watches/i }))
    await userEvent.selectOptions(screen.getByLabelText('Crew member for row 1'), 'c1')
    await userEvent.type(screen.getByLabelText('Date for row 1'), '2026-11-03')
    // a second, incomplete row must not be sent
    await userEvent.click(screen.getByRole('button', { name: /add another watch/i }))
    await userEvent.click(screen.getByRole('button', { name: /^record/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('import-watch-history', {
      body: { records: [{ crew_id: 'c1', watch_date: '2026-11-03' }] },
    }))
    expect(await screen.findByText(/Recorded 1 watch/)).toBeInTheDocument()
    await waitFor(() => expect(onImported).toHaveBeenCalled())
  })

  it('names the people it could not match instead of guessing', async () => {
    invoke.mockResolvedValue({ data: { applied: true, imported: 0, crew: 0, unmatched: ['Greta'] }, error: null })
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /upload past watches/i }))
    await userEvent.selectOptions(screen.getByLabelText('Crew member for row 1'), 'c1')
    await userEvent.type(screen.getByLabelText('Date for row 1'), '2026-11-03')
    await userEvent.click(screen.getByRole('button', { name: /^record/i }))
    expect(await screen.findByText(/Not matched to anyone on your crew list: Greta/)).toBeInTheDocument()
  })

  it('surfaces a server refusal rather than claiming success', async () => {
    invoke.mockResolvedValue({ data: { error: 'Set up your watch lanes before importing past watches.' }, error: null })
    const onImported = renderIt()
    await userEvent.click(screen.getByRole('button', { name: /upload past watches/i }))
    await userEvent.selectOptions(screen.getByLabelText('Crew member for row 1'), 'c1')
    await userEvent.type(screen.getByLabelText('Date for row 1'), '2026-11-03')
    await userEvent.click(screen.getByRole('button', { name: /^record/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/watch lanes/i)
    expect(onImported).not.toHaveBeenCalled()
  })

  it('offers the CSV route with a template', async () => {
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /upload past watches/i }))
    await userEvent.click(screen.getByRole('button', { name: /upload a csv/i }))
    expect(screen.getByRole('button', { name: /download a template/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose a csv file/i })).toBeInTheDocument()
  })
})
