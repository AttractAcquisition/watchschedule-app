import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, GateRedirect } from './AuthGate'
import ResetPassword from '../routes/ResetPassword'
import type { SessionState } from './authState'

const mock = vi.hoisted(() => ({ snapshot: { session: null, loading: false, recovery: 'none' } as SessionState }))
vi.mock('./useSession', () => ({ useSession: () => mock.snapshot }))
vi.mock('./useProfile', () => ({ useProfile: () => ({ data: { payment_status: 'active', onboarding_complete: true }, isLoading: false }), profileQueryKey: (id: string) => ['profile', id] }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })), signOut: vi.fn(async () => ({ error: null })) } },
  authState: { clearRecovery: vi.fn(), setUser: vi.fn() },
}))
const signedIn = { user: { id: 'captain', email: 'captain@example.com' } } as Session
beforeEach(() => { mock.snapshot = { session: signedIn, loading: false, recovery: 'none' } })
function renderRoutes(path = '/') {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/dashboard" element={<p>Ordinary dashboard</p>} />
    <Route path="/login" element={<p>Sign in</p>} />
    <Route path="*" element={<GateRedirect />} />
  </Routes></AuthProvider></MemoryRouter>)
}
describe('recovery takes precedence over authenticated routing', () => {
  it('routes a root recovery session into the password form instead of dashboard', async () => {
    mock.snapshot.recovery = 'ready'
    renderRoutes()
    expect(await screen.findByRole('form', { name: 'Reset password' })).toBeInTheDocument()
    expect(screen.queryByText('Ordinary dashboard')).not.toBeInTheDocument()
  })
  it('holds routing during callback initialization', () => {
    mock.snapshot.loading = true
    mock.snapshot.recovery = 'processing'
    renderRoutes()
    expect(screen.getByText('— Resolving session')).toBeInTheDocument()
    expect(screen.queryByText('Ordinary dashboard')).not.toBeInTheDocument()
  })
  it('keeps ordinary sign-ins on their existing dashboard route', async () => {
    renderRoutes()
    expect(await screen.findByText('Ordinary dashboard')).toBeInTheDocument()
  })
  it('does not show a recovery form for a regular session or missing link', () => {
    renderRoutes('/reset-password')
    expect(screen.getByText('Change your password in Account settings')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Reset password' })).not.toBeInTheDocument()
  })
  it('shows expired/used-link guidance even with a preexisting ordinary session', () => {
    mock.snapshot.recovery = 'invalid'
    renderRoutes('/reset-password')
    expect(screen.getByText(/may have expired, already been used/)).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Request password reset' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Reset password' })).not.toBeInTheDocument()
  })
})
