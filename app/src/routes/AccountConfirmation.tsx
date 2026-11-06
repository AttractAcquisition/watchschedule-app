import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, GateLoader } from '../auth/AuthGate'
import { AuthCard } from '../components/auth/AuthCard'
import { authButton } from '../components/auth/RecoveryRequestForm'

export default function AccountConfirmation() {
  const { initializing, session, refreshUser, callbackError } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (initializing) return <GateLoader />
  const user = session?.user
  return <AuthCard title="Check your login email">
    {callbackError && <p role="alert" className="mb-ws-3 text-ws-sm text-ws-alert">This confirmation link is invalid, expired, or already used. Check your current address below; sign in and request a new change from Account settings if needed.</p>}
    {user ? <>
      <p className="break-words text-ws-sm text-ws-text-muted">Current login email: <strong>{user.email}</strong></p>
      {user.new_email ? <p role="status" className="mt-ws-3 text-ws-sm text-ws-text-muted">The change to {user.new_email} is still pending. Check the confirmation emails sent to your current and new addresses. Opening only one link may not complete the change.</p>
        : <p className="mt-ws-3 text-ws-sm text-ws-text-muted">The address above is the current email reported by Supabase Auth. If you still see the old address, complete the remaining confirmation email, then refresh.</p>}
      <button disabled={busy} className={`mt-ws-4 ${authButton}`} onClick={async () => {
        setBusy(true); setError('')
        try { await refreshUser() } catch { setError('Could not refresh your account. Try again or sign in with your confirmed email.') }
        finally { setBusy(false) }
      }}>{busy ? 'Refreshing…' : 'Refresh account'}</button>
      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
      <Link to="/settings?tab=account" className="mt-ws-4 block text-ws-gold">Account settings</Link>
    </> : <p className="text-ws-sm text-ws-text-muted">Email confirmation may require links from both addresses. If the link has expired or was already used, sign in and request the change again from Account settings.</p>}
    <Link to="/login" className="mt-ws-4 block text-ws-sm text-ws-gold">Back to sign in</Link>
  </AuthCard>
}
