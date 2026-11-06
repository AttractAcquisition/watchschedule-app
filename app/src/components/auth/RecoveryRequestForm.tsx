import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { authRedirectUrl } from '../../lib/appUrl'
import { accountError, cleanEmail, validEmail } from '../../auth/accountValidation'

export const authInput = 'w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-base text-ws-text focus:border-ws-gold focus:outline-none focus:ring-2 focus:ring-ws-gold-ghost'
export const authButton = 'rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 font-semibold text-ws-text-on-gold hover:bg-ws-gold-bright disabled:opacity-50'
const neutralNotice = 'If an account exists for this email, you’ll receive a password reset link.'

export function RecoveryRequestForm({ email: authenticatedEmail }: { email?: string }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    const address = cleanEmail(authenticatedEmail ?? email)
    if (!validEmail(address)) { setError('Enter a valid email address.'); return }
    inFlight.current = true; setBusy(true); setError(''); setSent(false)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: authRedirectUrl('/reset-password') })
      // Never distinguish missing users or disabled sign-ups in recovery UX.
      if (error && !['user_not_found', 'email_not_found', 'email_not_confirmed', 'signup_disabled'].includes(error.code ?? '')) throw error
      setSent(true)
    } catch (err) { setError(accountError(err, 'recovery')) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <form onSubmit={submit} noValidate className="space-y-ws-3" aria-label="Request password reset">
    {authenticatedEmail ? <p className="break-words text-ws-sm text-ws-text-muted">Send a password reset link to your current login email: {authenticatedEmail}</p>
      : <label className="block text-ws-sm text-ws-text-muted">Email<input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required className={`mt-ws-1 ${authInput}`} /></label>}
    {error && <p role="alert" className="text-ws-sm text-ws-alert">{error}</p>}
    {sent && <p role="status" className="text-ws-sm text-ws-ok">{neutralNotice}</p>}
    <button type="submit" disabled={busy} className={authButton}>{busy ? 'Sending…' : 'Send password reset email'}</button>
  </form>
}
