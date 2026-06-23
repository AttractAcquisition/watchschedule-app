// The gate decision — pure, framework-free, and the single source of truth for
// auth -> payment -> onboarding -> app routing (frontend.md §2). Both the React
// <AuthGate> and the Phase 2 verification harness import THIS function, so the
// proof exercises the exact logic the app runs. RLS is the real access gate;
// this only decides which screen to show (UX).

import type { Database } from '../types/db'

type Profile = Database['public']['Tables']['profiles']['Row']

// The four mutually-exclusive zones a user can be in.
export type GateZone = 'login' | 'payment' | 'onboarding' | 'app'

// Canonical landing path for each zone. Within 'app', both /dashboard and
// /settings are valid; /dashboard is the default landing.
export const ZONE_PATH: Record<GateZone, string> = {
  login: '/login',
  payment: '/payment-required',
  onboarding: '/onboarding',
  app: '/dashboard',
}

// Given a resolved profile, which zone is the user in?
//   payment_status !== 'active'      -> payment   (unpaid / past_due / canceled)
//   active & !onboarding_complete    -> onboarding
//   active & onboarding_complete     -> app
export function zoneForProfile(
  profile: Pick<Profile, 'payment_status' | 'onboarding_complete'>
): Exclude<GateZone, 'login'> {
  if (profile.payment_status !== 'active') return 'payment'
  if (!profile.onboarding_complete) return 'onboarding'
  return 'app'
}

// Full resolution including the no-session case.
export function resolveZone(
  hasSession: boolean,
  profile: Pick<Profile, 'payment_status' | 'onboarding_complete'> | null | undefined
): GateZone {
  if (!hasSession) return 'login'
  if (!profile) return 'payment' // defensive; the bootstrap trigger guarantees a profile
  return zoneForProfile(profile)
}
