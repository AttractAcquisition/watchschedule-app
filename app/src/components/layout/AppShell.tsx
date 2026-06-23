// App shell (branding.md §7): top bar + centred, padded content well on the
// navy-deep base. Wraps the authenticated app pages (Dashboard, Settings) as a
// React Router layout route. Payment/onboarding flow states render without it.
import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'

export default function AppShell() {
  return (
    <div className="min-h-full bg-ws-navy-deep">
      <TopBar />
      <main className="mx-auto max-w-[1200px] px-ws-5 py-ws-6">
        <Outlet />
      </main>
    </div>
  )
}
