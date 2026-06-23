-- Phase 1 · Step 2 — Tables (backend.md §2.2)
-- All 11 tables with exact columns, FKs, defaults, indexes and CHECK constraints.
-- Conventions: uuid PKs (gen_random_uuid()), created_at default now(),
-- updated_at maintained by trigger (Step 3). Every table carries vessel_id and
-- is RLS-scoped (Step 5).

-- vessels — the tenant. One per paying account in v1.
create table vessels (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'My Vessel',
  length_m      numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(owner_id)
);

-- profiles — per-user state the gate reads. Drives auth->payment->onboarding.
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  vessel_id           uuid references vessels(id) on delete cascade,
  email               text,
  payment_status      payment_status not null default 'unpaid',
  product_tier        product_tier,
  onboarding_step     onboarding_step not null default 'crew',
  onboarding_complete boolean not null default false,
  stripe_customer_id  text,
  stripe_subscription_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- crew_members — the crew list.
create table crew_members (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  full_name     text not null,
  position      text not null,
  department    department not null,
  eligible      boolean not null default true,
  ineligible_reason ineligibility_reason,
  ineligible_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on crew_members(vessel_id);

-- watch_settings — shared settings (onboarding Step 2 == /settings). One per vessel.
create table watch_settings (
  vessel_id            uuid primary key references vessels(id) on delete cascade,
  tier                 product_tier not null,
  selected_departments department[] not null default '{}',
  horizon_weeks        int not null default 4 check (horizon_weeks between 1 and 13),
  schedule_start_date  date not null,
  include_weekends     boolean not null default true,
  weekday_rotation_anchor int default 0,
  weekend_rotation_anchor int default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint dept_count_matches_tier check (
    (tier = 'solo'   and cardinality(selected_departments) = 0) or
    (tier = 'dual'   and cardinality(selected_departments) = 2) or
    (tier = 'triple' and cardinality(selected_departments) = 3)
  )
);

-- watch_lanes — concrete lanes a vessel runs (one per fairness ledger).
create table watch_lanes (
  id          uuid primary key default gen_random_uuid(),
  vessel_id   uuid not null references vessels(id) on delete cascade,
  kind        watch_lane_kind not null,
  department  department,
  label       text not null,
  created_at  timestamptz not null default now(),
  unique(vessel_id, kind, department)
);
create index on watch_lanes(vessel_id);

-- schedules — a generated schedule run (a versioned container).
create table schedules (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  generated_at  timestamptz not null default now(),
  start_date    date not null,
  end_date      date not null,
  horizon_weeks int not null,
  is_current    boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on schedules(vessel_id, is_current);

-- watch_assignments — per-day, per-lane assignments (the actual rota).
create table watch_assignments (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references schedules(id) on delete cascade,
  vessel_id     uuid not null references vessels(id) on delete cascade,
  lane_id       uuid not null references watch_lanes(id) on delete cascade,
  crew_id       uuid not null references crew_members(id) on delete restrict,
  watch_date    date not null,
  day_type      day_type not null,
  is_friday     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index on watch_assignments(schedule_id);
create index on watch_assignments(vessel_id, watch_date);
create unique index on watch_assignments(schedule_id, lane_id, watch_date); -- one crew per lane per day

-- fairness_ledger — PERSISTENT cumulative fairness state, per crew per lane.
create table fairness_ledger (
  id                 uuid primary key default gen_random_uuid(),
  vessel_id          uuid not null references vessels(id) on delete cascade,
  lane_id            uuid not null references watch_lanes(id) on delete cascade,
  crew_id            uuid not null references crew_members(id) on delete cascade,
  total_watches      int not null default 0,
  weekday_watches    int not null default 0,
  weekend_watches    int not null default 0,
  friday_watches     int not null default 0,
  last_watch_date    date,
  last_weekend_date  date,
  consecutive_run    int not null default 0,
  fairness_score     numeric,
  updated_at         timestamptz not null default now(),
  unique(lane_id, crew_id)
);
create index on fairness_ledger(vessel_id);

-- fairness_events — append-only audit of WHY each assignment happened.
create table fairness_events (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  schedule_id   uuid references schedules(id) on delete cascade,
  lane_id       uuid not null references watch_lanes(id) on delete cascade,
  crew_id       uuid not null references crew_members(id) on delete cascade,
  watch_date    date,
  reason_code   text not null,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index on fairness_events(schedule_id);

-- storage_uploads — metadata for uploaded images (crew list / past schedules).
create table storage_uploads (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  bucket        text not null,
  object_path   text not null,
  kind          text not null,
  parsed        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- chat_messages — chatbot history (optional persistence across reloads).
create table chat_messages (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  role          text not null,
  content       text not null,
  created_at    timestamptz not null default now()
);
create index on chat_messages(vessel_id, created_at);
