import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'

export type RecoveryStatus = 'none' | 'processing' | 'ready' | 'invalid'
export interface SessionState { session: Session | null; loading: boolean; recovery: RecoveryStatus; callbackError?: boolean }

// Retain callback shape, never callback credentials or raw provider errors.
export function callbackIntent(url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1))
  const has = (key: string) => hash.has(key) || url.searchParams.has(key)
  const type = hash.get('type') ?? url.searchParams.get('type')
  return {
    recovery: type === 'recovery' || (url.pathname === '/reset-password' &&
      ['access_token', 'refresh_token', 'code', 'token_hash', 'error', 'error_code'].some(has)) ||
      (url.pathname === '/' && ['error', 'error_code'].some(has)),
    callback: ['access_token', 'refresh_token', 'code', 'token_hash', 'error', 'error_code'].some(has),
  }
}
const sensitiveParams = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'expires_in', 'expires_at', 'token_type', 'token', 'token_hash', 'code', 'error', 'error_code', 'error_description', 'type']
export function cleanCallbackUrl(url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1))
  const authHash = sensitiveParams.some(key => hash.has(key))
  for (const key of sensitiveParams) url.searchParams.delete(key)
  if (authHash) url.hash = ''
  return url.pathname + url.search + url.hash
}
function sessionIdentity(session: Session | null) {
  if (!session) return null
  try {
    const raw = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(raw)) as { session_id?: string }
    return claims.session_id ? { userId: session.user.id, sessionId: claims.session_id } : null
  } catch { return null }
}

// Installed once at client creation, before React/StrictMode. The SDK alone
// consumes implicit callbacks; application code never exchanges a code/token.
export function createAuthState(auth: {
  onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => { data: { subscription: { unsubscribe: () => void } } }
  initialize: () => Promise<{ error: unknown }>
  getSession: () => Promise<{ data: { session: Session | null }; error?: unknown }>
}, browser: { url: () => URL; replace: (path: string) => void; storage: Storage }) {
  const initial = callbackIntent(browser.url())
  const markerKey = 'watchschedule.password-recovery'
  let state: SessionState = { session: null, loading: true, recovery: initial.recovery ? 'processing' : 'none' }
  const listeners = new Set<() => void>()
  let disposed = false
  const publish = (patch: Partial<SessionState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  const clearMarker = () => { try { browser.storage.removeItem(markerKey) } catch { /* Storage may be unavailable. */ } }
  const remember = (session: Session | null) => {
    const identity = sessionIdentity(session)
    try {
      if (identity) browser.storage.setItem(markerKey, JSON.stringify(identity))
      else clearMarker()
    } catch { /* Recovery still works without refresh persistence. */ }
  }
  const remembered = (session: Session | null) => {
    const identity = sessionIdentity(session)
    try { return !!identity && browser.storage.getItem(markerKey) === JSON.stringify(identity) } catch { return false }
  }
  const { data } = auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      remember(session)
      publish({ session, recovery: 'ready', callbackError: false })
    } else if (event === 'SIGNED_OUT') {
      clearMarker()
      publish({ session: null, recovery: 'none', callbackError: false })
    } else {
      const previous = sessionIdentity(state.session)
      const current = sessionIdentity(session)
      const sameSession = !!previous && !!current && previous.userId === current.userId && previous.sessionId === current.sessionId
      const keep = state.recovery === 'ready' && (sameSession || remembered(session))
      if (!keep && !state.loading) clearMarker()
      publish({ session, recovery: state.loading ? state.recovery : keep ? 'ready' : 'none' })
    }
  })
  const ready = (async () => {
    try {
      const initialized = await auth.initialize()
      const { data, error } = await auth.getSession()
      // auth-js schedules PASSWORD_RECOVERY after initialization. Let that
      // event run BEFORE exposing the session to ordinary route guards.
      await new Promise(resolve => setTimeout(resolve, 0))
      if (initialized.error || error) {
        clearMarker()
        publish({ session: data.session, recovery: initial.recovery ? 'invalid' : 'none', callbackError: true, loading: false })
      } else {
        const recovery = state.recovery === 'ready' || (!initial.callback && remembered(data.session))
        publish({ session: data.session, recovery: recovery ? 'ready' : initial.recovery ? 'invalid' : 'none', loading: false })
      }
    } catch {
      clearMarker()
      publish({ session: null, recovery: initial.recovery ? 'invalid' : 'none', callbackError: true, loading: false })
    } finally {
      browser.replace(cleanCallbackUrl(browser.url()))
    }
  })()
  return {
    ready, getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    clearRecovery: () => { clearMarker(); publish({ recovery: 'none', callbackError: false }) },
    setUser: (user: User) => { if (state.session?.user.id === user.id) publish({ session: { ...state.session, user } }) },
    dispose: () => { disposed = true; data.subscription.unsubscribe(); listeners.clear() },
  }
}
