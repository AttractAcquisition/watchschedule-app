-- Phase 1 · Step 7 — Storage buckets + policies (backend.md §4)
-- Two PRIVATE buckets. Object path convention: {vessel_id}/{uuid}.{ext}.
-- Storage RLS (already enabled on storage.objects by Supabase) restricts a user
-- to objects whose first path segment is their own vessel_id. Edge Functions
-- read these via service-role to pass to Claude vision.

insert into storage.buckets (id, name, public)
  values ('crew-lists', 'crew-lists', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('past-schedules', 'past-schedules', false)
  on conflict (id) do nothing;

create policy "crew_lists_rw_own_vessel"
on storage.objects for all to authenticated
using (bucket_id = 'crew-lists' and (storage.foldername(name))[1] = current_vessel_id()::text)
with check (bucket_id = 'crew-lists' and (storage.foldername(name))[1] = current_vessel_id()::text);

create policy "past_schedules_rw_own_vessel"
on storage.objects for all to authenticated
using (bucket_id = 'past-schedules' and (storage.foldername(name))[1] = current_vessel_id()::text)
with check (bucket_id = 'past-schedules' and (storage.foldername(name))[1] = current_vessel_id()::text);
