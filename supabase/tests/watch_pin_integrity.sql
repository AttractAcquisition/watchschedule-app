-- Run with BEGIN/ROLLBACK. Only synthetic users/vessels are touched.
do $$
declare
 u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); v uuid; other_v uuid;
 c uuid; other_c uuid; l uuid; other_l uuid; pin uuid; rev bigint;
 cfg jsonb := '{"horizon_weeks":1,"schedule_start_date":"2026-11-06","include_weekends":true,"weekday_rotation_anchor":0,"weekend_rotation_anchor":0,"weekend_structure":"per_day"}';
begin
 insert into auth.users(id,email,raw_user_meta_data) values
 (u,'pin-test-'||u||'@example.invalid','{}'),(other_u,'pin-test-'||other_u||'@example.invalid','{}');
 select vessel_id into v from profiles where id=u;
 select vessel_id into other_v from profiles where id=other_u;
 update profiles set payment_status='active',product_tier='solo' where id in(u,other_u);
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Pin test','Deckhand','deck') returning id into c;
 insert into crew_members(vessel_id,full_name,position,department) values(other_v,'Other pin test','Deckhand','deck') returning id into other_c;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform save_watch_configuration(cfg,'[{"departments":["deck"]}]');
 select id into l from watch_lanes where vessel_id=v and active;
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 perform save_watch_configuration(cfg,'[{"departments":["deck"]}]');
 select id into other_l from watch_lanes where vessel_id=other_v and active;
 perform set_config('request.jwt.claim.sub',u::text,true);

 -- RLS permits own-vessel configuration but cannot admit foreign references.
 set local role authenticated;
 begin
  insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,other_c,l,'2026-11-06');
  raise exception 'TEST: foreign crew pin accepted';
 exception when foreign_key_violation then null; end;
 begin
  insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c,other_l,'2026-11-06');
  raise exception 'TEST: foreign lane pin accepted';
 exception when foreign_key_violation then null; end;
 select rota_revision into rev from vessels where id=v;
 insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c,l,'2026-11-06') returning id into pin;
 if (select rota_revision from vessels where id=v)<>rev+1 then raise exception 'TEST: pin insert did not invalidate generation'; end if;
 begin
  insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c,l,'2026-11-06');
  raise exception 'TEST: duplicate pin accepted';
 exception when unique_violation then null; end;
 update watch_pins set acknowledged=array['on_leave'] where id=pin;
 if (select rota_revision from vessels where id=v)<>rev+2 then raise exception 'TEST: pin consent did not invalidate generation'; end if;
 reset role;
 -- A generation calculated before those edits must fail before publishing.
 begin
  perform publish_rota(v,rev,'{}'::jsonb);
  raise exception 'TEST: stale generation accepted after pin edit';
 exception when raise_exception then
  if sqlerrm<>'Configuration changed during generation. Please try again.' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 set local role authenticated;
 if exists(select 1 from watch_pins where id=pin) then raise exception 'TEST: foreign vessel can read pin'; end if;
 delete from watch_pins where id=pin;
 reset role;
 if not exists(select 1 from watch_pins where id=pin) then raise exception 'TEST: foreign vessel deleted pin'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 delete from watch_pins where id=pin;
 if (select rota_revision from vessels where id=v)<>rev+3 then raise exception 'TEST: pin delete did not invalidate generation'; end if;
 reset role;
 perform set_config('request.jwt.claim.sub','',true);
 raise notice 'watch_pins: all assertions passed';
end $$;
