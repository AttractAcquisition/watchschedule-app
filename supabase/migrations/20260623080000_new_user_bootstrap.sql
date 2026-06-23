-- Phase 1 · Step 7b — New-user bootstrap (master.md Phase 2 prep)
--
-- CHOSEN APPROACH: a DB trigger on auth.users INSERT (handle_new_user), NOT a
-- client/first-login bootstrap. Rationale: it guarantees that the moment a user
-- signs up, exactly one vessels row and one profiles row exist for them,
-- atomically and server-side. This keeps the auth->payment->onboarding gate
-- deterministic (the gate always finds a profile), removes any client-side
-- bootstrap race, and means the client never needs write access to create these
-- rows. SECURITY DEFINER lets it insert past RLS; search_path is pinned.
--
-- Phase 2 wires the client side (it only reads the profile the gate resolves).

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.vessels (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing
  returning id into v_id;

  -- If the vessel already existed (idempotent re-run), fetch its id.
  if v_id is null then
    select id into v_id from public.vessels where owner_id = new.id;
  end if;

  insert into public.profiles (id, vessel_id, email)
  values (new.id, v_id, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
