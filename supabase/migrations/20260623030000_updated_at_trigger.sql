-- Phase 1 · Step 3 — updated_at trigger (backend.md §2.3)
-- Maintains updated_at on the tables that carry it: vessels, profiles,
-- crew_members, watch_settings, fairness_ledger.

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_set_updated_at before update on vessels
  for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on crew_members
  for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on watch_settings
  for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on fairness_ledger
  for each row execute function set_updated_at();
