// /payment-required — flow state (no top-bar nav). Plan selection + Stripe
// checkout is built in Phase 3; this Phase 2 placeholder proves the gate landed
// an authed, unpaid user here. Includes sign-out so the flow is never a trap.
import { useAuth } from '../auth/AuthGate'

export default function PaymentRequired() {
  const { profile, signOut } = useAuth()
  return (
    <main className="flex min-h-full items-center justify-center bg-ws-navy-deep p-ws-5">
      <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 shadow-ws-lg">
        <p className="ws-eyebrow">— Subscription required</p>
        <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
          Choose your watch plan
        </h1>
        <p className="mt-ws-3 text-ws-base text-ws-text-muted">
          You're signed in but don't have an active subscription yet. Plan
          selection &amp; Stripe checkout arrive in Phase 3.
        </p>
        <p className="mt-ws-4 font-mono text-ws-xs text-ws-text-faint">
          payment_status: {profile?.payment_status ?? '—'}
        </p>
        <button
          type="button"
          onClick={signOut}
          className="mt-ws-5 text-ws-sm font-medium text-ws-gold hover:text-ws-gold-bright"
        >
          Sign out
        </button>
      </div>
    </main>
  )
}
