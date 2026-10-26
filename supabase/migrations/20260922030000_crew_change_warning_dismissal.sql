-- Persist a captain's dismissal of the dashboard crew-change prompt. A later
-- crew edit has a newer updated_at timestamp and surfaces the prompt again.
alter table vessels
  add column crew_change_warning_dismissed_at timestamptz;
