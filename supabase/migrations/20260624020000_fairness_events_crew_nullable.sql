-- Phase 7: allow a crew-less fairness_event.
-- schedule.md §5/§10 and fairness.md §8.3 require recording a fairness_event with
-- reason 'no_eligible_crew' when a lane has no eligible crew for a date — but that
-- event has NO crew to attach, and crew_id was NOT NULL. Relax it: crew_id is null
-- ONLY for such gap events; every assignment-driven event still carries a crew_id.
-- Backward compatible (relaxes a constraint; existing rows unaffected). Idempotent.
alter table fairness_events alter column crew_id drop not null;
