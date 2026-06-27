-- B7 — Charter Mode (additions-v2.md PHASE B7). A charter period is a date range
-- during which the watch rotation is PAUSED: the generator skips assignment within
-- the range and resumes afterward from the correct crew (an emergent property of
-- the unchanged ledger — no burden accrues while paused, so the fairness selector
-- naturally resumes from the next-due crew). This is captain-entered CONFIGURATION
-- INPUT (like crew_members / watch_settings), consumed by generation — never a
-- server-computed output — so it is CLIENT-RW, vessel-scoped (the crew_members
-- pattern), NOT SELECT-only.

create type charter_status as enum ('booked', 'cancelled');

create table charter_periods (
  id          uuid primary key default gen_random_uuid(),
  vessel_id   uuid not null references vessels(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  label       text,
  status      charter_status not null default 'booked',  -- only 'booked' affects generation; 'cancelled' is retained for history
  created_at  timestamptz not null default now(),
  constraint charter_dates_ordered check (end_date >= start_date)
);
create index on charter_periods(vessel_id);

-- Client-RW, vessel-scoped (mirrors crew_members) — the captain manages charters.
alter table charter_periods enable row level security;
create policy "charter_rw_own_vessel" on charter_periods
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());
