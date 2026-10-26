-- Rota V2: subscriptions limit lanes, departments overlap, fairness follows crew.
alter table vessels add column rota_revision bigint not null default 0;
alter table watch_lanes add column position integer not null default 1;
with numbered as (
  select id, row_number() over (partition by vessel_id order by created_at, id) n
  from watch_lanes where active
) update watch_lanes l set position=n.n from numbered n where n.id=l.id;
alter table lane_departments drop constraint lane_departments_disjoint;
alter table lane_departments add constraint lane_department_once unique(lane_id, department);
alter table watch_lanes add constraint watch_lane_vessel_unique unique(id, vessel_id);
alter table lane_departments add constraint lane_department_same_vessel
  foreign key(lane_id, vessel_id) references watch_lanes(id, vessel_id) on delete cascade;
insert into lane_departments(vessel_id,lane_id,department)
select l.vessel_id,l.id,d from watch_lanes l cross join unnest(enum_range(null::department)) d
where l.kind='solo' and l.active on conflict do nothing;
alter table watch_settings drop constraint dept_count_matches_tier;
alter table schedules add column engine_version integer not null default 1;
alter table schedules add column rota_snapshot jsonb;
-- Freeze labels and department membership before captains can edit a live lane.
update schedules s set rota_snapshot=jsonb_build_object('lanes',coalesce((
 select jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'position',l.position,
 'departments',coalesce((select jsonb_agg(d.department) from lane_departments d where d.lane_id=l.id),
 case when l.kind='solo' then '["deck","engineering","interior","officer"]'::jsonb
 when l.department is not null then jsonb_build_array(l.department) else '[]'::jsonb end)) order by l.position,l.id)
 from watch_lanes l where l.vessel_id=s.vessel_id and
 ((s.is_current and l.active) or exists(select 1 from watch_assignments a where a.schedule_id=s.id and a.lane_id=l.id))
),'[]'::jsonb));

create table vessel_fairness (
  vessel_id uuid not null references vessels(id) on delete cascade,
  crew_id uuid not null references crew_members(id) on delete cascade,
  total_watches int not null default 0,
  weekday_watches int not null default 0,
  weekend_watches int not null default 0,
  friday_watches int not null default 0,
  weekday_opportunities int not null default 0,
  weekend_opportunities int not null default 0,
  friday_opportunities int not null default 0,
  last_watch_date date,
  last_weekend_date date,
  consecutive_run int not null default 0,
  fairness_score numeric,
  deviation numeric,
  balance text,
  history_estimated boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(vessel_id,crew_id)
);
alter table vessel_fairness enable row level security;
create policy vessel_fairness_read on vessel_fairness for select using(vessel_id=current_vessel_id());

