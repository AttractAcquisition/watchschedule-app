// TanStack Query (React Query) client — the single store for all server data
// (crew, settings, schedule, fairness, subscription) per frontend.md §1.
// Local UI state stays in hooks/context; no Redux.
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Server data is RLS-scoped and changes via deliberate actions
      // (generate, regenerate, edits) — modest caching, no noisy refetch.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
