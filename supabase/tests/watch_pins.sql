-- Run inside a transaction and roll back: no customer rows are changed.
-- Covers the watch_pins table (migration 20261027010000): the client-RW
-- configuration surface behind fixed watches (docs/fixed-watches.md). The rules
-- themselves are pure TypeScript and are proven in _shared/watch_pins_test.ts;
-- what has to hold HERE is tenant isolation and the two refusals the schema owns.
do $$
declare
 u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid();
 v uuid; other_v uuid; c1 uuid; c2 uuid; l1 uuid; l2 uuid; n int;
 cfg jsonb := '{"horizon_weeks":2,"schedule_start_date":"2026-11-02","include_weekends":true,"weekday_rotation_anchor":0,"weekend_rotation_anchor":0,"weekend_structure":"per_day"}';
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'pins-test-'||u||'@example.invalid','{}');
 insert into auth.users(id,email,raw_user_meta_data) values(other_u,'pins-other-'||other_u||'@example.invalid','{}');
 select vessel_id into v from profiles where id=u;
 select vessel_id into other_v from profiles where id=other_u;
 update profiles set payment_status='active',product_tier='dual' where id in (u,other_u);
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Alpha','Deckhand','deck') returning id into c1;
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Bravo','Stewardess','interior') returning id into c2;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform save_watch_configuration(cfg,'[{"departments":["deck"]},{"departments":["interior"]}]');
 select id into l1 from watch_lanes where vessel_id=v and position=1;
 select id into l2 from watch_lanes where vessel_id=v and position=2;

 -- The captain owns this table: an ordinary authenticated insert must succeed.
 insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c1,l1,'2026-11-14');
 if (select count(*) from watch_pins where vessel_id=v)<>1 then raise exception 'TEST: captain could not pin a watch'; end if;
 if (select acknowledged from watch_pins where vessel_id=v)<>'{}' then raise exception 'TEST: acknowledged did not default empty'; end if;

 -- One person, one watch a day — refused by the schema, not consented away.
 begin
   insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c1,l2,'2026-11-14');
   raise exception 'TEST: the same person was pinned twice on one day';
 exception when unique_violation then null;
 end;

 -- One person per lane-day.
 begin
   insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c2,l1,'2026-11-14');
   raise exception 'TEST: two people were pinned to one lane-day';
 exception when unique_violation then null;
 end;

 -- The same person on a DIFFERENT day, and a different lane the same day, are fine.
 insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c1,l1,'2026-11-15');
 insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c2,l2,'2026-11-14');

 -- Consent is an ordinary client write: the captain is the one consenting.
 update watch_pins set acknowledged=array['on_leave'] where vessel_id=v and crew_member_id=c1 and watch_date='2026-11-14';
 if (select acknowledged from watch_pins where vessel_id=v and crew_member_id=c1 and watch_date='2026-11-14')<>array['on_leave']
   then raise exception 'TEST: acknowledgement did not persist'; end if;

 -- RLS is the real gate: another vessel sees none of this and cannot add to it.
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 select count(*) into n from watch_pins;
 if n<>0 then raise exception 'TEST: another vessel read % pin rows', n; end if;
 if (select count(*) from watch_pins where vessel_id=v)<>0 then raise exception 'TEST: cross-vessel read succeeded'; end if;
 begin
   insert into watch_pins(vessel_id,crew_member_id,lane_id,watch_date) values(v,c1,l1,'2026-11-20');
   raise exception 'TEST: another vessel wrote a pin into this vessel';
 exception when insufficient_privilege then null;
 end;
 -- Nor can they delete what they cannot see.
 delete from watch_pins where vessel_id=v;
 perform set_config('request.jwt.claim.sub',u::text,true);
 if (select count(*) from watch_pins where vessel_id=v)<>3 then raise exception 'TEST: another vessel deleted our pins'; end if;

 -- Pins are configuration, so they follow the crew member and the lane out.
 delete from crew_members where id=c2;
 if (select count(*) from watch_pins where crew_member_id=c2)<>0 then raise exception 'TEST: pin outlived its crew member'; end if;
 update watch_lanes set active=false where id=l1;
 delete from watch_lanes where id=l1;
 if (select count(*) from watch_pins where lane_id=l1)<>0 then raise exception 'TEST: pin outlived its lane'; end if;

 perform set_config('request.jwt.claim.sub','',true);
 raise notice 'watch_pins: all assertions passed';
end $$;
