-- The captain's "who goes first" order (docs/fairness.md §7, 28 November 2026).
--
-- Tester feedback: "choose who to favour on the fairness calculator — assign the
-- greenest crew to the least fair slot, or the least fair to me". When the
-- fairness cost rates crew as equally owed, the engine used to fall back on
-- crew-id order, which a captain can neither see nor change (the numeric
-- rotation anchors only rotated that hidden list). This stores an explicit
-- order: first = takes the extra watch first.
--
-- Stored on watch_settings, not crew_members, so the whole order saves in one
-- atomic write, and so saving it bumps watch_settings.updated_at — the
-- dashboard's existing "settings changed since the last generation" notice then
-- tells the captain to regenerate. Crew added later simply follow the list; a
-- deleted crew member's id is ignored by the engine, so no cascade is needed.
--
-- watch_settings is SELECT-only for the client (master.md §2 invariant 2), so
-- the write goes through a narrow RPC, the set_generation_window pattern.

alter table watch_settings
  add column if not exists rota_priority uuid[] not null default '{}';

create or replace function set_rota_priority(p_order uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select vessel_id into v from profiles
   where id = auth.uid() and payment_status = 'active';
  if v is null then raise exception 'Active subscription required'; end if;
  perform 1 from vessels where id = v and owner_id = auth.uid() for update;
  if not found then raise exception 'Vessel not found'; end if;

  p_order := coalesce(p_order, '{}');
  if cardinality(p_order) > 200 then
    raise exception 'That order lists too many crew.';
  end if;
  if cardinality(p_order) <> (select count(distinct x) from unnest(p_order) x) then
    raise exception 'Each crew member can appear in the order only once.';
  end if;
  if exists (
    select 1 from unnest(p_order) x
     where not exists (select 1 from crew_members c where c.id = x and c.vessel_id = v)
  ) then
    raise exception 'The order names someone who is not in your crew.';
  end if;

  update watch_settings set rota_priority = p_order where vessel_id = v;
  if not found then raise exception 'Configure your watch lanes first.'; end if;
end $$;

revoke all on function set_rota_priority(uuid[]) from public, anon;
grant execute on function set_rota_priority(uuid[]) to authenticated;
