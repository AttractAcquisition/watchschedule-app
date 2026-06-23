// /settings — crew management + the shared WatchSettingsForm + billing are
// built in Phase 11. Phase 2 placeholder: renders inside the AppShell to prove
// the second (and only other) authenticated nav destination is reachable.
export default function Settings() {
  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      <p className="ws-eyebrow">— Settings</p>
      <h1 className="mt-ws-1 font-display text-ws-xl tracking-ws-tight text-ws-offwhite">
        Crew &amp; watch settings
      </h1>
      <p className="mt-ws-3 text-ws-base text-ws-text-muted">
        Crew CRUD, watch settings and billing arrive in Phase 11.
      </p>
    </section>
  )
}
