-- C1 — Availability data model (additions-c.md PHASE C1). Add a per-crew
-- "available from" date. ADDITIVE groundwork only — NO scoring change; nothing
-- consumes this until C2.
--
-- Defaults:
--   NEW crew  -> current_date (insertion time) — captain enters nothing; every
--                insert path (onboarding OCR, settings-upload OCR, manual add)
--                gets it from the column DEFAULT, so no insert-code change needed.
--   EXISTING  -> a single PER-VESSEL anchor = COALESCE(earliest schedule start,
--                vessel.created_at). Per-vessel (NOT per-crew created_at) so every
--                existing vessel's crew end with EQUAL availability — which is what
--                makes C2's opportunity-fairness degrade to today's behaviour for
--                same-roster vessels (graceful degradation). Per-crew created_at
--                would risk scattering dates within a vessel that is currently fine.

alter table crew_members add column available_from date;

update crew_members c set available_from = coalesce(
  (select min(s.start_date) from schedules s where s.vessel_id = c.vessel_id),
  (select v.created_at::date from vessels v where v.id = c.vessel_id)
);

alter table crew_members alter column available_from set default current_date;
alter table crew_members alter column available_from set not null;
