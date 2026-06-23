-- Phase 1 · Step 4 — current_vessel_id() helper (backend.md §3)
-- Resolves the vessel owned by the current authenticated user. SECURITY DEFINER
-- so it can read vessels regardless of the caller's RLS context; STABLE so the
-- planner can cache it within a statement. Every vessel-scoped RLS policy keys
-- off this. Returns NULL when there is no authed user / no vessel (which makes
-- vessel-scoped policies deny, the safe default).

create or replace function current_vessel_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from vessels where owner_id = auth.uid()
$$;
