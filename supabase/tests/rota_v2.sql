-- Run inside a transaction and roll back: no customer rows are changed.
-- This file assumes the V2 migration is installed.
do $$
declare
 u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); v uuid; other_v uuid;
 c uuid; other_c uuid; l uuid; other_l uuid; rev bigint; sid uuid; current_sid uuid;
 cfg jsonb := '{"horizon_weeks":4,"schedule_start_date":"2026-09-22","include_weekends":true,"weekday_rotation_anchor":0,"weekend_rotation_anchor":0,"weekend_structure":"per_day"}';
 pools jsonb := '[{"departments":["deck","interior"]},{"departments":["deck","officer"]},{"departments":["engineering"]}]';
 p jsonb;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'rota-test-'||u||'@example.invalid','{}'),(other_u,'rota-test-'||other_u||'@example.invalid','{}');
 select vessel_id into v from profiles where id=u;
 select vessel_id into other_v from profiles where id=other_u;
 update profiles set payment_status='active',product_tier='triple' where id in(u,other_u);
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Test crew','Deckhand','deck') returning id into c;
 insert into crew_members(vessel_id,full_name,position,department) values(other_v,'Other crew','Deckhand','deck') returning id into other_c;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform save_watch_configuration(cfg,pools);
 if (select count(*) from watch_lanes where vessel_id=v and active)<>3 then raise exception 'TEST: three lanes missing'; end if;
 if (select count(*) from lane_departments where vessel_id=v and department='deck')<>2 then raise exception 'TEST: overlap missing'; end if;
 select id into l from watch_lanes where vessel_id=v and position=1;
 -- Changes are atomic, even if invalid data fails late in the request.
 begin
   perform save_watch_configuration(cfg||'{"horizon_weeks":99}',jsonb_build_array(jsonb_build_object('id',l,'departments',jsonb_build_array('officer'))));
   raise exception 'TEST: invalid horizon accepted';
 exception when check_violation then null; end;
 if (select count(*) from watch_lanes where vessel_id=v and active)<>3 then raise exception 'TEST: configuration partly saved'; end if;
 -- Different vessel lane identities are refused.
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 perform save_watch_configuration(cfg,'[{"departments":["deck"]}]');
 select id into other_l from watch_lanes where vessel_id=other_v and active;
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin
   perform save_watch_configuration(cfg,jsonb_build_array(jsonb_build_object('id',other_l,'departments',jsonb_build_array('deck'))));
   raise exception 'TEST: foreign lane accepted';
 exception when raise_exception then
   if sqlerrm<>'Invalid lane identity' then raise; end if;
 end;
 -- Triple may run just one lane; a solo subscription cannot run two.
 perform save_watch_configuration(cfg,jsonb_build_array(jsonb_build_object('id',l,'departments',jsonb_build_array('deck','officer','engineering','interior'))));
 if (select count(*) from watch_lanes where vessel_id=v and active)<>1 then raise exception 'TEST: partial lane use failed'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 update profiles set product_tier='solo' where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin
   perform save_watch_configuration(cfg,'[{"departments":["deck"]},{"departments":["interior"]}]');
   raise exception 'TEST: solo got two lanes';
 exception when raise_exception then
   if sqlerrm<>'Invalid active lane count' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub','',true);
 -- Server publish checks ownership, duplicate crew/day and optimistic revision.
 select rota_revision into rev from vessels where id=v;
 p:=jsonb_build_object('start_date','2026-09-22','end_date','2026-10-19','horizon_weeks',4,'snapshot','{}'::jsonb,'events','[]'::jsonb,'scores','[]'::jsonb,
 'assignments',jsonb_build_array(jsonb_build_object('lane_id',l,'crew_id',c,'watch_date','2026-09-22','day_type','weekday','is_friday',false)));
 sid:=publish_rota(v,rev,p);
 begin
   perform publish_rota(v,rev,p);
   raise exception 'TEST: stale publish accepted';
 exception when raise_exception then
   if sqlerrm<>'Configuration changed during generation. Please try again.' then raise; end if;
 end;
 select rota_revision into rev from vessels where id=v;
 begin
   perform publish_rota(v,rev,jsonb_set(p,'{assignments}',(p->'assignments')||(p->'assignments')));
   raise exception 'TEST: double booking accepted';
 exception when raise_exception then
   if sqlerrm<>'Duplicate daily crew assignment' then raise; end if;
 end;
 begin
   perform publish_rota(v,rev,jsonb_set(p,'{assignments,0,crew_id}',to_jsonb(other_c)));
   raise exception 'TEST: foreign crew accepted';
 exception when raise_exception then
   if sqlerrm<>'Invalid assignment owner' then raise; end if;
 end;
 select id into current_sid from schedules where vessel_id=v and is_current;
 if current_sid<>sid then raise exception 'TEST: failed publish damaged current schedule'; end if;
 insert into vessel_fairness(vessel_id,crew_id,total_watches) values(v,c,1),(other_v,other_c,1);
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 if (select count(*) from vessel_fairness)<>1 then raise exception 'TEST: cross-vessel fairness leak'; end if;
 begin
   update watch_lanes set active=false where vessel_id=v;
   raise exception 'TEST: direct client configuration write accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform publish_rota(v,rev,p);
   raise exception 'TEST: authenticated publish accepted';
 exception when insufficient_privilege then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub','',true);
end $$;
