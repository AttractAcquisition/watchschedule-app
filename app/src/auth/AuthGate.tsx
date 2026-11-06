// <AuthGate> — the spine of the app (frontend.md §2). One AuthProvider resolves
// session + profile once and shares the result; route guards consume it.
//
// Resolution: getSession -> no session => 'login'. Session => read profile,
// branch on payment_status then onboarding_complete (see auth/gate.ts).
//
// Two invariants baked in here:
//  - RLS is the real gate; these guards are UX only.
//  - While resolving we render a calm loader, never /login — so a hard refresh
//    on an authed route does NOT flash to login before re-resolving.
import { createContext, useContext, useCallback, useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useSession } from './useSession'
import { useProfile, type Profile } from './useProfile'
import { resolveZone, ZONE_PATH, type GateZone } from './gate'
import { authState, supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { profileQueryKey } from './useProfile'
import type { RecoveryStatus } from './authState'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  zone: GateZone
  initializing: boolean
  recovery: RecoveryStatus
  callbackError: boolean
  clearRecovery: () => void
  refreshUser: () => Promise<void>
  signOut: (scope?: 'global' | 'local') => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading, recovery, callbackError } = useSession()
  const userId = session?.user?.id
  const { data: profile, isLoading: profileLoading } = useProfile(userId)

  // Loading while the session resolves, or while a signed-in user's profile is
  // still being fetched. Either way the guards show a loader (not /login).
  const loading = sessionLoading || (!!userId && profileLoading)

  const signOut = useCallback(async (scope: 'global' | 'local' = 'global') => {
    const { error } = await supabase.auth.signOut({ scope })
    if (error) throw error
    authState.clearRecovery()
    queryClient.clear() // drop cached profile so no stale gate state survives
  }, [])

  const refreshUser = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    if (data.user) {
      authState.setUser(data.user)
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(data.user.id) })
    }
  }, [])
  useEffect(() => {
    if (!userId || sessionLoading) return
    const refresh = () => { void refreshUser().catch(() => { /* Forms report actionable session errors. */ }) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [userId, sessionLoading, refreshUser])

  const zone = resolveZone(!!session, profile)

  return (
    <AuthContext.Provider
      value={{ loading, initializing: sessionLoading, recovery, callbackError: !!callbackError, clearRecovery: authState.clearRecovery,
        session, profile: profile ?? null, zone, signOut, refreshUser }}
    >
      <RecoveryBoundary>{children}</RecoveryBoundary>
    </AuthContext.Provider>
  )
}

// Includes legacy recovery links landing at /. It wraps ALL ordinary guards,
// so no generic authenticated redirect can take precedence over recovery.
export function RecoveryBoundary({ children }: { children: ReactNode }) {
  const { initializing, recovery } = useAuth()
  const location = useLocation()
  if (initializing || recovery === 'processing') return <GateLoader />
  if ((recovery === 'ready' || recovery === 'invalid') && location.pathname !== '/reset-password')
    return <Navigate to="/reset-password" replace />
  return <>{children}</>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

// Calm full-screen resolving state. Token-only styling (branding.md).
export function GateLoader() {
  return (
    <div className="flex min-h-full items-center justify-center bg-ws-navy-deep">
      <p className="ws-eyebrow animate-pulse">— Resolving session</p>
    </div>
  )
}

// Guards a route group: the user must be in `zone` to enter. Otherwise we send
// them to the canonical path for the zone they ARE in. Unauthenticated users go
// to /login. Used as a layout route element (renders <Outlet/> when allowed).
export function RequireZone({ zone }: { zone: GateZone }) {
  const { loading, session, zone: userZone } = useAuth()
  const location = useLocation()

  if (loading) return <GateLoader />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (userZone !== zone) return <Navigate to={ZONE_PATH[userZone]} replace />
  return <Outlet />
}

// Catch-all: bounce to wherever the gate says this user belongs.
export function GateRedirect() {
  const { loading, session, zone } = useAuth()
  if (loading) return <GateLoader />
  return <Navigate to={session ? ZONE_PATH[zone] : '/login'} replace />
}
