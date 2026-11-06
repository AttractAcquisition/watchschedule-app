import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountProfileForm } from './AccountProfileForm'

const mock = vi.hoisted(() => ({
  auth: { profile: { full_name: null as string | null, username: null as string | null, email: 'stale@example.com' }, session: { user: { id: 'captain-id', email: 'current@example.com', new_email: '' } }, refreshUser: vi.fn() },
  update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn(), updateUser: vi.fn(), invalidate: vi.fn(), setData: vi.fn(),
}))
vi.mock('../../auth/AuthGate', () => ({ useAuth: () => mock.auth }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ update: mock.update }), auth: { updateUser: mock.updateUser } } }))
vi.mock('../../lib/queryClient', () => ({ queryClient: { invalidateQueries: mock.invalidate, setQueryData: mock.setData } }))
vi.mock('../../lib/appUrl', () => ({ authRedirectUrl: (p: string) => `https://app.watchschedule.com${p}` }))
beforeEach(() => {
  vi.resetAllMocks()
  mock.auth.profile = { full_name: null, username: null, email: 'stale@example.com' }
  mock.auth.session.user.new_email = ''
  mock.update.mockReturnValue({ eq: mock.eq }); mock.eq.mockReturnValue({ select: mock.select })
  mock.select.mockReturnValue({ single: mock.single })
  mock.single.mockResolvedValue({ data: { full_name: 'Verified Captain', username: 'captain_1' }, error: null })
  mock.updateUser.mockResolvedValue({ data: { user: { email: 'current@example.com', new_email: 'proposed@example.com' } }, error: null })
})
describe('account identity sources and mutations', () => {
  it('uses Auth email and leaves unknown names/handles unset', () => {
    render(<AccountProfileForm />)
    expect(screen.getByText('current@example.com')).toBeInTheDocument()
    expect(screen.queryByText('stale@example.com')).not.toBeInTheDocument()
    expect(screen.getAllByText('Not set')).toHaveLength(2)
  })
  it('opens with the latest profile and saves only the authenticated user record', async () => {
    const { rerender } = render(<AccountProfileForm />)
    mock.auth.profile.full_name = 'Verified Captain'; mock.auth.profile.username = 'captain_1'
    rerender(<AccountProfileForm />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit profile' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Verified Captain')
    expect(screen.getByLabelText('Username')).toHaveValue('captain_1')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(mock.eq).toHaveBeenCalledWith('id', 'captain-id')
    expect(mock.update).toHaveBeenCalledWith({ full_name: 'Verified Captain', username: 'captain_1' })
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
    expect(mock.setData).toHaveBeenCalled()
  })
  it('shows username conflicts separately from generic persistence errors', async () => {
    mock.single.mockResolvedValue({ error: { code: '23505' } })
    mock.auth.profile.full_name = 'Verified Captain'; mock.auth.profile.username = 'captain_1'
    render(<AccountProfileForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('username is unavailable')
  })
  it('requests email change through Auth and does not display the proposed address as confirmed', async () => {
    render(<AccountProfileForm />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Change login email' }))
    await user.type(screen.getByLabelText('New login email'), ' proposed@example.com ')
    await user.click(screen.getByRole('button', { name: 'Request email change' }))
    expect(mock.updateUser).toHaveBeenCalledWith({ email: 'proposed@example.com' }, { emailRedirectTo: 'https://app.watchschedule.com/account-confirmation' })
    expect(screen.getByText('current@example.com')).toBeInTheDocument()
    await waitFor(() => expect(mock.auth.refreshUser).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status')).toHaveTextContent('stays unchanged until Auth confirms')
  })
  it('renders pending confirmation separately from current email', () => {
    mock.auth.session.user.new_email = 'pending@example.com'
    render(<AccountProfileForm />)
    expect(screen.getByRole('status')).toHaveTextContent('Pending email change: pending@example.com')
    expect(screen.getByText('current@example.com')).toBeInTheDocument()
  })
})
