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
import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useSession } from './useSession'
import { useProfile, type Profile } from './useProfile'
import { resolveZone, ZONE_PATH, type GateZone } from './gate'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  zone: GateZone
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user?.id
  const { data: profile, isLoading: profileLoading } = useProfile(userId)

  // Loading while the session resolves, or while a signed-in user's profile is
  // still being fetched. Either way the guards show a loader (not /login).
  const loading = sessionLoading || (!!userId && profileLoading)

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    queryClient.clear() // drop cached profile so no stale gate state survives
  }, [])

  const zone = resolveZone(!!session, profile)

  return (
    <AuthContext.Provider
      value={{ loading, session, profile: profile ?? null, zone, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
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
