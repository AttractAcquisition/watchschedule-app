-- Captain contact identity. Email remains owned by Supabase Auth; these fields
-- are the captain-facing identity captured during onboarding and editable only
-- by that captain through the existing own-profile RLS policy.
alter table profiles
  add column if not exists full_name text,
  add column if not exists username text;

create unique index if not exists profiles_username_ci_unique
  on profiles (lower(username))
  where username is not null;

alter table profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9_-]{2,31}$');
