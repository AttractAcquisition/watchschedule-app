import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RotaPriority, displayOrder } from './RotaPriority'

const crew = [
  { id: 'id-c', full_name: 'Chris Ray', position: 'Deckhand', eligible: true },
  { id: 'id-a', full_name: 'Alex Mason', position: 'Bosun', eligible: true },
  { id: 'id-b', full_name: 'Ben Knox', position: 'Deckhand', eligible: true },
]
let saved: string[] = []
const rpc = vi.fn()
// A minimal chain for the two selects RotaPriority makes.
const from = (table: string) => {
  const result = table === 'watch_settings' ? { data: { rota_priority: saved }, error: null } : { data: crew, error: null }
  const chain = { select: () => chain, eq: () => chain, order: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) }
  return chain
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => from(t), rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('../../auth/AuthGate', () => ({ useAuth: () => ({ profile: { vessel_id: 'v1' } }) }))

const renderIt = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><RotaPriority /></QueryClientProvider>)
}
const names = () => within(screen.getByRole('list', { name: /who takes the extra watch/i })).getAllByRole('listitem').map((li) => li.textContent ?? '')

describe('displayOrder', () => {
  it('puts the saved order first and everyone else alphabetically after it', () => {
    const { order, unplaced } = displayOrder(['id-b', 'gone', 'id-b'], crew)
    expect(order).toEqual(['id-b', 'id-a', 'id-c'])
    expect([...unplaced].sort()).toEqual(['id-a', 'id-c'])
  })
  it('with nothing saved, lists everyone alphabetically and flags no one as new', () => {
    const { order, unplaced } = displayOrder([], crew)
    expect(order).toEqual(['id-a', 'id-b', 'id-c'])
    expect(unplaced.size).toBe(0)
  })
})

describe('RotaPriority', () => {
  beforeEach(() => { rpc.mockReset(); saved = [] })

  it('shows "Not set", reorders, and saves the whole order in one call', async () => {
    rpc.mockResolvedValue({ error: null })
    renderIt()
    expect(await screen.findByText('Not set')).toBeInTheDocument()
    expect(names()[0]).toMatch(/Alex Mason.*takes the extra first/)
    await userEvent.click(screen.getByRole('button', { name: 'Move Chris Ray to the top' }))
    expect(names()[0]).toMatch(/Chris Ray/)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this order' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_rota_priority', { p_order: ['id-c', 'id-a', 'id-b'] }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Chris Ray takes the extra watch first/)
  })

  it('loads a saved order, marks crew added since, and can clear it', async () => {
    saved = ['id-b', 'id-c']
    rpc.mockResolvedValue({ error: null })
    renderIt()
    await waitFor(() => expect(names()[0]).toMatch(/Ben Knox/))
    expect(names()[2]).toMatch(/Alex Mason.*new — not placed yet.*spared first/)
    await userEvent.click(screen.getByRole('button', { name: /clear order/i }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_rota_priority', { p_order: [] }))
  })

  it('surfaces a server refusal', async () => {
    rpc.mockResolvedValue({ error: new Error('The order names someone who is not in your crew.') })
    renderIt()
    await screen.findByText('Not set')
    await userEvent.click(screen.getByRole('button', { name: 'Use this order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not in your crew/)
  })
})
