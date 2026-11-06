-- Profile editing must never let a client retarget SECURITY DEFINER account
-- RPCs to another vessel by changing their profile's vessel_id.
create function public.guard_profile_membership() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and
    (new.id is distinct from old.id or new.vessel_id is distinct from old.vessel_id) then
    raise exception 'Account identity and vessel membership are server-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_membership() from public, anon, authenticated;
create trigger guard_profile_membership
  before update of id, vessel_id on public.profiles
  for each row execute function public.guard_profile_membership();
