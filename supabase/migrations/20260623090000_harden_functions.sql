-- Phase 1 · Step 8 — Function hardening (resolve security advisor WARNs)
-- 1) Pin search_path on the trigger helpers (they reference no schema objects,
--    so '' is safe and removes the "mutable search_path" advisory).
-- 2) handle_new_user() is a TRIGGER-only function; it must never be reachable as
--    a PostgREST RPC. Trigger invocation does not require EXECUTE, so revoking it
--    closes the /rpc/handle_new_user exposure without affecting the trigger.
--
-- current_vessel_id() intentionally keeps EXECUTE for PUBLIC: RLS policies on
-- every vessel-scoped table call it during query evaluation, and it only ever
-- returns the *caller's own* vessel id (owner_id = auth.uid()), so exposure is
-- benign by design.

alter function set_updated_at() set search_path = '';
alter function block_gate_column_writes() set search_path = '';

revoke execute on function handle_new_user() from public, anon, authenticated;
