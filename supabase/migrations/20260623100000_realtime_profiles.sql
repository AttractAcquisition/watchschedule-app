-- Phase 3: enable Supabase Realtime on `profiles`.
-- /payment-processing (frontend.md §4.3) subscribes to the caller's profile row
-- and advances to /onboarding the instant `payment_status` flips to 'active'
-- (written by stripe-webhook). Realtime respects RLS, so a subscriber only
-- receives changes to their own profile row (profiles_select_own, see RLS).
-- Idempotent: only add the table if it isn't already in the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
