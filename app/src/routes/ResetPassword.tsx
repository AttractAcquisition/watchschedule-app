import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GateLoader, useAuth } from '../auth/AuthGate'
import { AuthCard } from '../components/auth/AuthCard'
import { PasswordForm } from '../components/auth/PasswordForm'
import { RecoveryRequestForm } from '../components/auth/RecoveryRequestForm'
import { authButton } from '../components/auth/RecoveryRequestForm'

export default function ResetPassword() {
  const { initializing, session, recovery, clearRecovery, signOut } = useAuth()
  const [updated, setUpdated] = useState(false)
  const [signedOut, setSignedOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  async function finish() {
    setUpdated(true)
    clearRecovery()
    try { await signOut('local'); setSignedOut(true); setSignOutError(false) }
    catch { setSignOutError(true) }
  }
  if (initializing || recovery === 'processing') return <GateLoader />
  if (updated) return <AuthCard title="Password updated">
    <p role="status" className="text-ws-sm text-ws-ok">Supabase confirmed your new password.</p>
    {signedOut ? <><p className="mt-ws-3 text-ws-sm text-ws-text-muted">You’re signed out of this browser. Sign in with your new password.</p><Link to="/login" className="mt-ws-4 block text-ws-gold">Sign in</Link></>
      : <button className={`mt-ws-4 ${authButton}`} onClick={finish}>{signOutError ? 'Retry signing out of this browser' : 'Signing out…'}</button>}
  </AuthCard>
  if (session && recovery === 'ready') return <AuthCard title="Set a new password"><PasswordForm mode="recovery" onUpdated={finish} /></AuthCard>
  return <AuthCard title={recovery === 'invalid' ? 'This reset link is no longer usable' : 'Request a password reset link'}>
    <p className="mb-ws-4 text-ws-sm text-ws-text-muted">{recovery === 'invalid'
      ? 'The link may have expired, already been used, or be incomplete. Request a fresh email and use its newest link.'
      : 'Open the link in your password reset email to set a new password. This page alone cannot verify a recovery request.'}</p>
    {session && recovery !== 'invalid' && <p className="mb-ws-4 text-ws-sm text-ws-text-muted">You’re signed in normally. <Link to="/settings?tab=account" className="text-ws-gold">Change your password in Account settings</Link>, or request an email below.</p>}
    <RecoveryRequestForm />
    <Link to="/login" onClick={clearRecovery} className="mt-ws-4 block text-ws-sm text-ws-gold">Back to sign in</Link>
  </AuthCard>
}
