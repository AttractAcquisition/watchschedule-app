-- C2 — Fairness correction (THE deliberate, approved freeze amendment).
-- Additive opportunity counters on fairness_ledger. The fairness FORMULA changes
-- in fairness_engine.ts (burden/cost/score become rate = watches ÷ opportunities);
-- these columns persist the denominator so the rate is one source of truth (honest
-- chatbot "X of Y available" + stored rate-based fairness_score). fairness_constants
-- UNCHANGED. Existing rows backfilled EQUAL (per-lane opportunity totals from the
-- current schedule) so existing equal-availability vessels stay byte-identical via
-- graceful degradation (Option A: grandfather-via-degradation). seed_* opportunities
-- mirror the immutable seed_* counters (written by seed-fairness).

alter table fairness_ledger
  add column weekday_opportunities  int not null default 0,
  add column weekend_opportunities  int not null default 0,
  add column friday_opportunities   int not null default 0,
  add column seed_weekday_opportunities int not null default 0,
  add column seed_weekend_opportunities int not null default 0,
  add column seed_friday_opportunities  int not null default 0;

-- Backfill existing rows' live opportunity counters to the per-lane opportunity
-- totals of the current schedule (one assignment per lane per date => count of
-- dates per rotation). EQUAL across all crew in a lane (no scatter) => the C2 rate
-- formula ranks identically to today for existing vessels. seed_* stay 0 (no live
-- seeded vessel). Engine overwrites these on the next regeneration.
update fairness_ledger fl set
  weekday_opportunities = sub.wd,
  weekend_opportunities = sub.wk,
  friday_opportunities  = sub.fri
from (
  select wa.lane_id,
    count(*) filter (where wa.day_type = 'weekday') as wd,
    count(*) filter (where wa.day_type = 'weekend') as wk,
    count(*) filter (where wa.is_friday)            as fri
  from watch_assignments wa
  join schedules s on s.id = wa.schedule_id and s.is_current = true
  group by wa.lane_id
) sub
where fl.lane_id = sub.lane_id;
