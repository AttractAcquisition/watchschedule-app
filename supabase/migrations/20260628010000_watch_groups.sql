-- C4 — Watch Groups (additions-c.md PHASE C4; the original B8 on the corrected
-- engine). A "group" is a bundle of 1+ departments acting as ONE combined lane —
-- its members pooled into one rotation. GENERALIZES the model: today's
-- single-department selection = groups-of-one. Additive; existing vessels untouched.
--
-- A lane's department SET lives in lane_departments (the junction). Disjointness
-- (a department in AT MOST ONE lane) is enforced by unique(vessel_id, department) —
-- this supersedes the one-department-per-lane watch_lanes unique constraint, which
-- assumed a lane == a single department. Only ACTIVE lanes hold junction rows
-- (retiring a lane frees its departments for re-grouping). Freeze-safe: this is a
-- pool-MEMBERSHIP model; the post-C2 scoring is unchanged.

create table lane_departments (
  id          uuid primary key default gen_random_uuid(),
  vessel_id   uuid not null references vessels(id) on delete cascade,
  lane_id     uuid not null references watch_lanes(id) on delete cascade,
  department  department not null,
  created_at  timestamptz not null default now(),
  constraint lane_departments_disjoint unique (vessel_id, department)
);
create index on lane_departments(vessel_id);
create index on lane_departments(lane_id);

-- Backfill: every existing ACTIVE department lane becomes a group-of-one (one
-- junction row). Solo lanes have no department rows (the pool is all eligible crew).
insert into lane_departments (vessel_id, lane_id, department)
select vessel_id, id, department
from watch_lanes
where kind = 'dept' and active = true and department is not null;

-- Disjointness now lives in lane_departments; a lane may span multiple departments.
alter table watch_lanes drop constraint if exists watch_lanes_vessel_id_kind_department_key;

-- lane_departments is captain CONFIGURATION (client-RW vessel-scoped, the
-- crew_members/watch_lanes pattern).
alter table lane_departments enable row level security;
create policy "lane_departments_rw_own_vessel" on lane_departments
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());
