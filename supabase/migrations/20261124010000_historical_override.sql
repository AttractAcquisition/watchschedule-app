-- Editing a watch on a date an OLDER generation owns (docs/manual-override.md,
-- 24 November 2026).
--
-- `apply_manual_override` required the target schedule to be `is_current`. That
-- made every day outside the newest window uneditable, even when a perfectly
-- good superseded generation still covered it and still fed fairness. A captain
-- correcting who actually stood a watch last week could not do it.
--
-- The guard moves rather than disappears: the days must fall inside the range of
-- the schedule being amended, and that schedule must belong to this vessel. The
-- caller picks the schedule by the same per-date winner rule the fairness replay
-- uses (`_shared/rota_v2.ts` -> versionOwner), so an edit always lands on the
-- version that actually owns the day. Everything else -- the one-watch-a-day
-- invariant, the opportunity append, the fairness rewrite, the revision bump --
-- is unchanged.

create or replace function apply_manual_override(p_vessel uuid, p_revision bigint, p_plan jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare rev bigint; sid uuid; lid uuid; cid uuid; ds date[]; s_start date; s_end date;
begin
 select rota_revision into rev from vessels where id=p_vessel for update;
 if rev is distinct from p_revision then raise exception 'The rota changed while you were editing. Please try again.'; end if;
 sid:=(p_plan->>'schedule_id')::uuid;
 lid:=(p_plan->>'lane_id')::uuid;
 cid:=(p_plan->>'crew_id')::uuid;
 select array_agg(value::date order by value::date) into ds from jsonb_array_elements_text(p_plan->'dates');
 if coalesce(cardinality(ds),0)=0 then raise exception 'No days to change'; end if;

 -- Any generation of THIS vessel, not only the current one.
 select start_date,end_date into s_start,s_end from schedules where id=sid and vessel_id=p_vessel;
 if s_start is null then raise exception 'That schedule does not belong to this vessel'; end if;
 if ds[1]<s_start or ds[cardinality(ds)]>s_end then raise exception 'That day is outside the schedule being changed'; end if;
 if not exists(select 1 from watch_lanes where id=lid and vessel_id=p_vessel) then raise exception 'Unknown watch lane'; end if;
 if cid is not null and not exists(select 1 from crew_members where id=cid and vessel_id=p_vessel) then raise exception 'Unknown crew member'; end if;

 delete from watch_assignments where schedule_id=sid and lane_id=lid and watch_date=any(ds);
 insert into watch_assignments(schedule_id,vessel_id,lane_id,crew_id,watch_date,day_type,is_friday,is_manual)
 select sid,p_vessel,a.lane_id,a.crew_id,a.watch_date,a.day_type,a.is_friday,true
 from jsonb_to_recordset(p_plan->'assignments') a(lane_id uuid,crew_id uuid,watch_date date,day_type day_type,is_friday boolean);
 -- One person, one watch a day — the same guard publish_rota applies to a plan.
 if exists(select 1 from watch_assignments where schedule_id=sid group by crew_id,watch_date having count(*)>1) then
   raise exception 'That crew member is already on watch that day';
 end if;

 -- The crew member taking the watch was available to stand it, so the day is an
 -- opportunity for them too; without it the burden rate would have no denominator.
 -- Only for a V2 snapshot: a legacy schedule has no stored opportunity list, and
 -- writing one would make the replay read it as complete.
 if cid is not null then
   update schedules set rota_snapshot=jsonb_set(rota_snapshot,'{opportunities}',
     (rota_snapshot->'opportunities')||(
       select coalesce(jsonb_agg(jsonb_build_object('crew_id',cid,'watch_date',d)),'[]'::jsonb) from unnest(ds) d))
   where id=sid and jsonb_typeof(rota_snapshot->'opportunities')='array';
 end if;

 insert into fairness_events(schedule_id,vessel_id,lane_id,crew_id,watch_date,reason_code,detail)
 values(sid,p_vessel,lid,cid,ds[1],'manual_override',p_plan->'detail');

 delete from vessel_fairness where vessel_id=p_vessel;
 insert into vessel_fairness(vessel_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,weekday_opportunities,weekend_opportunities,friday_opportunities,last_watch_date,last_weekend_date,consecutive_run,fairness_score,deviation,balance,history_estimated)
 select p_vessel,a.crew_id,a.total_watches,a.weekday_watches,a.weekend_watches,a.friday_watches,a.weekday_opportunities,a.weekend_opportunities,a.friday_opportunities,a.last_watch_date,a.last_weekend_date,a.consecutive_run,a.fairness_score,a.deviation,a.balance,coalesce((p_plan->>'history_estimated')::boolean,false)
 from jsonb_to_recordset(p_plan->'scores') a(crew_id uuid,total_watches int,weekday_watches int,weekend_watches int,friday_watches int,weekday_opportunities int,weekend_opportunities int,friday_opportunities int,last_watch_date date,last_weekend_date date,consecutive_run int,fairness_score numeric,deviation numeric,balance text)
 where exists(select 1 from crew_members c where c.id=a.crew_id and c.vessel_id=p_vessel);

 update vessels set rota_revision=rota_revision+1 where id=p_vessel;
end $$;
revoke all on function apply_manual_override(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function apply_manual_override(uuid,bigint,jsonb) to service_role;
