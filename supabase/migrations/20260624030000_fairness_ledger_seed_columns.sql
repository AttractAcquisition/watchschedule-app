-- Phase 8: the immutable SEED base on fairness_ledger.
-- seed-fairness establishes a starting cumulative state from uploaded past
-- schedules. Per schedule.md §7.1 the live ledger is rebuilt every generation as
--   SEED + replay(already-stood past) + freshly-generated forward,
-- so the seed must survive generation untouched. These seed_* columns hold that
-- immutable base; generate-schedule reads them as its replay base and never
-- writes them. (Kept ON fairness_ledger per backend.md §6.5 — "upsert
-- fairness_ledger rows … the seed" — rather than a separate table.) Idempotent.
alter table fairness_ledger
  add column if not exists seed_total_watches    int  not null default 0,
  add column if not exists seed_weekday_watches  int  not null default 0,
  add column if not exists seed_weekend_watches  int  not null default 0,
  add column if not exists seed_friday_watches   int  not null default 0,
  add column if not exists seed_last_watch_date    date,
  add column if not exists seed_last_weekend_date  date,
  add column if not exists seed_consecutive_run   int  not null default 0;
