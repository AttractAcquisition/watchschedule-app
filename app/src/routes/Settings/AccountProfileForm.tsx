import { useRef, useState, type FormEvent } from 'react'
import { KeyRound, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { authRedirectUrl } from '../../lib/appUrl'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { profileQueryKey } from '../../auth/useProfile'
import { accountError, cleanEmail, validEmail, usernamePattern, USERNAME_HELP } from '../../auth/accountValidation'
import { PasswordForm } from '../../components/auth/PasswordForm'
import { RecoveryRequestForm, authInput, authButton } from '../../components/auth/RecoveryRequestForm'

export function AccountProfileForm() {
  const { profile, session, refreshUser } = useAuth()
  const userId = session?.user.id
  const email = session?.user.email
  const pendingEmail = session?.user.new_email
  const [editing, setEditing] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function editProfile() {
    // Read the latest fetched profile each time editing opens, rather than a
    // useState initializer that can outlive an asynchronous profile refresh.
    setName(profile?.full_name ?? '')
    setUsername(profile?.username ?? '')
    setEditing(true); setError(''); setNotice('')
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !userId) return
    const full_name = name.trim()
    const cleanUsername = username.trim().toLowerCase()
    if (!full_name) { setError('Enter your name.'); return }
    if (!usernamePattern.test(cleanUsername)) { setError(USERNAME_HELP); return }
    inFlight.current = true; setSaving(true); setError(''); setNotice('')
    try {
      const { data, error } = await supabase.from('profiles')
        .update({ full_name, username: cleanUsername }).eq('id', userId).select('*').single()
      if (error) throw error
      queryClient.setQueryData(profileQueryKey(userId), data)
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
      setEditing(false); setNotice('Profile saved.')
    } catch (err) { setError(accountError(err, 'profile')) }
    finally { inFlight.current = false; setSaving(false) }
  }
  async function changeEmail(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !userId) return
    const proposed = cleanEmail(newEmail)
    if (!validEmail(proposed)) { setError('Enter a valid email address.'); return }
    if (proposed.toLowerCase() === email?.toLowerCase()) { setError('That is already your current login email.'); return }
    inFlight.current = true; setSaving(true); setError(''); setNotice('')
    try {
      const { data, error } = await supabase.auth.updateUser({ email: proposed }, { emailRedirectTo: authRedirectUrl('/account-confirmation') })
      if (error) throw error
      setNewEmail(''); setEmailOpen(false)
      // Never promote a proposed address to the confirmed email in local UI.
      setNotice(data.user.email?.toLowerCase() === proposed.toLowerCase()
        ? 'Supabase confirmed your current login email.'
        : 'Email change requested. Confirm the messages sent to your current and new addresses. Your login email stays unchanged until Auth confirms the change.')
      await refreshUser().catch(() => setError('The email change was requested, but account refresh failed. Refresh this page to check its confirmation status.'))
    } catch (err) { setError(accountError(err, 'email')) }
    finally { inFlight.current = false; setSaving(false) }
  }
  return <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-4 shadow-ws-md">
    <div className="flex flex-wrap items-start justify-between gap-ws-3">
      <div><p className="ws-eyebrow">— Your account</p><h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Profile &amp; sign-in</h2></div>
      <div className="flex items-center gap-ws-2">
        <button type="button" onClick={() => { setPasswordOpen(v => !v); setNotice(''); setError('') }} aria-expanded={passwordOpen} aria-controls="account-password" className="flex items-center gap-ws-2 rounded-ws-sm px-ws-3 py-ws-2 text-ws-sm text-ws-text-muted hover:bg-ws-steel-3"><KeyRound className="h-4 w-4" aria-hidden /> Password</button>
        <button type="button" onClick={editProfile} disabled={saving} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-2 text-ws-sm text-ws-text"><Pencil className="h-4 w-4" aria-hidden /> Edit profile</button>
      </div>
    </div>
    <dl className="mt-ws-4 grid gap-ws-3 sm:grid-cols-3">
      <div><dt className="text-ws-xs text-ws-text-muted">Name</dt><dd className="mt-ws-1 text-ws-sm text-ws-text">{profile?.full_name || 'Not set'}</dd></div>
      <div><dt className="text-ws-xs text-ws-text-muted">Username</dt><dd className="mt-ws-1 font-mono text-ws-sm text-ws-text">{profile?.username ? `@${profile.username}` : 'Not set'}</dd></div>
      <div><dt className="text-ws-xs text-ws-text-muted">Login email</dt><dd className="mt-ws-1 break-words text-ws-sm text-ws-text">{email ?? 'Not available'}</dd></div>
    </dl>
    {pendingEmail && <p role="status" className="mt-ws-3 break-words text-ws-sm text-ws-text-muted">Pending email change: {pendingEmail}. Complete the confirmation emails; the login email above is still current.</p>}
    <button type="button" disabled={saving} onClick={() => { setEmailOpen(v => !v); setError(''); setNotice('') }} aria-expanded={emailOpen} className="mt-ws-3 text-ws-sm text-ws-gold">Change login email</button>
    {notice && <p role="status" className="mt-ws-3 text-ws-sm text-ws-ok">{notice}</p>}
    {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
    {editing && <form onSubmit={saveProfile} noValidate aria-label="Edit profile" className="mt-ws-4 space-y-ws-3 border-t border-ws-line pt-ws-4">
      <label className="block text-ws-sm text-ws-text-muted">Name<input autoComplete="name" required value={name} onChange={e => setName(e.target.value)} disabled={saving} className={`mt-ws-1 ${authInput}`} /></label>
      <label className="block text-ws-sm text-ws-text-muted">Username<input autoComplete="username" spellCheck={false} required value={username} onChange={e => setUsername(e.target.value.toLowerCase())} disabled={saving} aria-describedby="username-help" className={`mt-ws-1 ${authInput}`} /></label>
      <p id="username-help" className="text-ws-xs text-ws-text-muted">{USERNAME_HELP}</p>
      <div className="flex gap-ws-3"><button disabled={saving} className={authButton}>{saving ? 'Saving…' : 'Save profile'}</button><button type="button" disabled={saving} onClick={() => { setEditing(false); setError('') }} className="text-ws-sm text-ws-text-muted">Cancel</button></div>
    </form>}
    {emailOpen && <form onSubmit={changeEmail} noValidate aria-label="Change login email" className="mt-ws-4 space-y-ws-3 border-t border-ws-line pt-ws-4">
      <p className="text-ws-sm text-ws-text-muted">This changes your sign-in address after confirmation. It does not change a separate Stripe billing contact.</p>
      <label className="block text-ws-sm text-ws-text-muted">New login email<input type="email" autoComplete="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)} disabled={saving} className={`mt-ws-1 ${authInput}`} /></label>
      <button disabled={saving} className={authButton}>{saving ? 'Requesting…' : 'Request email change'}</button>
    </form>}
    {passwordOpen && <div id="account-password" className="mt-ws-4 space-y-ws-5 border-t border-ws-line pt-ws-4">
      <div><h3 className="mb-ws-3 font-display text-ws-md text-ws-offwhite">Change your password now</h3><PasswordForm key={userId} mode="change" onUpdated={() => { setPasswordOpen(false); setNotice('Password updated. You remain signed in on this browser.'); setError('') }} /></div>
      {email && <div className="border-t border-ws-line pt-ws-4"><h3 className="mb-ws-3 font-display text-ws-md text-ws-offwhite">Prefer an email link?</h3><RecoveryRequestForm email={email} /></div>}
    </div>}
  </section>
}
