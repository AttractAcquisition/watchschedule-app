-- Run inside a transaction and roll back: no customer rows are changed.
-- Covers apply_manual_override (migration 20261026030000): the write path the
-- override-assignment Edge Function lands on.
do $$
declare
 u uuid:=gen_random_uuid(); v uuid; c1 uuid; c2 uuid; c3 uuid; l1 uuid; l2 uuid;
 rev bigint; sid uuid; old_sid uuid; snap jsonb; opp jsonb;
 cfg jsonb := '{"horizon_weeks":1,"schedule_start_date":"2026-10-26","include_weekends":true,"weekday_rotation_anchor":0,"weekend_rotation_anchor":0,"weekend_structure":"per_day"}';
 score jsonb;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'override-test-'||u||'@example.invalid','{}');
 select vessel_id into v from profiles where id=u;
 update profiles set payment_status='active',product_tier='dual' where id=u;
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Alpha','Deckhand','deck') returning id into c1;
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Bravo','Deckhand','deck') returning id into c2;
 insert into crew_members(vessel_id,full_name,position,department) values(v,'Charlie','Stewardess','interior') returning id into c3;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform save_watch_configuration(cfg,'[{"departments":["deck"]},{"departments":["interior"]}]');
 perform set_config('request.jwt.claim.sub','',true);
 select id into l1 from watch_lanes where vessel_id=v and position=1;
 select id into l2 from watch_lanes where vessel_id=v and position=2;

 select rota_revision into rev from vessels where id=v;
 snap:=jsonb_build_object('lanes','[]'::jsonb,'weekend_structure','per_day',
   'scheduled_dates',jsonb_build_array('2026-10-26','2026-10-27'),
   'opportunities',jsonb_build_array(jsonb_build_object('crew_id',c1,'watch_date','2026-10-26')));
 sid:=publish_rota(v,rev,jsonb_build_object('start_date','2026-10-26','end_date','2026-10-27','horizon_weeks',1,
   'snapshot',snap,'events','[]'::jsonb,'scores','[]'::jsonb,
   'assignments',jsonb_build_array(
     jsonb_build_object('lane_id',l1,'crew_id',c1,'watch_date','2026-10-26','day_type','weekday','is_friday',false),
     jsonb_build_object('lane_id',l1,'crew_id',c2,'watch_date','2026-10-27','day_type','weekday','is_friday',false),
     jsonb_build_object('lane_id',l2,'crew_id',c3,'watch_date','2026-10-26','day_type','weekday','is_friday',false))));
 if (select count(*) from watch_assignments where schedule_id=sid and is_manual)<>0 then raise exception 'TEST: generation marked rows manual'; end if;

 -- A hand change: lane 1 on the 26th goes from Alpha to Bravo.
 score:=jsonb_build_array(jsonb_build_object('crew_id',c2,'total_watches',2,'weekday_watches',2,'weekend_watches',0,
   'friday_watches',0,'weekday_opportunities',2,'weekend_opportunities',0,'friday_opportunities',0,
   'last_watch_date','2026-10-27','consecutive_run',2,'fairness_score',70,'deviation',0.5,'balance','over'));
 select rota_revision into rev from vessels where id=v;
 perform apply_manual_override(v,rev,jsonb_build_object('schedule_id',sid,'lane_id',l1,
   'dates',jsonb_build_array('2026-10-26'),'crew_id',c2,'history_estimated',false,
   'assignments',jsonb_build_array(jsonb_build_object('lane_id',l1,'crew_id',c2,'watch_date','2026-10-26','day_type','weekday','is_friday',false)),
   'scores',score,'detail',jsonb_build_object('previous_crew_id',c1,'new_crew_id',c2)));

 if (select crew_id from watch_assignments where schedule_id=sid and lane_id=l1 and watch_date='2026-10-26')<>c2
   then raise exception 'TEST: override did not change the watchkeeper'; end if;
 if not (select is_manual from watch_assignments where schedule_id=sid and lane_id=l1 and watch_date='2026-10-26')
   then raise exception 'TEST: override not flagged manual'; end if;
 if (select count(*) from watch_assignments where schedule_id=sid)<>3 then raise exception 'TEST: override changed the row count'; end if;
 if (select is_manual from watch_assignments where schedule_id=sid and lane_id=l1 and watch_date='2026-10-27')
   then raise exception 'TEST: an untouched day was flagged manual'; end if;
 select rota_snapshot->'opportunities' into opp from schedules where id=sid;
 if jsonb_array_length(opp)<>2 or not (opp @> jsonb_build_array(jsonb_build_object('crew_id',c2,'watch_date','2026-10-26')))
   then raise exception 'TEST: the new watchkeeper got no opportunity'; end if;
 if (select count(*) from vessel_fairness where vessel_id=v)<>1
   or (select crew_id from vessel_fairness where vessel_id=v)<>c2 then raise exception 'TEST: fairness not rewritten'; end if;
 if (select count(*) from fairness_events where schedule_id=sid and reason_code='manual_override')<>1
   then raise exception 'TEST: no audit event'; end if;
 if (select rota_revision from vessels where id=v)<>rev+1 then raise exception 'TEST: revision not bumped'; end if;

 -- A stale revision is refused, so an in-flight generation cannot be written over.
 begin
   perform apply_manual_override(v,rev,jsonb_build_object('schedule_id',sid,'lane_id',l1,
     'dates',jsonb_build_array('2026-10-27'),'crew_id',c1,'assignments','[]'::jsonb,'scores','[]'::jsonb));
   raise exception 'TEST: stale override accepted';
 exception when raise_exception then
   if sqlerrm<>'The rota changed while you were editing. Please try again.' then raise; end if;
 end;

 -- One person, one watch a day — across lanes, and not consentable.
 select rota_revision into rev from vessels where id=v;
 begin
   perform apply_manual_override(v,rev,jsonb_build_object('schedule_id',sid,'lane_id',l2,
     'dates',jsonb_build_array('2026-10-26'),'crew_id',c2,'scores','[]'::jsonb,
     'assignments',jsonb_build_array(jsonb_build_object('lane_id',l2,'crew_id',c2,'watch_date','2026-10-26','day_type','weekday','is_friday',false))));
   raise exception 'TEST: double booking accepted';
 exception when raise_exception then
   if sqlerrm<>'That crew member is already on watch that day' then raise; end if;
 end;

 -- Outside the schedule, and a schedule that is no longer current.
 begin
   perform apply_manual_override(v,rev,jsonb_build_object('schedule_id',sid,'lane_id',l1,
     'dates',jsonb_build_array('2026-11-30'),'crew_id',c1,'scores','[]'::jsonb,
     'assignments',jsonb_build_array(jsonb_build_object('lane_id',l1,'crew_id',c1,'watch_date','2026-11-30','day_type','weekday','is_friday',false))));
   raise exception 'TEST: out-of-window day accepted';
 exception when raise_exception then
   if sqlerrm<>'That day is outside the current schedule' then raise; end if;
 end;
 old_sid:=sid;
 select rota_revision into rev from vessels where id=v;
 sid:=publish_rota(v,rev,jsonb_build_object('start_date','2026-10-26','end_date','2026-10-27','horizon_weeks',1,
   'snapshot',snap,'events','[]'::jsonb,'scores','[]'::jsonb,'assignments',jsonb_build_array(
     jsonb_build_object('lane_id',l1,'crew_id',c1,'watch_date','2026-10-26','day_type','weekday','is_friday',false))));
 -- Regeneration replaces the window: the manual change is gone from the current rota.
 if (select count(*) from watch_assignments where schedule_id=sid and is_manual)<>0
   then raise exception 'TEST: regeneration kept manual flags'; end if;
 if (select count(*) from watch_assignments where schedule_id=old_sid and is_manual)<>1
   then raise exception 'TEST: history lost the manual change'; end if;
 select rota_revision into rev from vessels where id=v;
 begin
   perform apply_manual_override(v,rev,jsonb_build_object('schedule_id',old_sid,'lane_id',l1,
     'dates',jsonb_build_array('2026-10-26'),'crew_id',c1,'scores','[]'::jsonb,
     'assignments',jsonb_build_array(jsonb_build_object('lane_id',l1,'crew_id',c1,'watch_date','2026-10-26','day_type','weekday','is_friday',false))));
   raise exception 'TEST: superseded schedule accepted';
 exception when raise_exception then
   if sqlerrm<>'That schedule is not the current one' then raise; end if;
 end;

 -- Clearing a watch leaves the day unassigned without touching the rest.
 select rota_revision into rev from vessels where id=v;
 perform apply_manual_override(v,rev,jsonb_build_object('schedule_id',sid,'lane_id',l1,
   'dates',jsonb_build_array('2026-10-26'),'crew_id',null,'assignments','[]'::jsonb,'scores','[]'::jsonb));
 if (select count(*) from watch_assignments where schedule_id=sid)<>0 then raise exception 'TEST: clear did not remove the watch'; end if;

 raise notice 'manual_override: all assertions passed';
end $$;
