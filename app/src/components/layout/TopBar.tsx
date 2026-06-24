// Top bar (branding.md §7): logo, vessel name + size (mono), product-tier badge
// (gold outline), and the ONLY two nav items — Dashboard and Settings. Payment
// and onboarding are flow states, never nav items. User menu = sign out.
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../auth/AuthGate'
import { supabase } from '../../lib/supabase'

function useVessel(vesselId: string | null | undefined) {
  return useQuery({
    queryKey: ['vessel', vesselId],
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vessels')
        .select('name, length_m')
        .eq('id', vesselId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 60_000,
  })
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-ws-sm px-ws-3 py-ws-2 text-ws-sm font-medium transition-all',
    isActive ? 'bg-ws-steel-3 text-ws-gold' : 'text-ws-text-muted hover:text-ws-text',
  ].join(' ')

export default function TopBar() {
  const { profile, signOut } = useAuth()
  const { data: vessel } = useVessel(profile?.vessel_id)

  return (
    <header className="border-b border-ws-line bg-ws-navy">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-ws-5">
        <div className="flex items-center gap-ws-4">
          {/* Wordmark (branding.md §6): navy-background lockup, ~28px tall, sits
              seamlessly on the --ws-navy top bar. */}
          <img src="/watch-schedule-logo.png" alt="WatchSchedule" className="h-7 w-auto" />
          {vessel?.name && (
            <span className="hidden font-mono text-ws-sm text-ws-text-muted sm:inline">
              {vessel.name}
              {vessel.length_m ? ` · ${vessel.length_m}m` : ''}
            </span>
          )}
        </div>

        <nav className="flex items-center gap-ws-2">
          <NavLink to="/dashboard" className={navLink}>
            Dashboard
          </NavLink>
          <NavLink to="/settings" className={navLink}>
            Settings
          </NavLink>
          {profile?.product_tier && (
            <span className="hidden rounded-ws-full border border-ws-gold px-ws-3 py-ws-1 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-gold sm:inline">
              {profile.product_tier}
            </span>
          )}
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-ws-2 rounded-ws-sm px-ws-3 py-ws-2 text-ws-sm text-ws-text-muted transition-all hover:bg-ws-steel-2 hover:text-ws-text"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </nav>
      </div>
    </header>
  )
}
