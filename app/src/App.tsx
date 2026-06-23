// PHASE 0 THROWAWAY VERIFICATION VIEW.
// Proves the branding.md token pipeline end-to-end: every colour, font, space,
// radius and shadow below is a token-based Tailwind utility (bg-ws-*, text-ws-*,
// font-*, p-ws-*, rounded-ws-*, shadow-ws-*) — ZERO raw hex. It also exercises
// all four font families and confirms the shared Supabase client initialises.
// Replaced by the real router + AuthGate in Phase 2 (frontend.md §2/§3).
import { supabase } from './lib/supabase'

// Touch the client so the import is exercised and TS keeps it. supabase-js sets
// auth.storageKey to `sb-<ref>-auth-token`; reading it confirms the client
// initialised from env without making a network call.
const clientReady = Boolean(supabase.auth)

const fonts = [
  { label: 'Inter Tight — display / headings', className: 'font-display' },
  { label: 'Manrope — alternate display', className: 'font-display', style: { fontFamily: 'Manrope, sans-serif' } },
  { label: 'Inter — body / UI', className: 'font-ui' },
  { label: 'JetBrains Mono — data / scores', className: 'font-mono' },
]

const fairness = [
  { name: 'A. Marsh', code: 'AM', score: 92, fill: 'bg-ws-fair-high' },
  { name: 'B. Keating', code: 'BK', score: 78, fill: 'bg-ws-fair-mid' },
  { name: 'C. Devlin', code: 'CD', score: 61, fill: 'bg-ws-fair-low' },
]

export default function App() {
  return (
    <main className="min-h-full bg-ws-navy-deep p-ws-6 font-ui text-ws-text">
      <div className="mx-auto max-w-3xl">
        <p className="ws-eyebrow">— WatchSchedule · Phase 0</p>
        <h1 className="mt-ws-2 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
          Token &amp; font pipeline
        </h1>
        <p className="mt-ws-1 text-ws-base text-ws-text-muted">
          Throwaway verification view — token-based Tailwind utilities only, no raw hex.
        </p>

        {/* Card: font families */}
        <section className="mt-ws-5 rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
          <p className="ws-eyebrow">Font families</p>
          <ul className="mt-ws-3 space-y-ws-2">
            {fonts.map((f) => (
              <li key={f.label} className={`${f.className} text-ws-md text-ws-text`} style={f.style}>
                {f.label} — The quick brown fox 0123456789
              </li>
            ))}
          </ul>
        </section>

        {/* Card: fairness gauge — proves the locked gauge scale tokens */}
        <section className="mt-ws-4 rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
          <p className="ws-eyebrow">Fairness gauge scale</p>
          <ul className="mt-ws-3 space-y-ws-3">
            {fairness.map((c) => (
              <li key={c.code} className="flex items-center gap-ws-3">
                <span className="inline-flex h-ws-6 w-ws-6 items-center justify-center rounded-ws-sm bg-ws-steel-3 font-mono text-ws-sm text-ws-gold">
                  {c.code}
                </span>
                <span className="w-32 text-ws-sm text-ws-text-muted">{c.name}</span>
                <span className="flex-1">
                  <span className="block h-2 rounded-ws-full bg-ws-steel-inset">
                    <span
                      className={`block h-2 rounded-ws-full ${c.fill}`}
                      style={{ width: `${c.score}%` }}
                    />
                  </span>
                </span>
                <span className="font-mono text-ws-md tracking-ws-mono text-ws-offwhite">{c.score}%</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Card: accent + status swatches + live element glow */}
        <section className="mt-ws-4 rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
          <p className="ws-eyebrow">Accent &amp; status</p>
          <div className="mt-ws-3 flex flex-wrap items-center gap-ws-3">
            <button className="rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 font-ui font-semibold text-ws-text-on-gold shadow-ws-glow-gold">
              Generate watch schedule
            </button>
            <button className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 font-ui text-ws-text">
              Secondary
            </button>
            <span className="inline-flex items-center gap-ws-2 text-ws-sm text-ws-text-muted">
              <span className="inline-block h-2 w-2 rounded-ws-full bg-ws-ok" /> intact
            </span>
            <span className="inline-flex items-center gap-ws-2 text-ws-sm text-ws-text-muted">
              <span className="inline-block h-2 w-2 rounded-ws-full bg-ws-warn" /> paused
            </span>
            <span className="inline-flex items-center gap-ws-2 text-ws-sm text-ws-text-muted">
              <span className="inline-block h-2 w-2 rounded-ws-full bg-ws-alert" /> conflict
            </span>
          </div>
        </section>

        <p className="mt-ws-4 font-mono text-ws-xs tracking-ws-mono text-ws-text-faint">
          supabase client initialised: {String(clientReady)} · path: {window.location.pathname}
        </p>
      </div>
    </main>
  )
}
