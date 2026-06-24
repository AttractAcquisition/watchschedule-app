// /onboarding — the 3-step wizard shell (frontend.md §4.4, §5).
// One route, internal step driven by profiles.onboarding_step (persisted
// server-side), so a refresh resumes at the furthest completed step. The gate
// only lands paid, not-yet-onboarded users here. Step 1 (Crew) is built; Steps
// 2 (Settings) and 3 (Generate) arrive in Phases 5 and 7.
import { useAuth } from '../../auth/AuthGate'
import type { Database } from '../../types/db'
import StepCrew from './StepCrew'

type Step = Database['public']['Enums']['onboarding_step']

const STEPS: { key: Exclude<Step, 'complete'>; label: string }[] = [
  { key: 'crew', label: 'Crew' },
  { key: 'settings', label: 'Settings' },
  { key: 'generate', label: 'Generate' },
]

function Placeholder({ step }: { step: 'settings' | 'generate' }) {
  const phase = step === 'settings' ? '5' : '7'
  const title = step === 'settings' ? 'Watch settings' : 'Generate your schedule'
  return (
    <div>
      <p className="ws-eyebrow">— Step {step === 'settings' ? '2 · Settings' : '3 · Generate'}</p>
      <h2 className="mt-ws-1 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">{title}</h2>
      <p className="mt-ws-3 text-ws-base text-ws-text-muted">This step is built in Phase {phase}.</p>
    </div>
  )
}

export default function Onboarding() {
  const { profile, signOut } = useAuth()
  const current: Step = profile?.onboarding_step ?? 'crew'

  return (
    <main className="min-h-full bg-ws-navy-deep px-ws-5 py-ws-7">
      <div className="mx-auto max-w-2xl">
        <p className="ws-eyebrow">— Onboarding</p>
        <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
          Set up your watch rotation
        </h1>

        {/* Progress header: 1 Crew · 2 Settings · 3 Generate */}
        <ol className="mt-ws-5 flex items-center gap-ws-3">
          {STEPS.map((s, i) => {
            const active = s.key === current
            const done = STEPS.findIndex((x) => x.key === current) > i || current === 'complete'
            return (
              <li key={s.key} className="flex items-center gap-ws-3">
                <span
                  className={[
                    'flex items-center gap-ws-2 rounded-ws-sm px-ws-3 py-ws-2 font-mono text-ws-sm',
                    active ? 'bg-ws-steel-3 text-ws-gold shadow-ws-glow-gold' : done ? 'text-ws-seagreen' : 'text-ws-text-muted',
                  ].join(' ')}
                >
                  <span>{i + 1}</span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="text-ws-text-faint" aria-hidden>·</span>}
              </li>
            )
          })}
        </ol>

        <section className="mt-ws-6 rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 shadow-ws-lg">
          {current === 'crew' && <StepCrew />}
          {current === 'settings' && <Placeholder step="settings" />}
          {(current === 'generate' || current === 'complete') && <Placeholder step="generate" />}
        </section>

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
