-- Fix: "column reference \"a\" is ambiguous" (24 November 2026).
--
-- Both RPCs declare a PL/pgSQL loop record named `a` AND use `a` as a table
-- alias in later statements. Postgres cannot tell the two apart and raises
-- 42702 at runtime, so every call failed:
--
--   import_watch_history  -> every past-watch import, bulk or single-day
--   apply_rota_restore    -> "Restore cleared watches" and
--                            "Make this the live schedule" (whenever scores
--                            are non-empty, which is always for those two)
--
-- A clear calendar and a plain generation were unaffected, which is why this
-- surfaced only when the first import was attempted.
--
-- The aliases are renamed (`ev` for the event row, `sc` for a score row); the
-- loop variables keep their names. Nothing else about either function changes.
-- Lesson for future RPCs here: never alias a table with a name that is also a
-- declared variable.

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
  select (ev->>'schedule_id')::uuid, p_vessel, (ev->>'lane_id')::uuid, (ev->>'crew_id')::uuid,
         (ev->>'watch_date')::date, 'history_import', coalesce(p_plan->'detail','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_plan->'amendments','[]'::jsonb)) ev
  limit 1;

  delete from vessel_fairness where vessel_id=p_vessel;
  insert into vessel_fairness(vessel_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,weekday_opportunities,weekend_opportunities,friday_opportunities,last_watch_date,last_weekend_date,consecutive_run,fairness_score,deviation,balance,history_estimated)
  select p_vessel,sc.crew_id,sc.total_watches,sc.weekday_watches,sc.weekend_watches,sc.friday_watches,sc.weekday_opportunities,sc.weekend_opportunities,sc.friday_opportunities,sc.last_watch_date,sc.last_weekend_date,sc.consecutive_run,sc.fairness_score,sc.deviation,sc.balance,coalesce((p_plan->>'history_estimated')::boolean,false)
  from jsonb_to_recordset(coalesce(p_plan->'scores','[]'::jsonb)) sc(crew_id uuid,total_watches int,weekday_watches int,weekend_watches int,friday_watches int,weekday_opportunities int,weekend_opportunities int,friday_opportunities int,last_watch_date date,last_weekend_date date,consecutive_run int,fairness_score numeric,deviation numeric,balance text)
  where exists(select 1 from crew_members c where c.id=sc.crew_id and c.vessel_id=p_vessel);

  update vessels set rota_revision=rota_revision+1 where id=p_vessel;
  return jsonb_build_object('amended',amended,'versions_created',created);
end $$;

create or replace function apply_rota_restore(p_vessel uuid, p_revision bigint, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  rev bigint;
  action text;
  src uuid;
  sid uuid;
  copied int := 0;
begin
  select rota_revision into rev from vessels where id=p_vessel for update;
  if rev is distinct from p_revision then raise exception 'The rota changed while you were working. Please try again.'; end if;
  action := p_plan->>'action';

  if action = 'clear_calendar' then
    -- Fairness is derived from what is on the calendar, so the two move
    -- together: scores that describe watches nobody can see are worse than no
    -- scores. Both markers carry the SAME timestamp, which is how
    -- restore_calendar knows the fairness reset was this clear's doing and not
    -- an earlier, independent "Clear fairness history".
    update vessels set calendar_cleared_at=now(), fairness_reset_at=now() where id=p_vessel;
    delete from vessel_fairness where vessel_id=p_vessel;

  elsif action = 'restore_calendar' then
    update vessels set
      fairness_reset_at = case when fairness_reset_at is not distinct from calendar_cleared_at then null else fairness_reset_at end,
      calendar_cleared_at = null
    where id=p_vessel;

  elsif action = 'restore_version' then
    src := (p_plan->>'source_schedule_id')::uuid;
    if not exists(select 1 from schedules where id=src and vessel_id=p_vessel) then
      raise exception 'That schedule version does not belong to this vessel';
    end if;
    -- A restore must be visible on the calendar, so it cannot sit behind a
    -- clear marker that would hide it.
    update vessels set
      fairness_reset_at = case when fairness_reset_at is not distinct from calendar_cleared_at then null else fairness_reset_at end,
      calendar_cleared_at = null
    where id=p_vessel;
    update schedules set is_current=false where vessel_id=p_vessel and is_current;
    insert into schedules(vessel_id,start_date,end_date,horizon_weeks,is_current,engine_version,rota_snapshot,is_historical,restored_from)
      select vessel_id,start_date,end_date,horizon_weeks,true,engine_version,rota_snapshot,is_historical,src
      from schedules where id=src
      returning id into sid;
    insert into watch_assignments(schedule_id,vessel_id,lane_id,crew_id,watch_date,day_type,is_friday,is_manual)
      select sid,p_vessel,lane_id,crew_id,watch_date,day_type,is_friday,is_manual
      from watch_assignments where schedule_id=src and vessel_id=p_vessel;
    get diagnostics copied = row_count;
    insert into fairness_events(schedule_id,vessel_id,lane_id,crew_id,watch_date,reason_code,detail)
      select sid,p_vessel,lane_id,crew_id,watch_date,'version_restored',
             jsonb_build_object('restored_from',src,'watches',copied)
      from watch_assignments where schedule_id=sid limit 1;
  else
    raise exception 'Unknown restore action';
  end if;

  -- Scores arrive precomputed by the ordinary replay; this is never a second
  -- formula. A clear sends none, because there is nothing left to score.
  if jsonb_array_length(coalesce(p_plan->'scores','[]'::jsonb)) > 0 then
    delete from vessel_fairness where vessel_id=p_vessel;
    insert into vessel_fairness(vessel_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,weekday_opportunities,weekend_opportunities,friday_opportunities,last_watch_date,last_weekend_date,consecutive_run,fairness_score,deviation,balance,history_estimated)
    select p_vessel,sc.crew_id,sc.total_watches,sc.weekday_watches,sc.weekend_watches,sc.friday_watches,sc.weekday_opportunities,sc.weekend_opportunities,sc.friday_opportunities,sc.last_watch_date,sc.last_weekend_date,sc.consecutive_run,sc.fairness_score,sc.deviation,sc.balance,coalesce((p_plan->>'history_estimated')::boolean,false)
    from jsonb_to_recordset(p_plan->'scores') sc(crew_id uuid,total_watches int,weekday_watches int,weekend_watches int,friday_watches int,weekday_opportunities int,weekend_opportunities int,friday_opportunities int,last_watch_date date,last_weekend_date date,consecutive_run int,fairness_score numeric,deviation numeric,balance text)
    where exists(select 1 from crew_members c where c.id=sc.crew_id and c.vessel_id=p_vessel);
  end if;

  update vessels set rota_revision=rota_revision+1 where id=p_vessel;
  return jsonb_build_object('action',action,'schedule_id',sid,'watches_copied',copied);
end $$;
