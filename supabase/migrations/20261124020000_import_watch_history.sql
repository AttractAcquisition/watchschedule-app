-- "Upload past watches" (docs/history-import.md, 24 November 2026).
--
-- The captain records watches that were actually stood: typed in by hand or
-- uploaded as a CSV. They become ordinary `watch_assignments`, so they render
-- on the calendar, replay through `canonicalHistory` into fairness, and can be
-- corrected afterwards by clicking the cell -- exactly like generated ones.
--
-- Two destinations, decided per date by the caller using the same per-date
-- winner rule as the fairness replay:
--
--   * a date an existing generation owns -> AMEND that generation
--   * a date no generation covers        -> a new `is_historical` schedule row
--
-- Why not one wide historical row: a schedule spans a RANGE, and the winner
-- rule gives a version every date in its range. A single row from the first to
-- the last imported record would claim -- and blank -- every generated day in
-- between. The caller therefore sends tight contiguous runs.
--
-- Invariants unchanged: service-role only, vessel-scoped, one transaction under
-- the same revision check `publish_rota` uses, and the fairness numbers are the
-- ordinary replay computed by the Edge Function, never a second formula here.

alter table schedules add column if not exists is_historical boolean not null default false;

comment on column schedules.is_historical is
  'True for a row created by past-watch import rather than by generation. It is still a schedule version for the per-date winner rule; the flag is for display and audit.';

create or replace function import_watch_history(p_vessel uuid, p_revision bigint, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  rev bigint;
  amended int := 0;
  created int := 0;
  v record;
  a record;
  sid uuid;
begin
  select rota_revision into rev from vessels where id=p_vessel for update;
  if rev is distinct from p_revision then raise exception 'The rota changed while you were importing. Please try again.'; end if;

  -- ---- amendments to generations that already own the date ----------------
  for a in
    select * from jsonb_to_recordset(coalesce(p_plan->'amendments','[]'::jsonb))
      as x(schedule_id uuid, lane_id uuid, crew_id uuid, watch_date date, day_type day_type, is_friday boolean)
  loop
    if not exists(select 1 from schedules s where s.id=a.schedule_id and s.vessel_id=p_vessel) then
      raise exception 'That schedule does not belong to this vessel';
    end if;
    if a.watch_date < (select start_date from schedules where id=a.schedule_id)
       or a.watch_date > (select end_date from schedules where id=a.schedule_id) then
      raise exception 'An imported day falls outside the schedule meant to hold it';
    end if;
    if not exists(select 1 from watch_lanes l where l.id=a.lane_id and l.vessel_id=p_vessel) then
      raise exception 'Unknown watch lane';
    end if;
    if not exists(select 1 from crew_members c where c.id=a.crew_id and c.vessel_id=p_vessel) then
      raise exception 'Unknown crew member';
    end if;
    -- The import is a record of what happened, so it wins the lane-day. Clear
    -- the person from any OTHER lane that day too, or the one-watch-a-day
    -- invariant below would reject the whole import.
    delete from watch_assignments
      where schedule_id=a.schedule_id and watch_date=a.watch_date and (lane_id=a.lane_id or crew_id=a.crew_id);
    insert into watch_assignments(schedule_id,vessel_id,lane_id,crew_id,watch_date,day_type,is_friday,is_manual)
      values(a.schedule_id,p_vessel,a.lane_id,a.crew_id,a.watch_date,a.day_type,a.is_friday,true);
    amended := amended + 1;
  end loop;

  -- ---- new historical rows for dates no generation covers ------------------
  for v in
    select * from jsonb_to_recordset(coalesce(p_plan->'new_versions','[]'::jsonb))
      as x(start_date date, end_date date, horizon_weeks int, snapshot jsonb, assignments jsonb)
  loop
    insert into schedules(vessel_id,start_date,end_date,horizon_weeks,is_current,is_historical,engine_version,rota_snapshot)
      values(p_vessel,v.start_date,v.end_date,greatest(1,coalesce(v.horizon_weeks,1)),false,true,2,v.snapshot)
      returning id into sid;
    insert into watch_assignments(schedule_id,vessel_id,lane_id,crew_id,watch_date,day_type,is_friday,is_manual)
      select sid,p_vessel,x.lane_id,x.crew_id,x.watch_date,x.day_type,x.is_friday,true
      from jsonb_to_recordset(coalesce(v.assignments,'[]'::jsonb))
        as x(lane_id uuid, crew_id uuid, watch_date date, day_type day_type, is_friday boolean)
      where exists(select 1 from crew_members c where c.id=x.crew_id and c.vessel_id=p_vessel)
        and exists(select 1 from watch_lanes l where l.id=x.lane_id and l.vessel_id=p_vessel);
    created := created + 1;
  end loop;

  -- One person, one watch a day — the guard publish_rota applies to a plan,
  -- re-checked across every schedule this import touched.
  if exists(
    select 1 from watch_assignments w
    where w.vessel_id=p_vessel
      and w.schedule_id in (
        select distinct (x->>'schedule_id')::uuid from jsonb_array_elements(coalesce(p_plan->'amendments','[]'::jsonb)) x
      )
    group by w.schedule_id, w.crew_id, w.watch_date having count(*)>1
  ) then
    raise exception 'That would put someone on two watches in one day';
  end if;

  insert into fairness_events(schedule_id,vessel_id,lane_id,crew_id,watch_date,reason_code,detail)
  select (a->>'schedule_id')::uuid, p_vessel, (a->>'lane_id')::uuid, (a->>'crew_id')::uuid,
         (a->>'watch_date')::date, 'history_import', coalesce(p_plan->'detail','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_plan->'amendments','[]'::jsonb)) a
  limit 1;

  delete from vessel_fairness where vessel_id=p_vessel;
  insert into vessel_fairness(vessel_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,weekday_opportunities,weekend_opportunities,friday_opportunities,last_watch_date,last_weekend_date,consecutive_run,fairness_score,deviation,balance,history_estimated)
  select p_vessel,a.crew_id,a.total_watches,a.weekday_watches,a.weekend_watches,a.friday_watches,a.weekday_opportunities,a.weekend_opportunities,a.friday_opportunities,a.last_watch_date,a.last_weekend_date,a.consecutive_run,a.fairness_score,a.deviation,a.balance,coalesce((p_plan->>'history_estimated')::boolean,false)
  from jsonb_to_recordset(coalesce(p_plan->'scores','[]'::jsonb)) a(crew_id uuid,total_watches int,weekday_watches int,weekend_watches int,friday_watches int,weekday_opportunities int,weekend_opportunities int,friday_opportunities int,last_watch_date date,last_weekend_date date,consecutive_run int,fairness_score numeric,deviation numeric,balance text)
  where exists(select 1 from crew_members c where c.id=a.crew_id and c.vessel_id=p_vessel);

  update vessels set rota_revision=rota_revision+1 where id=p_vessel;
  return jsonb_build_object('amended',amended,'versions_created',created);
end $$;

revoke all on function import_watch_history(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function import_watch_history(uuid,bigint,jsonb) to service_role;
