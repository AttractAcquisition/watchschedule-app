-- Generation window (schedule.md §5.1): a run's span can be a rolling horizon
-- in weeks, a calendar month, or an explicit date range. month and range are the
-- same mechanism — the month picker just fills the two dates — so the engine
-- stays date-driven and deterministic. One cap in every shape: horizon_weeks
-- 1..13, or an explicit window of at most 91 days inclusive.
create type generation_mode as enum ('weeks', 'month', 'range');

alter table watch_settings
  add column generation_mode generation_mode not null default 'weeks',
  add column generation_start_date date,
  add column generation_end_date date;

alter table watch_settings
  add constraint generation_window_shape check (
    case when generation_mode = 'weeks'
      then generation_start_date is null and generation_end_date is null
      else generation_start_date is not null and generation_end_date is not null
        and generation_end_date >= generation_start_date
        and generation_end_date - generation_start_date <= 90
    end
  );

-- Persist the window alongside the rest of the configuration. Unchanged from
-- 20260923010000 except the three new columns and their validation: the client
-- cannot write watch_settings directly, so this is the only writer.
create or replace function save_watch_configuration(p_settings jsonb,p_lanes jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare v uuid; t product_tier; cap int; item jsonb; ds department[]; lid uuid; ids uuid[] := '{}'; n int:=0;
  gm generation_mode; gs date; ge date;
begin
 select vessel_id,product_tier into v,t from profiles where id=auth.uid() and payment_status='active';
 if v is null or t is null then raise exception 'Active subscription required'; end if;
 perform 1 from vessels where id=v and owner_id=auth.uid() for update;
 if not found then raise exception 'Vessel not found'; end if;
 cap:=case t when 'solo' then 1 when 'dual' then 2 else 3 end;
 if p_lanes is null or jsonb_typeof(p_lanes)<>'array' then raise exception 'Lanes must be an array'; end if;
 if jsonb_array_length(p_lanes) not between 1 and cap then raise exception 'Invalid active lane count'; end if;
 -- Validate the complete request before changing any rows.
 gm:=coalesce((p_settings->>'generation_mode')::generation_mode,'weeks');
 if gm='weeks' then
   gs:=null; ge:=null;
 else
   gs:=(p_settings->>'generation_start_date')::date; ge:=(p_settings->>'generation_end_date')::date;
   if gs is null or ge is null then raise exception 'Set a start and end date for the generation window'; end if;
   if ge<gs then raise exception 'The generation window must end on or after it starts'; end if;
   if ge-gs>90 then raise exception 'The generation window cannot be longer than 91 days'; end if;
   if ge<current_date then raise exception 'That generation window has already passed'; end if;
 end if;
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
 insert into watch_settings(vessel_id,tier,selected_departments,horizon_weeks,schedule_start_date,include_weekends,weekday_rotation_anchor,weekend_rotation_anchor,weekend_structure,generation_mode,generation_start_date,generation_end_date)
 values(v,t,'{}',(p_settings->>'horizon_weeks')::int,(p_settings->>'schedule_start_date')::date,(p_settings->>'include_weekends')::boolean,
 (p_settings->>'weekday_rotation_anchor')::int,(p_settings->>'weekend_rotation_anchor')::int,(p_settings->>'weekend_structure')::weekend_structure,gm,gs,ge)
 on conflict(vessel_id) do update set tier=excluded.tier,selected_departments='{}',horizon_weeks=excluded.horizon_weeks,
 schedule_start_date=excluded.schedule_start_date,include_weekends=excluded.include_weekends,
 weekday_rotation_anchor=excluded.weekday_rotation_anchor,weekend_rotation_anchor=excluded.weekend_rotation_anchor,
 weekend_structure=excluded.weekend_structure,generation_mode=excluded.generation_mode,
 generation_start_date=excluded.generation_start_date,generation_end_date=excluded.generation_end_date;
end $$;
revoke all on function save_watch_configuration(jsonb,jsonb) from public,anon;
grant execute on function save_watch_configuration(jsonb,jsonb) to authenticated;
