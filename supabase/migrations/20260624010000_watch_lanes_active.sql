-- Lane retirement marker (closes the Phase-5 spec/schema gap).
-- schedule.md §3 requires retired lanes to be "marked inactive" (never deleted —
-- that would cascade away fairness history). watch_lanes had no such flag.
--
-- `active` is the predicate the engine asks at every step ("is this lane live?"),
-- so a boolean is the right shape (chosen over retired_at: fairness_events already
-- provide the temporal audit, and the engine never needs the retirement time).
-- Existing and new lanes default to active=true. Idempotent.
alter table watch_lanes add column if not exists active boolean not null default true;

-- The scheduling/fairness engines filter on (vessel_id, active).
create index if not exists watch_lanes_vessel_active_idx on watch_lanes (vessel_id, active);

-- CONTRACT (Phase 6/7 must honour): generate-schedule and the fairness engine
-- operate on ACTIVE lanes only. Retired lanes (active=false) are retained for
-- history (their fairness_ledger/fairness_events survive) but are never scheduled
-- against. Re-adding a department re-activates its existing lane (flip active back
-- to true) — never a duplicate — so ledger keys stay stable. The
-- unique(vessel_id, kind, department) constraint makes that re-activation an
-- UPDATE, not a conflicting INSERT.
