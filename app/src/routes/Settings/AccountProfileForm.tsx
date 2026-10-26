import { useState } from 'react'
import { Check, KeyRound, Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { profileQueryKey } from '../../auth/useProfile'

const usernamePattern = /^[a-z0-9][a-z0-9_-]{2,31}$/

export function AccountProfileForm() {
  const { profile, session } = useAuth()
  const userId = session?.user.id
  const [editing, setEditing] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [name, setName] = useState(profile?.full_name ?? '')
  const [username, setUsername] = useState(profile?.username ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const email = session?.user.email ?? profile?.email ?? '—'
  const resetEdit = () => {
    setEditing(false)
    setName(profile?.full_name ?? '')
    setUsername(profile?.username ?? '')
    setError(null)
  }

  async function saveProfile() {
    const cleanName = name.trim()
    const cleanUsername = username.trim().toLowerCase()
    if (!cleanName) return setError('Enter your name.')
    if (!usernamePattern.test(cleanUsername)) return setError('Username must be 3–32 lowercase letters, numbers, hyphens, or underscores.')
    if (!userId) return
    setSaving(true); setError(null); setNotice(null)
    try {
      const { error } = await supabase.from('profiles').update({ full_name: cleanName, username: cleanUsername }).eq('id', userId)
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
      setEditing(false)
      setNotice('Profile saved.')
    } catch {
      setError('That username is unavailable. Please choose another one.')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    if (newPassword.length < 6) return setError('Use a password of at least 6 characters.')
    if (newPassword !== confirmPassword) return setError('The new passwords do not match.')
    setChangingPassword(true); setError(null); setNotice(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword(''); setConfirmPassword('')
      setPasswordOpen(false)
      setNotice('Password updated.')
    } catch {
      setError("Couldn't update your password. Please try again.")
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-4 shadow-ws-md">
      <div className="flex flex-wrap items-start justify-between gap-ws-3">
        <div>
          <p className="ws-eyebrow">— Your account</p>
          <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Profile &amp; sign-in</h2>
        </div>
        <div className="flex items-center gap-ws-2">
          <button type="button" onClick={() => { setPasswordOpen(true); setNotice(null) }} className="flex items-center gap-ws-2 rounded-ws-sm px-ws-3 py-ws-2 text-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"><KeyRound className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Password</button>
          <button type="button" onClick={() => { setEditing(true); setNotice(null) }} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-2 text-ws-sm font-medium text-ws-text hover:border-ws-gold hover:bg-ws-steel-3"><Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Edit</button>
        </div>
      </div>

      <dl className="mt-ws-4 grid gap-ws-3 sm:grid-cols-3">
        <div><dt className="text-ws-xs text-ws-text-muted">Name</dt><dd className="mt-ws-1 text-ws-sm text-ws-text">{profile?.full_name || 'Not set'}</dd></div>
        <div><dt className="text-ws-xs text-ws-text-muted">Username</dt><dd className="mt-ws-1 font-mono text-ws-sm text-ws-text">{profile?.username ? `@${profile.username}` : 'Not set'}</dd></div>
        <div><dt className="text-ws-xs text-ws-text-muted">Email</dt><dd className="mt-ws-1 truncate text-ws-sm text-ws-text">{email}</dd></div>
      </dl>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
      {notice && <p role="status" className="mt-ws-3 text-ws-sm text-ws-ok">{notice}</p>}

      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-label="Edit profile">
        <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
          <div className="flex items-center justify-between"><h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Edit profile</h3><button type="button" onClick={resetEdit} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3"><X className="h-4 w-4" aria-hidden /></button></div>
          <div className="mt-ws-4 space-y-ws-3"><label className="block text-ws-xs text-ws-text-muted">Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" /></label><label className="block text-ws-xs text-ws-text-muted">Username<input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" spellCheck={false} className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" /></label></div>
          <div className="mt-ws-5 flex justify-end"><button type="button" onClick={saveProfile} disabled={saving} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Save profile</button></div>
        </div>
      </div>}

      {passwordOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-label="Reset password">
        <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg">
          <div className="flex items-center justify-between"><div><p className="ws-eyebrow">— Security</p><h3 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Set a new password</h3></div><button type="button" onClick={() => setPasswordOpen(false)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3"><X className="h-4 w-4" aria-hidden /></button></div>
          <div className="mt-ws-4 space-y-ws-3"><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="New password" className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-sm text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" /><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="Confirm new password" className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-sm text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" /></div>
          <div className="mt-ws-5 flex justify-end"><button type="button" onClick={changePassword} disabled={changingPassword || !newPassword || !confirmPassword} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold disabled:opacity-60">{changingPassword && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Update password</button></div>
        </div>
      </div>}
    </section>
  )
}
