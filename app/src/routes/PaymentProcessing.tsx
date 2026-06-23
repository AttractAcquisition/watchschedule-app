// /payment-processing — Confirmation wait (frontend.md §4.3).
// Stripe success_url returns here. We watch the caller's profile row via
// Supabase Realtime (with a ~2s poll fallback) until payment_status flips to
// 'active' — written ONLY by the webhook — then the gate re-resolves and routes
// to /onboarding. We never claim failure: after ~60s we show a calm "still
// processing" note (the webhook may simply be delayed).
//
// The advance is gate-driven: once the profile cache shows 'active', this route
// (in the RequireZone="payment" group) no longer matches the user's zone, so
// RequireZone redirects to /onboarding. We invalidate the profile query to make
// that happen, and also navigate explicitly as belt-and-braces.
//
// PENDING VERIFICATION: the Realtime-driven advance is unverified until the
// webhook is live in Stripe test mode. See PHASE3_PENDING.md.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuth } from '../auth/AuthGate'
import { profileQueryKey } from '../auth/useProfile'

const TIMEOUT_MS = 60_000
const POLL_MS = 2_000

export default function PaymentProcessing() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const userId = session?.user?.id
  const [timedOut, setTimedOut] = useState(false)

  // Once the profile shows active, leave for onboarding (gate would also do this).
  useEffect(() => {
    if (profile?.payment_status === 'active') {
      navigate('/onboarding', { replace: true })
    }
  }, [profile?.payment_status, navigate])

  useEffect(() => {
    if (!userId) return
    const refreshProfile = () =>
      queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })

    // Fast path: Realtime on this user's profile row.
    const channel = supabase
      .channel(`payment-processing:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          if ((payload.new as { payment_status?: string }).payment_status === 'active') {
            refreshProfile()
          }
        }
      )
      .subscribe()

    // Fallback: poll the profile every ~2s in case Realtime isn't delivered.
    const poll = window.setInterval(refreshProfile, POLL_MS)
    const timeout = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS)

    return () => {
      supabase.removeChannel(channel)
      window.clearInterval(poll)
      window.clearTimeout(timeout)
    }
  }, [userId])

  return (
    <main className="flex min-h-full items-center justify-center bg-ws-navy-deep p-ws-5">
      <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 text-center shadow-ws-lg">
        <p className="ws-eyebrow">— Confirming subscription</p>
        <h1 className="mt-ws-2 flex items-center justify-center gap-ws-2 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">
          {!timedOut && <Loader2 className="h-5 w-5 animate-spin text-ws-gold" aria-hidden />}
          Confirming your subscription…
        </h1>

        {!timedOut ? (
          <p className="mt-ws-3 text-ws-base text-ws-text-muted">
            We're finalising your plan with Stripe. This usually takes a few
            seconds — you'll be taken to onboarding automatically.
          </p>
        ) : (
          <p className="mt-ws-3 text-ws-base text-ws-text-muted">
            This is taking a little longer than usual. Your payment is safe — the
            confirmation can lag by a moment. Leave this page open, or refresh
            shortly. If it persists, contact support and we'll sort it out.
          </p>
        )}

        <p className="mt-ws-5 font-mono text-ws-xs text-ws-text-faint">
          payment_status: {profile?.payment_status ?? '—'}
        </p>
      </div>
    </main>
  )
}
