import { useId, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { accountError, PASSWORD_HELP, PASSWORD_MIN_LENGTH, passwordError } from '../../auth/accountValidation'
import { authInput, authButton } from './RecoveryRequestForm'

export function PasswordForm({ mode, onUpdated }: { mode: 'recovery' | 'change'; onUpdated: () => Promise<void> | void }) {
  const id = useId()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [needsNonce, setNeedsNonce] = useState(false)
  const [nonce, setNonce] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [codeNotice, setCodeNotice] = useState('')
  const invalid = passwordError(password, confirmation)
  async function sendCode() {
    if (sendingCode) return
    setSendingCode(true); setError(''); setCodeNotice('')
    try {
      const { error } = await supabase.auth.reauthenticate()
      if (error) throw error
      setNeedsNonce(true)
      setCodeNotice('A verification code was sent to your account email. Enter it below, then update your password.')
    } catch (err) { setError(accountError(err, 'password')) }
    finally { setSendingCode(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    if (invalid) { setError(invalid); return }
    if (needsNonce && !nonce.trim()) { setError('Enter the verification code from your email.'); return }
    inFlight.current = true; setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.updateUser({ password, ...(nonce.trim() ? { nonce: nonce.trim() } : {}) })
      if (error) {
        if (error.code === 'reauthentication_needed') setNeedsNonce(true)
        throw error
      }
      setPassword(''); setConfirmation(''); setNonce('')
      await onUpdated()
    } catch (err) { setError(accountError(err, 'password')) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <form onSubmit={submit} noValidate className="space-y-ws-3" aria-label={mode === 'recovery' ? 'Reset password' : 'Change password'}>
    <p id={`${id}-help`} className="text-ws-sm text-ws-text-muted">{PASSWORD_HELP}</p>
    <label className="block text-ws-sm text-ws-text-muted" htmlFor={`${id}-new`}>New password</label>
    <input id={`${id}-new`} type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-describedby={`${id}-help`} className={authInput} />
    <label className="block text-ws-sm text-ws-text-muted" htmlFor={`${id}-confirm`}>Confirm new password</label>
    <input id={`${id}-confirm`} type={visible ? 'text' : 'password'} autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} className={authInput} />
    <button type="button" onClick={() => setVisible(v => !v)} aria-pressed={visible} aria-controls={`${id}-new ${id}-confirm`} className="flex items-center gap-ws-2 text-ws-sm text-ws-gold">{visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}{visible ? 'Hide passwords' : 'Show passwords'}</button>
    {confirmation && invalid && <p role="status" className="text-ws-sm text-ws-text-muted">{invalid}</p>}
    {needsNonce && <div className="space-y-ws-2">
      <p className="text-ws-sm text-ws-text-muted">Supabase requires identity verification for this password change.</p>
      <button type="button" disabled={busy || sendingCode} onClick={sendCode} className="text-ws-sm text-ws-gold">{sendingCode ? 'Sending code…' : 'Send verification code'}</button>
      <label className="block text-ws-sm text-ws-text-muted">Email verification code<input autoComplete="one-time-code" inputMode="numeric" value={nonce} onChange={e => setNonce(e.target.value)} disabled={busy} className={`mt-ws-1 ${authInput}`} /></label>
    </div>}
    {codeNotice && <p role="status" className="text-ws-sm text-ws-ok">{codeNotice}</p>}
    {error && <p role="alert" className="text-ws-sm text-ws-alert">{error}</p>}
    <button type="submit" disabled={busy || sendingCode || !!invalid || (needsNonce && !nonce.trim())} className={authButton}>{busy ? 'Updating…' : 'Update password'}</button>
  </form>
}
