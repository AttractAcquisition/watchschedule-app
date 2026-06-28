-- C3 — Dated per-crew leave (additions-c.md PHASE C3). Leave is Charter Mode
-- applied PER-CREW: a crew member's booked leave dates are removed from THEIR
-- opportunity denominator (standing preserved — neither for nor against them) and
-- they are not a candidate then. Freeze-safe: it feeds the post-C2 formula FEWER
-- opportunities/candidacy for the absent crew; it changes NO scoring.
-- Captain CONFIGURATION input (client-RW vessel-scoped, the crew_members/
-- charter_periods pattern). Reuses charter_status ('booked' | 'cancelled') for the
-- same soft-cancel semantics (only 'booked' affects generation).

create table crew_leave (
  id              uuid primary key default gen_random_uuid(),
  vessel_id       uuid not null references vessels(id) on delete cascade,
  crew_member_id  uuid not null references crew_members(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  label           text,
  status          charter_status not null default 'booked',
  created_at      timestamptz not null default now(),
  constraint leave_dates_ordered check (end_date >= start_date)
);
create index on crew_leave(vessel_id);
create index on crew_leave(crew_member_id);

alter table crew_leave enable row level security;
create policy "crew_leave_rw_own_vessel" on crew_leave
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());
