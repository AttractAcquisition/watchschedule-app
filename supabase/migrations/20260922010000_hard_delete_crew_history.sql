-- Hard crew deletion: a captain may deliberately remove a crew member and all
-- of that member's historical schedule/fairness data. The UI requires a
-- two-step destructive confirmation before issuing this delete.
--
-- fairness_ledger, fairness_events, and crew_leave already cascade from
-- crew_members. watch_assignments was the remaining RESTRICT edge, which made
-- a hard delete impossible once the member appeared in a generated schedule.
-- Schedules themselves remain as version containers; their deleted member's
-- assignment rows are removed.

alter table watch_assignments
  drop constraint if exists watch_assignments_crew_id_fkey;

alter table watch_assignments
  add constraint watch_assignments_crew_id_fkey
  foreign key (crew_id) references crew_members(id) on delete cascade;
