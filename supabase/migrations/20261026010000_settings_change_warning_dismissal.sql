-- The dashboard's unapplied-change banner acknowledges crew edits and watch
-- configuration edits independently (frontend.md §4.5). Sharing the crew column
-- would let one dismissal hide the other kind of change. A later configuration
-- save has a newer watch_settings.updated_at and surfaces the prompt again; a
-- regeneration clears it, since the new generated_at is the newest timestamp.
alter table vessels
  add column settings_change_warning_dismissed_at timestamptz;
