-- Clearing the calendar, putting it back, and restoring an older generation
-- (docs/calendar-restore.md, 24 November 2026).
--
-- Three operations, one RPC, because they share a shape: set some rota state,
-- then rewrite `vessel_fairness` from the ordinary replay the Edge Function
-- computed. Nothing here deletes a watch.
--
--   clear_calendar   — hide every stored generation from the calendar, and stop
--                      it counting towards fairness. A MARKER, not a delete:
--                      Schedule History still lists every version, and
--                      restore_calendar puts them all back.
--   restore_calendar — lift the marker.
--   restore_version  — make an older generation live again by COPYING it into a
--                      new current version. Not a rollback: the winner rule
--                      ranks versions by `generated_at`, so an old row could
--                      only win its dates again by having its timestamp
--                      rewritten, which would falsify the audit trail. A copy
--                      wins honestly and leaves the original in place.
--
-- This reverses the "no revert/restore" exclusion in additions.md A2 for the
-- schedule-history surface. The rest of that exclusion stands: no approval
-- lifecycle, no locking, no diff tracking.

alter table vessels add column if not exists calendar_cleared_at timestamptz;
comment on column vessels.calendar_cleared_at is
  'When set, generations at or before this moment are hidden from the calendar and excluded from the fairness replay. A reversible marker; no watch is deleted.';

alter table schedules add column if not exists restored_from uuid references schedules(id) on delete set null;
comment on column schedules.restored_from is
  'For a version created by restoring an earlier one: which version it was copied from.';

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
    select p_vessel,a.crew_id,a.total_watches,a.weekday_watches,a.weekend_watches,a.friday_watches,a.weekday_opportunities,a.weekend_opportunities,a.friday_opportunities,a.last_watch_date,a.last_weekend_date,a.consecutive_run,a.fairness_score,a.deviation,a.balance,coalesce((p_plan->>'history_estimated')::boolean,false)
    from jsonb_to_recordset(p_plan->'scores') a(crew_id uuid,total_watches int,weekday_watches int,weekend_watches int,friday_watches int,weekday_opportunities int,weekend_opportunities int,friday_opportunities int,last_watch_date date,last_weekend_date date,consecutive_run int,fairness_score numeric,deviation numeric,balance text)
    where exists(select 1 from crew_members c where c.id=a.crew_id and c.vessel_id=p_vessel);
  end if;

  update vessels set rota_revision=rota_revision+1 where id=p_vessel;
  return jsonb_build_object('action',action,'schedule_id',sid,'watches_copied',copied);
end $$;

revoke all on function apply_rota_restore(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function apply_rota_restore(uuid,bigint,jsonb) to service_role;
