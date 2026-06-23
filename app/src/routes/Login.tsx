// /login — Authentication (frontend.md §4.1, branding.md §6).
// Supabase email/password (signInWithPassword / signUp). Full-bleed navy
// backdrop with a centred card, single primary CTA, sign-in/sign-up toggle.
// Errors are spoken in the interface voice — never raw Supabase codes.
// (OAuth is deferred: it needs provider credentials configured server-side;
// noted for a later phase per frontend.md §4.1.)
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Anchor, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthGate'
import { ZONE_PATH } from '../auth/gate'

type Mode = 'signin' | 'signup'

// Translate Supabase auth errors into the product's voice.
function humanError(message: string, mode: Mode): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials'))
    return "That email or password doesn't match our records. Please try again."
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'That email is already registered. Sign in instead.'
  if (m.includes('email not confirmed'))
    return 'Please confirm your email first — check your inbox — then sign in.'
  if (m.includes('password') && (m.includes('6') || m.includes('short') || m.includes('weak')))
    return 'Use a password of at least 6 characters.'
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts just now. Please wait a moment and try again.'
  if (m.includes('invalid') && m.includes('email'))
    return 'That email address looks invalid. Please check it.'
  return mode === 'signin'
    ? "We couldn't sign you in. Please try again."
    : "We couldn't create your account. Please try again."
}

export default function Login() {
  const { loading: gateLoading, session, zone } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Already authenticated -> let the gate route onward (no flash).
  if (!gateLoading && session && zone !== 'login') {
    return <Navigate to={ZONE_PATH[zone]} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // On success, onAuthStateChange updates the gate and we redirect above.
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          // Email-confirmation is enabled: no session yet.
          setNotice('Account created. Check your email to confirm, then sign in.')
          setMode('signin')
        }
        // If a session WAS returned (auto-confirm), the gate routes onward.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(humanError(message, mode))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      className="flex min-h-full items-center justify-center p-ws-5"
      // Token-based navy backdrop standing in for the cinematic bridge photo +
      // navy overlay (branding.md §6); the photo asset lands in Phase 12 polish.
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -10%, var(--ws-steel) 0%, var(--ws-navy) 35%, var(--ws-navy-deep) 100%)',
      }}
    >
      <div className="w-full max-w-sm rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 shadow-ws-lg">
        <div className="flex items-center gap-ws-2">
          <Anchor className="h-5 w-5 text-ws-gold" strokeWidth={1.5} aria-hidden />
          <span className="font-display text-ws-md font-semibold tracking-ws-tight text-ws-offwhite">
            WatchSchedule
          </span>
        </div>
        <p className="ws-eyebrow mt-ws-4">
          — {mode === 'signin' ? 'Sign in' : 'Create account'}
        </p>
        <h1 className="mt-ws-1 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">
          {mode === 'signin' ? 'Welcome back to the bridge' : 'Set up your vessel'}
        </h1>

        <form onSubmit={onSubmit} className="mt-ws-5 space-y-ws-4">
          <div className="space-y-ws-2">
            <label htmlFor="email" className="block text-ws-sm font-medium text-ws-text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-base text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none focus:ring-2 focus:ring-ws-gold-ghost"
              placeholder="captain@vessel.com"
            />
          </div>
          <div className="space-y-ws-2">
            <label htmlFor="password" className="block text-ws-sm font-medium text-ws-text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-base text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none focus:ring-2 focus:ring-ws-gold-ghost"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-ws-sm text-ws-alert">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-ws-sm text-ws-ok">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-ws-4 text-center text-ws-sm text-ws-text-muted">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
              setNotice(null)
            }}
            className="font-medium text-ws-gold hover:text-ws-gold-bright"
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </main>
  )
}