create table rota_seed (
  vessel_id uuid primary key references vessels(id) on delete cascade,
  baseline jsonb not null default '{}',
  records jsonb not null default '[]',
  history_estimated boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table rota_seed enable row level security;
create policy rota_seed_read on rota_seed for select using(vessel_id=current_vessel_id());
grant select on vessel_fairness,rota_seed to authenticated;
grant all on vessel_fairness,rota_seed to service_role;
-- Keep the immutable imported base, never migrate projected future totals.
insert into rota_seed(vessel_id,baseline,history_estimated)
select vessel_id,jsonb_object_agg(crew_id, entry),true from (
 select vessel_id,crew_id,jsonb_build_object(
 'crew_id',crew_id,'total_watches',sum(seed_total_watches),
 'weekday_watches',sum(seed_weekday_watches),'weekend_watches',sum(seed_weekend_watches),
 'friday_watches',sum(seed_friday_watches),'last_watch_date',max(seed_last_watch_date),
 'last_weekend_date',max(seed_last_weekend_date),'consecutive_run',max(seed_consecutive_run),
 'weekday_opportunities',max(seed_weekday_opportunities),'weekend_opportunities',max(seed_weekend_opportunities),
 'friday_opportunities',max(seed_friday_opportunities)) entry
 from fairness_ledger group by vessel_id,crew_id having sum(seed_total_watches)>0
) s group by vessel_id;

-- All configuration saves use the atomic RPC. Own-vessel reads remain available.
drop policy if exists watch_settings_rw_own_vessel on watch_settings;
drop policy if exists watch_lanes_rw_own_vessel on watch_lanes;
drop policy if exists lane_departments_rw_own_vessel on lane_departments;
create policy watch_settings_read on watch_settings for select using(vessel_id=current_vessel_id());
create policy watch_lanes_read on watch_lanes for select using(vessel_id=current_vessel_id());
create policy lane_departments_read on lane_departments for select using(vessel_id=current_vessel_id());
revoke insert,update,delete on watch_settings,watch_lanes,lane_departments from authenticated,anon;

create function save_watch_configuration(p_settings jsonb,p_lanes jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare v uuid; t product_tier; cap int; item jsonb; ds department[]; lid uuid; ids uuid[] := '{}'; n int:=0;
begin
 select vessel_id,product_tier into v,t from profiles where id=auth.uid() and payment_status='active';
 if v is null or t is null then raise exception 'Active subscription required'; end if;
 perform 1 from vessels where id=v and owner_id=auth.uid() for update;
 if not found then raise exception 'Vessel not found'; end if;
 cap:=case t when 'solo' then 1 when 'dual' then 2 else 3 end;
 if p_lanes is null or jsonb_typeof(p_lanes)<>'array' then raise exception 'Lanes must be an array'; end if;
 if jsonb_array_length(p_lanes) not between 1 and cap then raise exception 'Invalid active lane count'; end if;
 -- Validate the complete request before changing any rows.
 for item in select * from jsonb_array_elements(p_lanes) loop
   select array_agg(value::department order by value) into ds from jsonb_array_elements_text(item->'departments');
   if coalesce(cardinality(ds),0) not between 1 and 4 or cardinality(ds)<>(select count(distinct d) from unnest(ds) d) then raise exception 'Invalid department pool'; end if;
   if item->>'id' is not null then
     lid:=(item->>'id')::uuid;
     if lid=any(ids) or not exists(select 1 from watch_lanes where id=lid and vessel_id=v and active) then raise exception 'Invalid lane identity'; end if;
     ids:=array_append(ids,lid);
   end if;
 end loop;
 ids:='{}';
 for item in select * from jsonb_array_elements(p_lanes) loop
   n:=n+1;
   select array_agg(value::department order by value) into ds from jsonb_array_elements_text(item->'departments');
   lid:=(item->>'id')::uuid;
   if lid is null then
     insert into watch_lanes(vessel_id,kind,department,label,active,position)
     values(v,'dept',ds[1],'Lane '||n,true,n) returning id into lid;
   else
     update watch_lanes set kind='dept',department=ds[1],label='Lane '||n,position=n where id=lid;
   end if;
   delete from lane_departments where lane_id=lid;
   insert into lane_departments(vessel_id,lane_id,department) select v,lid,d from unnest(ds) d;
   ids:=array_append(ids,lid);
 end loop;
 update watch_lanes set active=false where vessel_id=v and active and not(id=any(ids));
 insert into watch_settings(vessel_id,tier,selected_departments,horizon_weeks,schedule_start_date,include_weekends,weekday_rotation_anchor,weekend_rotation_anchor,weekend_structure)
 values(v,t,'{}',(p_settings->>'horizon_weeks')::int,(p_settings->>'schedule_start_date')::date,(p_settings->>'include_weekends')::boolean,
 (p_settings->>'weekday_rotation_anchor')::int,(p_settings->>'weekend_rotation_anchor')::int,(p_settings->>'weekend_structure')::weekend_structure)
 on conflict(vessel_id) do update set tier=excluded.tier,selected_departments='{}',horizon_weeks=excluded.horizon_weeks,
 schedule_start_date=excluded.schedule_start_date,include_weekends=excluded.include_weekends,
 weekday_rotation_anchor=excluded.weekday_rotation_anchor,weekend_rotation_anchor=excluded.weekend_rotation_anchor,weekend_structure=excluded.weekend_structure;
end $$;
revoke all on function save_watch_configuration(jsonb,jsonb) from public,anon;
grant execute on function save_watch_configuration(jsonb,jsonb) to authenticated;

-- Mutations serialize against publishing. This also prevents a stale generation
-- from undoing a crew/leave/charter/configuration change made during calculation.
create function bump_rota_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update vessels set rota_revision=rota_revision+1 where id=case when tg_op='DELETE' then old.vessel_id else new.vessel_id end;
 return null;
end $$;
create trigger rota_revision_crew after insert or update or delete on crew_members for each row execute function bump_rota_revision();
create trigger rota_revision_leave after insert or update or delete on crew_leave for each row execute function bump_rota_revision();
create trigger rota_revision_charter after insert or update or delete on charter_periods for each row execute function bump_rota_revision();
create trigger rota_revision_settings after insert or update or delete on watch_settings for each row execute function bump_rota_revision();
create trigger rota_revision_lanes after insert or update or delete on watch_lanes for each row execute function bump_rota_revision();
create trigger rota_revision_departments after insert or update or delete on lane_departments for each row execute function bump_rota_revision();

create function publish_rota(p_vessel uuid,p_revision bigint,p_plan jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare sid uuid; rev bigint; cap int;
begin
 select rota_revision into rev from vessels where id=p_vessel for update;
 if rev is distinct from p_revision then raise exception 'Configuration changed during generation. Please try again.'; end if;
 select case product_tier when 'solo' then 1 when 'dual' then 2 when 'triple' then 3 else 0 end into cap from profiles where vessel_id=p_vessel and payment_status='active';
 if cap is null or (select count(*) from watch_lanes where vessel_id=p_vessel and active) not between 1 and cap then raise exception 'Subscription lane limit exceeded'; end if;
 if exists(select 1 from jsonb_to_recordset(p_plan->'assignments') a(lane_id uuid,crew_id uuid) where not exists(select 1 from crew_members c where c.id=a.crew_id and c.vessel_id=p_vessel) or not exists(select 1 from watch_lanes l where l.id=a.lane_id and l.vessel_id=p_vessel and l.active)) then raise exception 'Invalid assignment owner'; end if;
 if exists(select 1 from jsonb_to_recordset(p_plan->'assignments') a(crew_id uuid,watch_date date) group by crew_id,watch_date having count(*)>1) then raise exception 'Duplicate daily crew assignment'; end if;
 update schedules s set rota_snapshot=h.snapshot
 from jsonb_to_recordset(p_plan->'legacy_snapshots') h(id uuid,snapshot jsonb)
 where s.id=h.id and s.vessel_id=p_vessel and s.engine_version=1 and not(s.rota_snapshot ? 'opportunities');
 update schedules set is_current=false where vessel_id=p_vessel and is_current;
 insert into schedules(vessel_id,start_date,end_date,horizon_weeks,is_current,engine_version,rota_snapshot)
 values(p_vessel,(p_plan->>'start_date')::date,(p_plan->>'end_date')::date,(p_plan->>'horizon_weeks')::int,true,2,p_plan->'snapshot') returning id into sid;
 insert into watch_assignments(schedule_id,vessel_id,lane_id,crew_id,watch_date,day_type,is_friday)
 select sid,p_vessel,a.lane_id,a.crew_id,a.watch_date,a.day_type,a.is_friday
 from jsonb_to_recordset(p_plan->'assignments') a(lane_id uuid,crew_id uuid,watch_date date,day_type day_type,is_friday boolean);
 insert into fairness_events(schedule_id,vessel_id,lane_id,crew_id,watch_date,reason_code,detail)
 select sid,p_vessel,a.lane_id,a.crew_id,a.watch_date,a.reason_code,a.detail
 from jsonb_to_recordset(p_plan->'events') a(lane_id uuid,crew_id uuid,watch_date date,reason_code text,detail jsonb);
 delete from vessel_fairness where vessel_id=p_vessel;
 insert into vessel_fairness(vessel_id,crew_id,total_watches,weekday_watches,weekend_watches,friday_watches,weekday_opportunities,weekend_opportunities,friday_opportunities,last_watch_date,last_weekend_date,consecutive_run,fairness_score,deviation,balance,history_estimated)
 select p_vessel,a.crew_id,a.total_watches,a.weekday_watches,a.weekend_watches,a.friday_watches,a.weekday_opportunities,a.weekend_opportunities,a.friday_opportunities,a.last_watch_date,a.last_weekend_date,a.consecutive_run,a.fairness_score,a.deviation,a.balance,coalesce((p_plan->>'history_estimated')::boolean,false)
 from jsonb_to_recordset(p_plan->'scores') a(crew_id uuid,total_watches int,weekday_watches int,weekend_watches int,friday_watches int,weekday_opportunities int,weekend_opportunities int,friday_opportunities int,last_watch_date date,last_weekend_date date,consecutive_run int,fairness_score numeric,deviation numeric,balance text)
 where exists(select 1 from crew_members c where c.id=a.crew_id and c.vessel_id=p_vessel);
 update vessels set rota_revision=rota_revision+1 where id=p_vessel;
 update profiles set onboarding_complete=true,onboarding_step='complete' where vessel_id=p_vessel and not onboarding_complete;
 return sid;
end $$;
revoke all on function publish_rota(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function publish_rota(uuid,bigint,jsonb) to service_role;

create function replace_rota_seed(p_vessel uuid,p_revision bigint,p_records jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare rev bigint;
begin
 select rota_revision into rev from vessels where id=p_vessel for update;
 if rev is distinct from p_revision then raise exception 'Crew or configuration changed. Retry the import.'; end if;
 insert into rota_seed(vessel_id,records,history_estimated) values(p_vessel,p_records,true)
 on conflict(vessel_id) do update set records=excluded.records,baseline='{}',history_estimated=true,updated_at=now();
 update vessels set rota_revision=rota_revision+1 where id=p_vessel;
end $$;
revoke all on function replace_rota_seed(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function replace_rota_seed(uuid,bigint,jsonb) to service_role;
