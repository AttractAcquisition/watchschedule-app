-- Phase 1 · Step 5 — Row-Level Security (backend.md §3)
-- Enable RLS on EVERY table, then add policies. With RLS enabled and no matching
-- policy for an action, that action is DENIED — this is how the server-written
-- tables stay SELECT-only for clients (no write policy = no client writes; the
-- service-role client used by Edge Functions bypasses RLS entirely).

alter table vessels            enable row level security;
alter table profiles           enable row level security;
alter table crew_members       enable row level security;
alter table watch_settings     enable row level security;
alter table watch_lanes        enable row level security;
alter table schedules          enable row level security;
alter table watch_assignments  enable row level security;
alter table fairness_ledger    enable row level security;
alter table fairness_events    enable row level security;
alter table storage_uploads    enable row level security;
alter table chat_messages      enable row level security;

-- vessels — owner-scoped (keyed on auth.uid() directly).
create policy "vessels_rw_own" on vessels
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- profiles — user reads/updates own row. Gate columns (payment_status,
-- product_tier, stripe_*) are made immutable to clients by the trigger guard in
-- Step 6, not by RLS. No INSERT/DELETE policy: client cannot create or remove a
-- profile (the new-user trigger does that, service-definer).
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());
create policy "profiles_update_own_safe" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- Vessel-scoped tables with full client RW (scoped to the caller's vessel).
create policy "crew_rw_own_vessel" on crew_members
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());

create policy "watch_settings_rw_own_vessel" on watch_settings
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());

create policy "watch_lanes_rw_own_vessel" on watch_lanes
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());

create policy "storage_uploads_rw_own_vessel" on storage_uploads
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());

create policy "chat_messages_rw_own_vessel" on chat_messages
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());

-- Server-written tables — SELECT only for clients. Writes are performed by Edge
-- Functions via service-role (which bypasses RLS). Deliberately NO insert/update/
-- delete policy here, so any client write is denied.
create policy "schedules_select_own_vessel" on schedules
  for select using (vessel_id = current_vessel_id());

create policy "watch_assignments_select_own_vessel" on watch_assignments
  for select using (vessel_id = current_vessel_id());

create policy "fairness_ledger_select_own_vessel" on fairness_ledger
  for select using (vessel_id = current_vessel_id());

create policy "fairness_events_select_own_vessel" on fairness_events
  for select using (vessel_id = current_vessel_id());
