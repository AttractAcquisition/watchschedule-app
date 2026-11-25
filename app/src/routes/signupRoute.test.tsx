import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthGate'
import Login from './Login'
import type { SessionState } from '../auth/authState'

const mock = vi.hoisted(() => ({ snapshot: { session: null, loading: false, recovery: 'none' } as SessionState }))
vi.mock('../auth/useSession', () => ({ useSession: () => mock.snapshot }))
vi.mock('../auth/useProfile', () => ({ useProfile: () => ({ data: null, isLoading: false }), profileQueryKey: (id: string) => ['profile', id] }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })), signOut: vi.fn(async () => ({ error: null })) } },
  authState: { clearRecovery: vi.fn(), setUser: vi.fn() },
}))

beforeEach(() => { mock.snapshot = { session: null, loading: false, recovery: 'none' } })

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Login initialMode="signup" />} />
  </Routes></AuthProvider></MemoryRouter>)
}

describe('the marketing site can link straight at creating an account', () => {
  it('/signup opens on create-account, not sign-in', async () => {
    renderAt('/signup')
    expect(await screen.findByText('Set up your vessel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  })

  it('/login is unchanged and still opens on sign-in', async () => {
    renderAt('/login')
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('the toggle still moves between the two from either entry point', async () => {
    const { container } = renderAt('/signup')
    await screen.findByText('Set up your vessel')
    const toggle = container.querySelector('button[type="button"]') as HTMLButtonElement
    toggle.click()
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument()
  })
})
