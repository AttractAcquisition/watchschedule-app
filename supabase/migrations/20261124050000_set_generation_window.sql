-- Choosing the generation window at the moment of regenerating
-- (docs/regenerate-window.md, 24 November 2026).
--
-- The window lived only in Settings → Watch configuration, so changing it meant
-- leaving the dashboard, finding the right panel, saving, coming back, and
-- regenerating. The window is the single most consequential choice in a
-- regeneration; it belongs in the dialog that performs one.
--
-- `watch_settings` is SELECT-only for the client (master.md §2 invariant 2), and
-- `save_watch_configuration` is the wrong instrument here: it rewrites the
-- vessel's LANES as well, relabelling them and rebuilding `lane_departments`.
-- Regenerating must not touch the lane configuration, so this RPC writes those
-- four columns and nothing else.
--
-- The same caps as everywhere: horizon 1–13 weeks, an explicit window at most
-- 91 days inclusive, and the shape constraint the table already enforces.

create or replace function set_generation_window(
  p_mode generation_mode,
  p_start date,
  p_end date,
  p_horizon_weeks int
) returns void
language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
  select vessel_id into v from profiles
   where id = auth.uid() and payment_status = 'active';
  if v is null then raise exception 'Active subscription required'; end if;
  perform 1 from vessels where id = v and owner_id = auth.uid() for update;
  if not found then raise exception 'Vessel not found'; end if;

  if p_mode = 'weeks' then
    if p_horizon_weeks is null or p_horizon_weeks not between 1 and 13 then
      raise exception 'Choose between 1 and 13 weeks.';
    end if;
    update watch_settings
       set generation_mode = 'weeks',
           generation_start_date = null,
           generation_end_date = null,
           horizon_weeks = p_horizon_weeks
     where vessel_id = v;
  else
    if p_start is null or p_end is null then
      raise exception 'Set a start and end date for the generation window.';
    end if;
    if p_end < p_start then
      raise exception 'The window ends before it starts.';
    end if;
    if p_end - p_start > 90 then
      raise exception 'A generation window covers at most 91 days (~3 months).';
    end if;
    update watch_settings
       set generation_mode = p_mode,
           generation_start_date = p_start,
           generation_end_date = p_end
     where vessel_id = v;
  end if;

  if not found then raise exception 'Configure your watch lanes before generating.'; end if;
end $$;

revoke all on function set_generation_window(generation_mode,date,date,int) from public, anon;
grant execute on function set_generation_window(generation_mode,date,date,int) to authenticated;
