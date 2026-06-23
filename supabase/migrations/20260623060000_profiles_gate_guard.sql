-- Phase 1 · Step 6 — Profiles gate-column guard (backend.md §3, master.md §2 invariant 3)
-- payment_status, product_tier and the stripe_* columns are server-managed: only
-- stripe-webhook (service-role) may write them. RLS scopes WHICH rows a client
-- may update, but not WHICH columns; this trigger enforces column immutability.
--
-- The `when (auth.uid() is not null)` clause means the guard fires only for
-- authenticated (client/JWT) updates. Service-role connections have no JWT, so
-- auth.uid() is null and the guard is skipped — letting the webhook write gate
-- columns while clients are blocked.

create or replace function block_gate_column_writes() returns trigger as $$
begin
  if (new.payment_status is distinct from old.payment_status)
     or (new.product_tier is distinct from old.product_tier)
     or (new.stripe_customer_id is distinct from old.stripe_customer_id)
     or (new.stripe_subscription_id is distinct from old.stripe_subscription_id)
  then
     raise exception 'gate columns are server-managed';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_block_gate before update on profiles
  for each row when (auth.uid() is not null)
  execute function block_gate_column_writes();
