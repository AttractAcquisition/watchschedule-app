import { useSyncExternalStore } from 'react'
import { authState } from '../lib/supabase'

export function useSession() {
  return useSyncExternalStore(authState.subscribe, authState.getSnapshot)
}
