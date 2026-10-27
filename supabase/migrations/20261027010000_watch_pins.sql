-- Fixed watches (docs/fixed-watches.md): the captain names someone for a
-- specific date BEFORE the rota is built, and generation plans around it.
--
-- This is a CONFIGURATION input, not a rota table — the same standing as
-- crew_leave and charter_periods, so the client owns it (client-RW,
-- vessel-scoped). The schedule and fairness tables stay server-written
-- (master.md §2 invariant 4): a pin only ever reaches them through
-- generate-schedule, which re-derives vessel_id from the JWT.

create table watch_pins (
  id              uuid primary key default gen_random_uuid(),
  vessel_id       uuid not null references vessels(id) on delete cascade,
  crew_member_id  uuid not null references crew_members(id) on delete cascade,
  lane_id         uuid not null references watch_lanes(id) on delete cascade,
  watch_date      date not null,
  -- Rule codes the captain has consented to for THIS pin. Checked against the
  -- violations recomputed on every evaluation, so a code that appears later
  -- (leave booked over an existing pin) is unacknowledged and re-opens consent.
  acknowledged    text[] not null default '{}',
  note            text,
  created_at      timestamptz not null default now(),
  -- One person, one watch a day, and one person per lane-day. Both are refused
  -- outright rather than consented away, so they belong in the schema.
  constraint watch_pins_one_per_crew_day unique (vessel_id, crew_member_id, watch_date),
  constraint watch_pins_one_per_lane_day unique (vessel_id, lane_id, watch_date)
);
create index on watch_pins(vessel_id);
create index on watch_pins(crew_member_id);

alter table watch_pins enable row level security;
create policy "watch_pins_rw_own_vessel" on watch_pins
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());
