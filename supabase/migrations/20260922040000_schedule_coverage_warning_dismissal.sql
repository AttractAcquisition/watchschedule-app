-- The expired/not-yet-active schedule notice is acknowledged independently from
-- the crew-change notice. A later generated schedule automatically resets it.
alter table vessels
  add column schedule_coverage_warning_dismissed_at timestamptz;

alter table vessels
  add column watch_settings_reconciliation_dismissed_at timestamptz;
