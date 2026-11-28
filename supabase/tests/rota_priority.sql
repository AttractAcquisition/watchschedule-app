-- Run inside a transaction and roll back: no customer rows are changed.
-- Covers set_rota_priority (migration 20261128020000): the captain's
-- "who goes first" order. The engine side is proven in _shared/rota_v2_test.ts;
-- what has to hold HERE is that the order saves atomically, only ever names the
-- caller's own crew, and that the table stays closed to direct writes.
do $$
declare
 u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid();
 v uuid; other_v uuid; c1 uuid; c2 uuid; c3 uuid; stranger uuid;
 cfg jsonb := '{"horizon_weeks":2,"schedule_start_date":"2026-12-01","include_weekends":true,"weekday_rotation_anchor":0,"weekend_rotation_anchor":0,"weekend_structure":"per_day"}';
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'prio-test-'||u||'@example.invalid','{}');
 insert into auth.users(id,email,raw_user_meta_data) values(other_u,'prio-other-'||other_u||'@example.invalid','{}');
 select vessel_id into v from profiles where id=u;
 select vessel_id into other_v from profiles where id=other_u;
 update profiles set payment_status='active',product_tier='solo' where id in (u,other_u);
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Alpha','Deckhand','deck') returning id into c1;
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Bravo','Deckhand','deck') returning id into c2;
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Charlie','Deckhand','deck') returning id into c3;
 insert into crew_members(vessel_id,full_name,position,department) values(other_v,'Stranger','Deckhand','deck') returning id into stranger;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform save_watch_configuration(cfg,'[{"departments":["deck"]}]');
 if (select rota_priority from watch_settings where vessel_id=v)<>'{}' then raise exception 'TEST: order did not default empty'; end if;

 set local role authenticated;
 perform set_rota_priority(array[c3,c1]);
 if (select rota_priority from watch_settings where vessel_id=v)<>array[c3,c1] then raise exception 'TEST: order not saved as given'; end if;
 -- Saving the order is a settings change: the dashboard's regenerate notice
 -- reads watch_settings.updated_at, kept by trg_set_updated_at. now() is fixed
 -- inside one transaction, so assert the trigger, not a moving timestamp.
 if not exists (select 1 from pg_trigger where tgrelid='public.watch_settings'::regclass and tgname='trg_set_updated_at' and not tgisinternal)
   then raise exception 'TEST: watch_settings has no updated_at trigger'; end if;

 begin perform set_rota_priority(array[c1,c1]); raise exception 'TEST: duplicate accepted';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 begin perform set_rota_priority(array[c1,stranger]); raise exception 'TEST: another vessel''s crew accepted';
 exception when others then if sqlerrm like 'TEST:%' then raise; end if; end;
 if (select rota_priority from watch_settings where vessel_id=v)<>array[c3,c1] then raise exception 'TEST: a refused order changed the saved one'; end if;

 -- Clearing it restores crew-id order (and the legacy anchors).
 perform set_rota_priority('{}');
 if (select rota_priority from watch_settings where vessel_id=v)<>'{}' then raise exception 'TEST: order not cleared'; end if;

 -- Direct writes stay closed (master.md §2 invariant 2).
 begin update watch_settings set rota_priority=array[c2] where vessel_id=v; raise exception 'TEST: direct update allowed';
 exception when insufficient_privilege then null; end;
 -- The other vessel's order is untouched by any of this.
 reset role;
 if (select rota_priority from watch_settings where vessel_id=other_v) is not null
    and (select rota_priority from watch_settings where vessel_id=other_v)<>'{}' then raise exception 'TEST: other vessel changed'; end if;
 raise notice 'rota_priority: all checks passed';
end $$;
