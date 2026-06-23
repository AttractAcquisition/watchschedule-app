// Reads the current user's profile row — the gate's source of payment_status,
// product_tier, onboarding_step and onboarding_complete (frontend.md §2, §5).
// RLS-scoped: the select returns only the caller's own row. The bootstrap
// trigger (Phase 1) guarantees the row exists; if a just-signed-up read races
// ahead of replication we throw so React Query retries rather than mis-routing.
import { useQuery } from '@tanstack/react-query'
import type { Database } from '../types/db'
import { supabase } from '../lib/supabase'

export type Profile = Database['public']['Tables']['profiles']['Row']

export function profileQueryKey(userId: string | undefined) {
  return ['profile', userId] as const
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileQueryKey(userId),
    enabled: !!userId,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId!)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('profile-not-ready') // retry: bootstrap row not visible yet
      return data
    },
    retry: 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    staleTime: 30_000,
  })
}
