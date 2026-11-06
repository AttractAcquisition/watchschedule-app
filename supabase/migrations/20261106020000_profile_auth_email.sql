-- Auth owns the confirmed login email. Keep the legacy profile copy accurate
-- without changing auth identities, UUIDs, ownership, or billing/contact data.
create function public.sync_profile_auth_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end;
$$;
revoke all on function public.sync_profile_auth_email() from public, anon, authenticated;

create trigger on_auth_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_auth_email();

update public.profiles p set email = u.email
from auth.users u where u.id = p.id and p.email is distinct from u.email;

create function public.guard_profile_auth_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from (select u.email from auth.users u where u.id = new.id) then
    raise exception 'Login email is managed by Supabase Auth' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_auth_email() from public, anon, authenticated;
create trigger guard_profile_auth_email
  before update of email on public.profiles
  for each row execute function public.guard_profile_auth_email();
