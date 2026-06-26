-- B5 — Tier flexibility: relax dept_count_matches_tier from EXACTLY-N to
-- "up to N, floor of 1" (additions-v2.md PHASE B5). This INTENTIONALLY reverses
-- the Phase-1 exact-N rule (migrations/20260623020000_tables.sql) — kept in a NEW
-- migration; the Phase-1 file is never edited.
--
-- New rule:  solo -> exactly 0 ;  dual -> 1 or 2 ;  triple -> 1, 2, or 3.
--
-- Pure RELAXATION: the old domain (solo=0, dual=2, triple=3) is a strict subset of
-- the new one, so EVERY existing watch_settings row still satisfies the new check —
-- no data migration, no row invalidated. The fairness engine is untouched (it loops
-- ACTIVE lanes and scores per-lane; fewer lanes = fewer independent ledgers).

alter table watch_settings drop constraint dept_count_matches_tier;

alter table watch_settings add constraint dept_count_matches_tier check (
  (tier = 'solo'   and cardinality(selected_departments) = 0) or
  (tier = 'dual'   and cardinality(selected_departments) between 1 and 2) or
  (tier = 'triple' and cardinality(selected_departments) between 1 and 3)
);
