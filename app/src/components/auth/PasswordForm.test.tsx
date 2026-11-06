import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordForm } from './PasswordForm'
import { RecoveryRequestForm } from './RecoveryRequestForm'
const api = vi.hoisted(() => ({ updateUser: vi.fn(), reauthenticate: vi.fn(), resetPasswordForEmail: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: api } }))
vi.mock('../../lib/appUrl', () => ({ authRedirectUrl: (path: string) => `https://app.watchschedule.com${path}` }))
beforeEach(() => {
  vi.resetAllMocks()
  api.updateUser.mockResolvedValue({ error: null })
  api.reauthenticate.mockResolvedValue({ error: null })
  api.resetPasswordForEmail.mockResolvedValue({ error: null })
})
async function enterPassword() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('New password'), 'Fresh-test-password-42!')
  await user.type(screen.getByLabelText('Confirm new password'), 'Fresh-test-password-42!')
  return user
}
describe('shared new password form', () => {
  it('rejects short/mismatched passwords and provides accessible visibility controls', async () => {
    render(<PasswordForm mode="recovery" onUpdated={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Confirm new password'), 'different')
    fireEvent.submit(screen.getByRole('form'))
    expect(api.updateUser).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Show passwords' }))
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide passwords' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('reports success only after confirmation and blocks duplicate submissions', async () => {
    let complete!: (value: { error: null }) => void
    api.updateUser.mockReturnValue(new Promise(resolve => { complete = resolve }))
    const updated = vi.fn()
    render(<PasswordForm mode="recovery" onUpdated={updated} />)
    const user = await enterPassword()
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    fireEvent.submit(screen.getByRole('form'))
    expect(api.updateUser).toHaveBeenCalledTimes(1)
    expect(updated).not.toHaveBeenCalled()
    complete({ error: null })
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('New password')).toHaveValue('')
  })
  it('uses Supabase reauthentication and resubmits with its nonce', async () => {
    api.updateUser.mockResolvedValueOnce({ error: { code: 'reauthentication_needed' } })
    const updated = vi.fn()
    render(<PasswordForm mode="change" onUpdated={updated} />)
    const user = await enterPassword()
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    await user.click(await screen.findByRole('button', { name: 'Send verification code' }))
    expect(api.reauthenticate).toHaveBeenCalledTimes(1)
    await user.type(screen.getByLabelText('Email verification code'), '12345678')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(api.updateUser).toHaveBeenLastCalledWith({ password: 'Fresh-test-password-42!', nonce: '12345678' })
    expect(updated).toHaveBeenCalledTimes(1)
  })
  it.each(['same_password', 'weak_password', 'session_expired', 'reauthentication_not_valid'])('does not report success for %s', async code => {
    api.updateUser.mockResolvedValue({ error: { code } })
    const updated = vi.fn()
    render(<PasswordForm mode="recovery" onUpdated={updated} />)
    const user = await enterPassword()
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(updated).not.toHaveBeenCalled()
  })
})
describe('recovery request', () => {
  it('trims/validates email and supplies an explicit canonical recovery redirect', async () => {
    render(<RecoveryRequestForm />)
    const user = userEvent.setup()
    fireEvent.submit(screen.getByRole('form'))
    expect(api.resetPasswordForEmail).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Email'), ' captain@example.com ')
    await user.click(screen.getByRole('button', { name: 'Send password reset email' }))
    expect(api.resetPasswordForEmail).toHaveBeenCalledWith('captain@example.com', { redirectTo: 'https://app.watchschedule.com/reset-password' })
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists')
  })
  it('uses the same neutral response for an unknown email', async () => {
    api.resetPasswordForEmail.mockResolvedValue({ error: { code: 'user_not_found' } })
    render(<RecoveryRequestForm email="captain@example.com" />)
    await userEvent.click(screen.getByRole('button', { name: 'Send password reset email' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists')
  })
  it.each([{ status: 429 }, new TypeError('offline')])('handles rate limits and transport errors without revealing accounts', async error => {
    api.resetPasswordForEmail.mockRejectedValue(error)
    render(<RecoveryRequestForm email="captain@example.com" />)
    await userEvent.click(screen.getByRole('button', { name: 'Send password reset email' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
