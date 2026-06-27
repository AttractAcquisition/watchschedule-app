-- B6 — Weekend Watch Structure (additions-v2.md PHASE B6). Make the weekend
-- coverage shape configurable per vessel:
--   per_day           -> one person per day (CURRENT behaviour; the default)
--   sat_sun_block     -> one person covers the whole Sat+Sun
--   fri_sat_sun_block -> one person covers Fri+Sat+Sun
--
-- Pure addition: the column defaults to 'per_day', so every existing vessel keeps
-- today's exact behaviour and no row changes. This is a SCHEDULING-STRUCTURE setting
-- only — the fairness SCORING (weights/formula) is unchanged; block modes count
-- weekend_watches/friday_watches PER COVERED DAY, so the ledger unit stays "days
-- stood" everywhere (live + seeded + all modes).

create type weekend_structure as enum ('per_day', 'sat_sun_block', 'fri_sat_sun_block');

alter table watch_settings
  add column weekend_structure weekend_structure not null default 'per_day';
