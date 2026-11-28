-- Contact form on watchschedule.com (the marketing site).
--
-- The site is static and anonymous, so the table itself is closed: RLS on, no
-- policies, no grants to anon/authenticated. The only way in is the RPC below,
-- which validates every field, silently drops honeypot hits, and rate-limits
-- by sender and globally. Messages are read by the team with the service role
-- (Supabase dashboard / management tooling), never by browsers.

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 120),
  email       text not null check (char_length(email) between 3 and 254),
  vessel      text check (vessel is null or char_length(vessel) <= 120),
  topic       text not null default 'general' check (topic in ('general', 'sales', 'support', 'privacy')),
  message     text not null check (char_length(message) between 10 and 5000),
  source      text not null default 'website' check (char_length(source) <= 60),
  status      text not null default 'new' check (status in ('new', 'replied', 'closed', 'spam'))
);

create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_email_created_idx on public.contact_messages (lower(email), created_at desc);

alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from public, anon, authenticated;

create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_message text,
  p_vessel text default null,
  p_topic text default 'general',
  p_website text default null -- honeypot: real visitors never see or fill it
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_message text := btrim(coalesce(p_message, ''));
  v_vessel  text := nullif(btrim(coalesce(p_vessel, '')), '');
  v_topic   text := coalesce(nullif(btrim(coalesce(p_topic, '')), ''), 'general');
begin
  -- Bots fill every field. Pretend it worked so they learn nothing.
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    return;
  end if;

  if char_length(v_name) not between 1 and 120 then
    raise exception 'Please enter your name.' using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.' using errcode = '22023';
  end if;
  if char_length(v_message) < 10 then
    raise exception 'Please write a little more so we can help.' using errcode = '22023';
  end if;
  if char_length(v_message) > 5000 then
    raise exception 'Please keep your message under 5,000 characters.' using errcode = '22023';
  end if;
  if v_vessel is not null and char_length(v_vessel) > 120 then
    raise exception 'Vessel name is too long.' using errcode = '22023';
  end if;
  if v_topic not in ('general', 'sales', 'support', 'privacy') then
    v_topic := 'general';
  end if;

  -- Rate limits: 3 per sender per hour, 60 site-wide per hour.
  if (select count(*) from public.contact_messages
      where lower(email) = v_email and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'You have sent a few messages already. We will be in touch soon.' using errcode = '54000';
  end if;
  if (select count(*) from public.contact_messages
      where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are receiving a lot of messages right now. Please try again later.' using errcode = '54000';
  end if;

  insert into public.contact_messages (name, email, vessel, topic, message)
  values (v_name, v_email, v_vessel, v_topic, v_message);
end;
$$;

revoke all on function public.submit_contact_message(text, text, text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text, text, text) to anon, authenticated;
