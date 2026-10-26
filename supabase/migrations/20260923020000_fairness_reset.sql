-- Starts a new fairness season without deleting the captain's crew or schedule.
alter table vessels add column fairness_reset_at timestamptz;

create or replace function reset_fairness_history() returns void
language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
  select vessel_id into v from profiles
  where id=auth.uid() and payment_status='active';
  if v is null then raise exception 'Active subscription required'; end if;
  perform 1 from vessels where id=v and owner_id=auth.uid() for update;
  if not found then raise exception 'Vessel not found'; end if;

  -- Keep schedules/assignments as operational history, but exclude everything
  -- before this marker when the next schedule rebuilds its fairness ledger.
  update vessels set fairness_reset_at=now(), rota_revision=rota_revision+1 where id=v;
  delete from vessel_fairness where vessel_id=v;
  delete from fairness_ledger where vessel_id=v;
  delete from fairness_events where vessel_id=v;
  insert into rota_seed(vessel_id,baseline,records,history_estimated,updated_at)
  values(v,'{}','[]',false,now())
  on conflict(vessel_id) do update set baseline='{}',records='[]',history_estimated=false,updated_at=now();
end $$;
revoke all on function reset_fairness_history() from public, anon;
grant execute on function reset_fairness_history() to authenticated;
