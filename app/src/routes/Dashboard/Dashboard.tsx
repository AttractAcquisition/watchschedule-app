// /dashboard — the product (FairnessPanel + WatchCalendar + chatbot) is built
// in Phases 9–10. Phase 2 placeholder: renders inside the AppShell to prove the
// gate landed a paid, onboarded user here.
import { useAuth } from '../../auth/AuthGate'

export default function Dashboard() {
  const { profile } = useAuth()
  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      <p className="ws-eyebrow">— Dashboard</p>
      <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
        Watch overview
      </h1>
      <p className="mt-ws-3 text-ws-base text-ws-text-muted">
        Fairness panel, watch calendar and the Claude chatbot arrive in Phases
        9–10.
      </p>
      <p className="mt-ws-4 font-mono text-ws-xs text-ws-text-faint">
        tier: {profile?.product_tier ?? '—'} · onboarding_complete:{' '}
        {String(profile?.onboarding_complete)}
      </p>
    </section>
  )
}
