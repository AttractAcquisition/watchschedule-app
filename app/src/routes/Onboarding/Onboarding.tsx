// /onboarding — flow state. The 3-step wizard (Crew · Settings · Generate) is
// built in Phases 4–7. This Phase 2 placeholder proves the gate landed a paid,
// not-yet-onboarded user here AND resumes at the correct step (frontend.md §5):
// onboarding_step drives which step is highlighted.
import { useAuth } from '../../auth/AuthGate'
import type { Database } from '../../types/db'

type Step = Database['public']['Enums']['onboarding_step']

const STEPS: { key: Step; label: string }[] = [
  { key: 'crew', label: 'Crew' },
  { key: 'settings', label: 'Settings' },
  { key: 'generate', label: 'Generate' },
]

export default function Onboarding() {
  const { profile, signOut } = useAuth()
  const current = profile?.onboarding_step ?? 'crew'

  return (
    <main className="flex min-h-full items-center justify-center bg-ws-navy-deep p-ws-5">
      <div className="w-full max-w-lg rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 shadow-ws-lg">
        <p className="ws-eyebrow">— Onboarding</p>
        <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
          Set up your watch rotation
        </h1>

        <ol className="mt-ws-5 flex items-center gap-ws-3">
          {STEPS.map((s, i) => {
            const active = s.key === current
            return (
              <li key={s.key} className="flex items-center gap-ws-3">
                <span
                  className={[
                    'flex items-center gap-ws-2 rounded-ws-sm px-ws-3 py-ws-2 font-mono text-ws-sm',
                    active
                      ? 'bg-ws-steel-3 text-ws-gold shadow-ws-glow-gold'
                      : 'text-ws-text-muted',
                  ].join(' ')}
                >
                  <span>{i + 1}</span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="text-ws-text-faint" aria-hidden>
                    ·
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        <p className="mt-ws-5 text-ws-base text-ws-text-muted">
          Resumed at step:{' '}
          <span className="font-mono text-ws-gold">{current}</span>. The wizard
          screens are built in Phases 4–7.
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
