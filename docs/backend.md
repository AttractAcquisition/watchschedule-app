<!-- WatchSchedule spec set — v2 (cross-referenced & seam-verified). Document 3 of 6: backend. AUTHORITATIVE for data contracts; on conflict this doc wins for behaviour. -->
# backend.md — WatchSchedule Backend Architecture

> **Purpose.** The authoritative server-side contract for WatchSchedule. Supabase is the **single source of truth**: Postgres (schema + RLS), Auth, Storage, and Edge Functions (Deno). Stripe is the payment processor; Claude powers the schedule chatbot and the OCR/classification assists. This document defines every table, policy, bucket, secret, and Edge Function — including exact request/response shapes the frontend (`frontend.md`) must conform to. The scheduling and fairness *algorithms* are specified in `schedule.md` and `fairness.md`; this document defines the *functions that run them* and the data they read/write.

**Golden rules**
- The client holds only the **anon key**. Stripe secret, Supabase **service-role** key, and the **Claude API key** live only in Edge Function secrets.
- **RLS is the real access gate.** Every table is RLS-protected and scoped to the user's vessel. The frontend's routing is UX only.
- **`payment_status` and `product_tier` are written only by the Stripe webhook** (service-role), never by the client.
- The watch schedule and fairness scores are written only by server functions (`generate-schedule`, `seed-fairness`), never by the client.

---

## 1. High-Level Topology

```
  React SPA (GitHub Pages, anon key)
        |
        |  supabase-js: Auth, RLS-scoped table reads/writes, functions.invoke()
        v
  +-------------------- SUPABASE (single source of truth) --------------------+
  |  Auth (email/password, OAuth)                                             |
  |  Postgres (tables + enums + RLS + triggers)                               |
  |  Storage (crew-list uploads, past-schedule uploads)                       |
  |  Edge Functions (Deno):                                                   |
  |    create-checkout-session        -> Stripe Checkout                      |
  |    stripe-webhook                 <- Stripe events (service-role writes)  |
  |    create-billing-portal-session  -> Stripe Customer Portal               |
  |    parse-crew-list                -> Claude vision OCR + classify         |
  |    parse-past-schedule / seed-fairness -> seed persistent fairness ledger |
  |    generate-schedule              -> runs schedule.md + fairness.md       |
  |    schedule-chat                  -> Claude Q&A over schedule + fairness   |
  +--------------------------------------------------------------------------+
        |                                   |                         |
        v                                   v                         v
     Stripe (payments)               Anthropic API (Claude)     (no other infra)
```

The vessel/account is the tenant boundary. One paying user = one vessel for v1 (captain account). Multi-user-per-vessel is a future extension; design the schema with a `vessel_id` foreign key everywhere so it's ready, but v1 treats the authenticated user as the vessel owner.

---

## 2. Database Schema (Postgres)

> Conventions: `uuid` PKs (`gen_random_uuid()`), `created_at timestamptz default now()`, `updated_at` maintained by trigger. Monetary values are not stored here (Stripe owns billing); we store only subscription *state*. All tables carry `vessel_id` and are RLS-scoped.

### 2.1 Enums
```sql
create type product_tier as enum ('solo', 'dual', 'triple');
create type payment_status as enum ('unpaid', 'active', 'past_due', 'canceled');
create type department as enum ('deck', 'interior', 'engineering', 'officer');
create type watch_lane_kind as enum ('solo', 'dept');         -- solo = single shared pool; dept = department lane
create type day_type as enum ('weekday', 'weekend');           -- Mon-Fri vs Sat-Sun rotations
create type onboarding_step as enum ('crew', 'settings', 'generate', 'complete');
create type ineligibility_reason as enum ('leave', 'sick', 'training', 'role_exempt', 'other');
create type weekend_structure as enum ('per_day', 'sat_sun_block', 'fri_sat_sun_block'); -- B6: weekend coverage shape
create type charter_status as enum ('booked', 'cancelled'); -- B7: only 'booked' pauses generation
```

### 2.2 Tables

**`vessels`** — the tenant. One per paying account in v1.
```sql
create table vessels (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'My Vessel',
  length_m      numeric,                      -- e.g. 72
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(owner_id)                            -- one vessel per user (v1)
);
```

**`profiles`** — per-user state the gate reads. Drives auth->payment->onboarding routing.
```sql
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  vessel_id           uuid references vessels(id) on delete cascade,
  email               text,
  payment_status      payment_status not null default 'unpaid',
  product_tier        product_tier,                         -- null until paid
  onboarding_step     onboarding_step not null default 'crew',
  onboarding_complete boolean not null default false,
  stripe_customer_id  text,                                 -- service-role: create-checkout-session + webhook
  stripe_subscription_id text,                              -- service-role: webhook
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
```
> **Column write-authority (precise).** Two distinct categories:
> - **Access-gate columns — `payment_status` and `product_tier`:** written **ONLY** by `stripe-webhook` (service-role). These decide access, so nothing else may write them. The client may read them; it may never write them (enforced by the §3 RLS policy **and** the `block_gate_column_writes` trigger).
> - **Stripe reference columns — `stripe_customer_id`, `stripe_subscription_id`:** server-written via service-role only. `stripe_customer_id` may be written by `create-checkout-session` (on customer create, §6.1) and by `stripe-webhook` (upsert); `stripe_subscription_id` is written by `stripe-webhook`. The client may read them; it never writes them (same §3 policy + trigger block client writes to all four columns).

**`crew_members`** — the crew list.
```sql
create table crew_members (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  full_name     text not null,
  position      text not null,                 -- e.g. 'Chief Officer', '2nd Engineer'
  department    department not null,           -- detected, captain-confirmable
  eligible      boolean not null default true, -- "not eligible for watch" toggle (false = excluded)
  ineligible_reason ineligibility_reason,      -- nullable; set when eligible=false
  ineligible_note   text,
  available_from date not null default current_date, -- C1: crew availability start. NEW crew default to insertion date via this DEFAULT (every insert path — OCR onboarding, settings-upload OCR, manual — captain enters nothing). Additive groundwork; consumed by fairness only from C2.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on crew_members(vessel_id);
-- C1 backfill (migration 20260627020000): existing crew set to a single PER-VESSEL
-- anchor = COALESCE(min(schedules.start_date), vessels.created_at) — per-vessel (NOT
-- per-crew created_at) so every existing vessel's crew get EQUAL available_from,
-- which makes C2's opportunity-fairness degrade to today's behaviour for same-roster
-- vessels. available_from is captain-editable config under the existing
-- crew_rw_own_vessel RLS policy (client-RW, vessel-scoped).
```

**`watch_settings`** — the shared settings (onboarding Step 2 == /settings). One row per vessel.
```sql
create table watch_settings (
  vessel_id            uuid primary key references vessels(id) on delete cascade,
  tier                 product_tier not null,         -- mirrors profiles.product_tier at config time
  -- Lane configuration (B5 — "up to N, floor of 1"):
  --   solo  -> selected_departments is empty/ignored; pool = all eligible crew
  --   dual  -> 1 or 2 departments selected
  --   triple-> 1, 2, or 3 departments selected
  selected_departments department[] not null default '{}',
  -- Horizon: how far ahead to generate, capped at 3 months.
  horizon_weeks        int not null default 4 check (horizon_weeks between 1 and 13),
  schedule_start_date  date not null,
  include_weekends     boolean not null default true,  -- whether Sat/Sun rota is generated
  weekend_structure    weekend_structure not null default 'per_day', -- B6: per_day | sat_sun_block | fri_sat_sun_block (structure only; scoring unchanged, counts per covered day)
  -- Rotation anchors (optional; engine has sane defaults):
  weekday_rotation_anchor int default 0,               -- starting index into eligible pool for Mon-Fri
  weekend_rotation_anchor int default 0,               -- starting index for Sat-Sun
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- B5 relaxed this from exactly-N to floor-1/max-N (migration
  -- 20260626010000_dept_count_floor_one.sql — a NEW migration; the Phase-1 file
  -- is unchanged). Pure relaxation: the old exact-N domain is a subset, so no
  -- existing row is invalidated. Fewer lanes = fewer per-lane ledgers; the
  -- fairness engine (which loops ACTIVE lanes, scores per-lane) is untouched.
  constraint dept_count_matches_tier check (
    (tier = 'solo'   and cardinality(selected_departments) = 0) or
    (tier = 'dual'   and cardinality(selected_departments) between 1 and 2) or
    (tier = 'triple' and cardinality(selected_departments) between 1 and 3)
  )
);
```

**`watch_lanes`** — the concrete lanes a vessel runs (derived from settings; one per fairness ledger).
```sql
create table watch_lanes (
  id          uuid primary key default gen_random_uuid(),
  vessel_id   uuid not null references vessels(id) on delete cascade,
  kind        watch_lane_kind not null,        -- 'solo' or 'dept'
  department  department,                       -- null when kind='solo'; set when kind='dept'
  label       text not null,                    -- 'Watch' (solo) or 'Deck' / 'Interior' etc.
  active      boolean not null default true,    -- false = retired (kept for fairness history, never scheduled)
  created_at  timestamptz not null default now(),
  unique(vessel_id, kind, department)
);
create index on watch_lanes(vessel_id);
create index on watch_lanes(vessel_id, active);
```
> Solo -> exactly one lane (`kind='solo'`). Dual -> two `dept` lanes. Triple -> three `dept` lanes. `generate-schedule` and `seed-fairness` operate per lane, on **`active=true` lanes only**. Retiring a department sets `active=false` (its `fairness_ledger`/`fairness_events` are retained — never deleted); re-adding it re-activates the existing lane (an UPDATE on the `unique(vessel_id, kind, department)` row, so no duplicate) so ledger keys stay stable. See schedule.md §3.

**`schedules`** — a generated schedule run (a versioned container).
```sql
create table schedules (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  generated_at  timestamptz not null default now(),
  start_date    date not null,
  end_date      date not null,
  horizon_weeks int not null,
  is_current    boolean not null default true,   -- the active schedule; previous runs kept for history
  created_at    timestamptz not null default now()
);
create index on schedules(vessel_id, is_current);
```
> Regeneration inserts a new `schedules` row and flips the previous one's `is_current=false`. The dashboard reads the current schedule.

**`watch_assignments`** — the per-day, per-lane assignments (the actual rota).
```sql
create table watch_assignments (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references schedules(id) on delete cascade,
  vessel_id     uuid not null references vessels(id) on delete cascade,
  lane_id       uuid not null references watch_lanes(id) on delete cascade,
  crew_id       uuid not null references crew_members(id) on delete restrict,
  watch_date    date not null,
  day_type      day_type not null,               -- weekday | weekend
  is_friday     boolean not null default false,  -- Friday carries higher fairness weight
  created_at    timestamptz not null default now()
);
create index on watch_assignments(schedule_id);
create index on watch_assignments(vessel_id, watch_date);
create unique index on watch_assignments(schedule_id, lane_id, watch_date); -- one crew per lane per day
```

**`fairness_ledger`** — the PERSISTENT cumulative fairness state, per crew member **per lane**. This is the differentiator. Seeded by past-schedule upload, updated on every generation. Survives across schedules (it does not reset).
```sql
create table fairness_ledger (
  id                 uuid primary key default gen_random_uuid(),
  vessel_id          uuid not null references vessels(id) on delete cascade,
  lane_id            uuid not null references watch_lanes(id) on delete cascade,
  crew_id            uuid not null references crew_members(id) on delete cascade,
  -- Cumulative counters (see fairness.md for exact semantics):
  total_watches      int not null default 0,
  weekday_watches    int not null default 0,
  weekend_watches    int not null default 0,
  friday_watches     int not null default 0,
  last_watch_date    date,
  last_weekend_date  date,                         -- used for the "no Monday after weekend" rule
  consecutive_run    int not null default 0,       -- current consecutive-day exposure
  -- Immutable SEED base (set ONCE by seed-fairness from uploaded history; never
  -- written by generate-schedule). The live counters above are rebuilt each run as
  -- SEED + replay(already-stood past) + forward (schedule.md §7.1).
  seed_total_watches    int not null default 0,
  seed_weekday_watches  int not null default 0,
  seed_weekend_watches  int not null default 0,
  seed_friday_watches   int not null default 0,
  seed_last_watch_date    date,
  seed_last_weekend_date  date,
  seed_consecutive_run  int not null default 0,
  -- C2 — OPPORTUNITY denominators (watch-slots of each rotation the crew was
  -- AVAILABLE for, since available_from), counted for every available crew on every
  -- scheduled date across seed + replay + run. Burden/cost/score are now RATES
  -- (count ÷ opportunities). seed_* mirror the immutable seed base. (migration
  -- 20260627030000; existing rows backfilled EQUAL per lane so degradation holds.)
  weekday_opportunities int not null default 0,
  weekend_opportunities int not null default 0,
  friday_opportunities  int not null default 0,
  seed_weekday_opportunities int not null default 0,
  seed_weekend_opportunities int not null default 0,
  seed_friday_opportunities  int not null default 0,
  -- Derived, cached for display (recomputed on update):
  fairness_score     numeric,                      -- 0-100, see fairness.md (C2: rate-based)
  updated_at         timestamptz not null default now(),
  unique(lane_id, crew_id)
);
create index on fairness_ledger(vessel_id);
```
> **Persistence:** `seed-fairness` initialises these from uploaded history; `generate-schedule` increments them as it assigns. The score shown on the dashboard is `fairness_score`, computed per `fairness.md`. Resetting requires an explicit action (not part of normal generation).
> **C2 (fairness correction):** burden is now `watches ÷ opportunities-available-for` (the opportunity counters above), using `crew_members.available_from` (C1). The change is contained to the scoring (`fairness_engine`) + a Step-A `available_from <= date` candidate filter + opportunity counting in `generate-schedule`/`seed-fairness`/replay; **`fairness_constants` is unchanged**. Historical treatment = grandfather-via-degradation: existing count-based rows keep their counts, opportunities were backfilled EQUAL per lane, so existing equal-availability vessels rank/score identically (byte-identical schedule) — no recompute, immutable schedules untouched.

**`fairness_events`** — an append-only audit of *why* each assignment happened, so the chatbot can explain decisions ("why is Alex on Friday").
```sql
create table fairness_events (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  schedule_id   uuid references schedules(id) on delete cascade,
  lane_id       uuid not null references watch_lanes(id) on delete cascade,
  crew_id       uuid references crew_members(id) on delete cascade,  -- nullable: null ONLY for 'no_eligible_crew' gap events (no crew to attach); assignment events always carry a crew_id
  watch_date    date,
  reason_code   text not null,        -- e.g. 'lowest_cost', 'friday_spread', 'weekend_balance', 'monday_exclusion_applied', 'tie_break_*', 'constraint_relaxed_*', 'no_eligible_crew'
  detail        jsonb,                -- structured snapshot: scores at decision time, candidates considered
  created_at    timestamptz not null default now()
);
create index on fairness_events(schedule_id);
```

**`storage_uploads`** — metadata for uploaded images (crew list / past schedules).
```sql
create table storage_uploads (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  bucket        text not null,        -- 'crew-lists' | 'past-schedules'
  object_path   text not null,
  kind          text not null,        -- 'crew_list' | 'past_schedule'
  parsed        boolean not null default false,
  created_at    timestamptz not null default now()
);
```

**`chat_messages`** — chatbot history (optional persistence so a conversation survives reloads).
```sql
create table chat_messages (
  id            uuid primary key default gen_random_uuid(),
  vessel_id     uuid not null references vessels(id) on delete cascade,
  role          text not null,        -- 'user' | 'assistant'
  content       text not null,
  created_at    timestamptz not null default now()
);
create index on chat_messages(vessel_id, created_at);

-- charter_periods (B7) — captain-entered pause windows. CONFIGURATION INPUT
-- (client-RW, like crew_members), consumed by generation. Only 'booked' charters
-- pause the rotation; 'cancelled' is retained for history but ignored by generation.
create table charter_periods (
  id          uuid primary key default gen_random_uuid(),
  vessel_id   uuid not null references vessels(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  label       text,
  status      charter_status not null default 'booked',
  created_at  timestamptz not null default now(),
  constraint charter_dates_ordered check (end_date >= start_date)
);
create index on charter_periods(vessel_id);

-- crew_leave (C3) — DATED per-crew leave = Charter Mode per crew member. Booked
-- leave dates are removed from THAT crew member's opportunity denominator (standing
-- preserved — neither for nor against them) and they aren't a candidate then; the
-- watch goes to an available crew member. CONFIGURATION input (client-RW, vessel-
-- scoped). Reuses charter_status ('booked' affects generation; 'cancelled' retained
-- but ignored). Distinct from crew_members.eligible (blanket, all-dates toggle).
create table crew_leave (
  id              uuid primary key default gen_random_uuid(),
  vessel_id       uuid not null references vessels(id) on delete cascade,
  crew_member_id  uuid not null references crew_members(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  label           text,
  status          charter_status not null default 'booked',
  created_at      timestamptz not null default now(),
  constraint leave_dates_ordered check (end_date >= start_date)
);
create index on crew_leave(vessel_id);
create index on crew_leave(crew_member_id);
```

### 2.3 `updated_at` trigger
```sql
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
-- attach to vessels, profiles, crew_members, watch_settings, fairness_ledger
```

---

## 3. Row-Level Security (RLS)

Enable RLS on **every** table. The pattern: a row is visible/editable only if its `vessel_id` belongs to the requesting user. `profiles` keys on the user id directly.

```sql
-- helper: the vessel owned by the current user
create or replace function current_vessel_id() returns uuid
language sql stable security definer as $$
  select id from vessels where owner_id = auth.uid()
$$;
```

**Profiles** — user reads/updates own row, but CANNOT modify gate columns:
```sql
alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

-- Client may update only benign columns; payment/tier/stripe columns are blocked.
create policy "profiles_update_own_safe" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());
-- Enforce immutability of gate columns at the column level via a trigger:
create or replace function block_gate_column_writes() returns trigger as $$
begin
  if (new.payment_status is distinct from old.payment_status)
     or (new.product_tier is distinct from old.product_tier)
     or (new.stripe_customer_id is distinct from old.stripe_customer_id)
     or (new.stripe_subscription_id is distinct from old.stripe_subscription_id)
  then
     raise exception 'gate columns are server-managed';
  end if;
  return new;
end; $$ language plpgsql;
create trigger trg_block_gate before update on profiles
  for each row when (auth.uid() is not null) execute function block_gate_column_writes();
```
> The `stripe-webhook` uses the **service-role** client, which bypasses RLS and the trigger guard (service-role connections set `auth.uid()` to null / use a privileged role), so it can write gate columns. Verify the trigger's `when` clause excludes service-role writes in implementation.

**Vessel-scoped tables** (crew_members, watch_settings, watch_lanes, **charter_periods**, schedules, watch_assignments, fairness_ledger, fairness_events, storage_uploads, chat_messages) — same shape:
```sql
alter table crew_members enable row level security;
create policy "crew_rw_own_vessel" on crew_members
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());
-- repeat the identical policy for each vessel-scoped table

-- charter_periods (B7) is CLIENT-RW config input (the captain books/cancels
-- charters) — same client-RW policy as crew_members, NOT SELECT-only:
alter table charter_periods enable row level security;
create policy "charter_rw_own_vessel" on charter_periods
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());

-- crew_leave (C3) — also CLIENT-RW config input (the captain books/cancels leave):
alter table crew_leave enable row level security;
create policy "crew_leave_rw_own_vessel" on crew_leave
  for all using (vessel_id = current_vessel_id())
  with check (vessel_id = current_vessel_id());
```

**Server-written tables** (schedules, watch_assignments, fairness_ledger, fairness_events): the client gets **SELECT** only; INSERT/UPDATE/DELETE are performed by Edge Functions using service-role. Implement as: client policy `for select using (vessel_id = current_vessel_id())`, and **no** client insert/update/delete policy (so only service-role can write).

**Vessels**: `for all using (owner_id = auth.uid())`.

**Storage buckets**: see section 4 — bucket policies restrict object paths to the user's vessel folder.

---

## 4. Storage

Two private buckets:
- **`crew-lists`** — uploaded crew list images. Object path convention: `{vessel_id}/{uuid}.{ext}`.
- **`past-schedules`** — uploaded previous schedules (Dual/Triple). Same path convention.

Both private. Storage RLS policies allow a user to read/write only objects whose path begins with their `vessel_id`:
```sql
-- example for crew-lists (repeat for past-schedules)
create policy "crew_list_rw_own_vessel"
on storage.objects for all
using (bucket_id = 'crew-lists' and (storage.foldername(name))[1] = current_vessel_id()::text)
with check (bucket_id = 'crew-lists' and (storage.foldername(name))[1] = current_vessel_id()::text);
```
Edge Functions read these objects via service-role to pass to Claude vision.

---

## 5. Secrets (Edge Function environment)

Set via `supabase secrets set`. **Never** in the frontend.
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...        # privileged DB writes (webhook, generate, seed)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...            # to verify webhook signatures
STRIPE_PRICE_SOLO_MONTH=price_...
STRIPE_PRICE_SOLO_YEAR=price_...
STRIPE_PRICE_DUAL_MONTH=price_...
STRIPE_PRICE_DUAL_YEAR=price_...
STRIPE_PRICE_TRIPLE_MONTH=price_...
STRIPE_PRICE_TRIPLE_YEAR=price_...
ANTHROPIC_API_KEY=...                # Claude (chatbot + OCR/classify)
ANTHROPIC_MODEL=claude-sonnet-4-6    # default model string for server calls
APP_URL=https://app.watchschedule.com
```

> **Price amounts (B1, marketing-site source of truth):** Solo €39/mo (€390/yr),
> Dual €99/mo (€990/yr), Triple €199/mo (€1990/yr). The six `STRIPE_PRICE_*`
> secrets point at the test-mode Price IDs at these amounts; the Dual/Triple
> secrets were repointed to the €99/€199 IDs in B1 (the old €79/€149 Price
> objects are archived, not deleted). Stripe Prices are immutable — amount
> changes are always create-new + archive-old, never an edit.

---

## 6. Edge Functions (Deno) — Contracts

All functions: CORS enabled for the app origin; verify the caller's JWT (except the Stripe webhook, which verifies a Stripe signature instead). Use the **service-role** client only where privileged writes are required, and always re-derive `vessel_id` from the authenticated user — never trust a `vessel_id` sent by the client.

### 6.1 `create-checkout-session`
Starts Stripe Checkout for a chosen tier.
- **Auth:** user JWT required.
- **Request:**
```json
{ "tier": "solo|dual|triple", "interval": "month|year" }
```
- **Behaviour:** map (tier, interval) -> Stripe Price ID (from secrets). Create/find the Stripe customer for this user (store `stripe_customer_id` on profile if new). Create a Checkout Session in `subscription` mode with:
  - `success_url = {APP_URL}/payment-processing`
  - `cancel_url  = {APP_URL}/payment-required`
  - `metadata = { user_id, vessel_id, tier }` and `subscription_data.metadata` likewise (so the webhook can read tier reliably).
- **Response:**
```json
{ "url": "https://checkout.stripe.com/..." }
```
- Client redirects to `url`.

### 6.2 `stripe-webhook`
The only writer of gate columns. Server-to-server.
- **Auth:** verify `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` (use the async constructor for Deno: `stripe.webhooks.constructEventAsync`). No JWT.
- **Events handled (minimum):**
  - `checkout.session.completed` -> read `metadata.user_id` + `metadata.tier`; set profile `payment_status='active'`, `product_tier=<tier>`, store `stripe_customer_id`, `stripe_subscription_id`.
  - `customer.subscription.updated` -> sync `payment_status` (`active` / `past_due`) **and derive `product_tier` from the subscription's CURRENT price** (B4). A `{priceId -> tier}` reverse-map is built from the 6 `STRIPE_PRICE_*` secrets already in the Edge env (the mirror of `create-checkout-session`'s `PRICE_ENV`); the tier is taken from `sub.items.data[0].price.id`. **Price is billing truth** — this drives the tier-upgrade flow (§6.8) and also corrects `product_tier` for any portal-driven price change, and it never trusts a client/metadata tier claim. `product_tier` is only written when the price maps to a known tier (otherwise left untouched).
  - `customer.subscription.deleted` -> `payment_status='canceled'`.
- **Writes:** via **service-role** client (bypasses RLS), updating `profiles`. Idempotent (every handler is an UPDATE keyed by a stable id, re-deriving the same end state). **Sole authorized writer of `product_tier` / `payment_status`.**
- **Response:** `200` quickly (Stripe retries on non-2xx).
- **Note:** this flips the gate (signup) and the tier (upgrade); the client watches the profile row via Realtime and advances / unlocks accordingly.

### 6.3 `create-billing-portal-session`
- **Auth:** user JWT.
- **Request:** `{}` (customer derived from profile).
- **Behaviour:** create a Stripe Billing Portal session for `stripe_customer_id`, `return_url = {APP_URL}/settings`. Uses the account's **default portal configuration**, which B4 enabled for the full self-service set — **payment-method update, invoice history, subscription cancellation** (+ customer email/address/tax-id). No `configuration` is passed, so enabling features is pure Stripe config (no code change).
- **Response:** `{ "url": "https://billing.stripe.com/..." }`

### 6.4 `parse-crew-list`
OCR + department/position classification of an uploaded crew list image.
- **Auth:** user JWT.
- **Request:**
```json
{ "object_path": "{vessel_id}/{uuid}.jpg" }
```
- **Behaviour:** service-role reads the image from the `crew-lists` bucket; sends it to **Claude vision** (`ANTHROPIC_MODEL`) with a strict prompt: "Extract each crew member as {full_name, position}. Classify each into one of: deck, interior, engineering, officer. Return JSON only, no prose." Parse the JSON (strip code fences defensively). Does **not** write crew rows — returns parsed candidates for the captain to confirm in the UI.
- **Response:**
```json
{ "crew": [ { "full_name": "A. Mason", "position": "Chief Officer", "department": "officer" },
            { "full_name": "J. Walsh", "position": "2nd Engineer", "department": "engineering" } ] }
```
- The same position->department classification is exposed as a small shared helper (also used to auto-detect department on manual entry).

### 6.5 `parse-past-schedule` / `seed-fairness`
Seeds the PERSISTENT fairness ledger from uploaded previous schedules. **Dual/Triple only.**
> **Canonical name:** the Edge Function directory is **`seed-fairness`** (this is the name used in the repo layout, `master.md`, and `frontend.md`'s invoke). `parse-past-schedule` is a descriptive alias for the same function — do not create two functions.
- **Auth:** user JWT; reject if `product_tier='solo'`.
- **Request:**
```json
{ "object_paths": ["{vessel_id}/{uuid}.jpg", "..."] }
```
- **Behaviour:**
  1. Service-role reads each image; Claude vision extracts historical assignments: who stood watch on which dates, mapped to crew (fuzzy-match names to `crew_members`).
  2. For each lane (per `watch_lanes`), aggregate per crew member: counts of total / weekday / weekend / friday watches, last_watch_date, last_weekend_date, consecutive_run where determinable.
  3. **Upsert `fairness_ledger`** rows, writing the immutable **`seed_*` columns** (the starting cumulative state) — and, since this runs pre-generation, mirror them into the live counters so the pre-generation display matches. `generate-schedule` later reads the `seed_*` columns as its replay base and never overwrites them (schedule.md §7.1). Compute initial `fairness_score` per `fairness.md`. This is a **set/replace** (idempotent): re-uploading recomputes the seed from scratch and replaces it — it never increments.
  4. Record `storage_uploads.parsed=true`.
- **Response:**
```json
{ "seeded": true,
  "lanes": [ { "lane_id": "...", "members": [ { "crew_id": "...", "total_watches": 12, "weekend_watches": 4, "friday_watches": 2, "fairness_score": 78.4 } ] } ] }
```
- Idempotency: re-running should replace the seed, not double-count (treat as "set", not "increment", for the seeding operation).

### 6.6 `generate-schedule`
Runs the scheduling engine (`schedule.md`) using the persistent fairness ledger (`fairness.md`). Used for both first generation and regeneration.
- **Auth:** user JWT.
- **Request:**
```json
{ "from_date": "2026-07-01", "regenerate": false }
```
(`from_date` optional; defaults to settings `schedule_start_date` for first run, or "today" for regenerate. `regenerate=true` flips the prior current schedule to non-current.)
- **Behaviour (high level — algorithm in schedule.md):**
  1. Load `watch_settings`, derive/confirm `watch_lanes`.
  2. Build each lane's eligible pool:
     - Solo -> all `crew_members` with `eligible=true`.
     - Dual/Triple -> `crew_members` with `eligible=true` AND `department` in that lane's department.
  3. For each lane, generate assignments date-by-date across the horizon, treating **Mon–Fri** and **Sat–Sun** as **separate rotations**, applying Friday's higher weight and the **"no Monday watch for someone who stood the preceding weekend"** exclusion, selecting the lowest-cumulative fair candidate (full rules in `schedule.md`/`fairness.md`). Honour `watch_settings.weekend_structure` (B6 blocks) and **skip dates inside any `booked` `charter_periods` window** (B7 — paused: no assignment/ledger/event, rotation resumes correctly afterward from the unchanged ledger).
  4. Insert a `schedules` row (+ flip previous `is_current`), insert `watch_assignments`, **increment `fairness_ledger`**, and append `fairness_events` capturing the reason for each pick.
  5. Set `profiles.onboarding_complete=true` and `onboarding_step='complete'` if not already (first generation completes onboarding).
- **Writes:** service-role (schedules, assignments, ledger, events, profile flag).
- **Response:**
```json
{ "schedule_id": "...", "start_date": "...", "end_date": "...",
  "assignments_count": 224,
  "fairness": [ { "lane_id": "...", "members": [ { "crew_id": "...", "fairness_score": 91.2 } ] } ] }
```
- The client then reads the schedule + fairness via RLS-scoped selects.

### 6.7 `schedule-chat`
Claude-powered Q&A grounded in the vessel's current schedule + fairness data. Answers "why is Alex on Friday?", "who has the most weekends?", "is it fair?".
- **Auth:** user JWT.
- **Request:**
```json
{ "message": "Why is Alex on watch on Friday?", "history": [ { "role": "user|assistant", "content": "..." } ] }
```
- **Behaviour:**
  1. Re-derive `vessel_id` from JWT. Load the **current** schedule, its `watch_assignments`, the `fairness_ledger`, and relevant `fairness_events` (the recorded reasons) for this vessel — **server-side tenant scoping**; never accept schedule data from the client.
  2. Construct a Claude call (`ANTHROPIC_MODEL`) with a system prompt that says: you are WatchSchedule's assistant; answer only from the provided schedule and fairness data; be concise; cite dates and crew initials; if asked something not in the data, say so. Provide the schedule + fairness + events as structured context.
  3. Return the assistant's text. Optionally persist to `chat_messages`.
- **Response:**
```json
{ "reply": "Alex is on Friday 18 Jul because he had the lowest cumulative Friday count (1) in the Deck lane and hadn't stood the previous weekend. ..." }
```
- The Claude API key never leaves the function. The function answers strictly within the requesting vessel's data.

### 6.8 `upgrade-subscription` (B4 — tier upgrade)
Moves the caller's subscription UP to a higher tier's price. The client sends **only a target tier**; it never writes `product_tier`.
- **Auth:** user JWT; re-derive `user_id` / vessel from the JWT (never trust client tier claims).
- **Request:** `{ "target": "dual" | "triple" }`.
- **Behaviour:**
  1. Read `product_tier` + `stripe_subscription_id` from the **server** copy of the profile (service-role), never from the client.
  2. **Strictly-higher guard:** reject if `target` is the same as or lower than the current tier (rank solo<dual<triple), or if there is no subscription on file.
  3. Read the current subscription's billing **interval** (`month`/`year`) from its first item's price and map `(target, interval)` to the matching `STRIPE_PRICE_*` secret.
  4. `stripe.subscriptions.update(subId, { items:[{ id, price: <newPrice> }], proration_behavior:'create_prorations', metadata:{ user_id, tier:target } })` — pay the difference immediately. `metadata.tier` is **reference only**; the webhook derives `product_tier` from the new **price**.
- **Response:** `{ "ok": true, "target", "interval", "subscription_status" }`.
- **Gate:** does **NOT** write `product_tier`. Stripe fires `customer.subscription.updated` → `stripe-webhook` (§6.2) flips `product_tier` from the price. The client watches the profile via Realtime until the tier flips, then prompts for any newly-required settings (the shared `WatchSettingsForm`), which rebuilds lanes and retires the old lane (`active=false`, never deleted; fairness history preserved). `onboarding_complete` and the gate are untouched — the old lane/schedule keeps working until the captain reconciles. **Scope: upgrades only;** downgrades are deferred (cancellation handled by the portal).

---

## 7. Payment Flow (end-to-end)

```
1. User (authed, unpaid) on /payment-required picks tier+interval.
2. Client -> create-checkout-session {tier, interval} -> returns Stripe URL.
3. Client redirects to Stripe Checkout. User pays.
4. Stripe redirects to /payment-processing (success_url).
5. Stripe fires checkout.session.completed -> stripe-webhook (service-role):
      profiles.payment_status='active', product_tier=<tier>, stripe ids stored.
6. Client (watching profile via Realtime) sees payment_status flip -> routes to /onboarding.
7. Subscription lifecycle events keep payment_status synced (past_due/canceled).
```
The client never writes payment state. The webhook is the single writer. This is the mechanism behind the gate in `frontend.md`.

---

## 8. Deployment & Ops

- **Edge Functions:** developed/deployed via the Supabase CLI from VS Code (`supabase functions deploy <name>`). Claude Code is connected to Supabase to build and deploy these and to run migrations.
- **Migrations:** schema (section 2), RLS (section 3), storage policies (section 4) as SQL migrations under `supabase/migrations`. Apply via `supabase db push` / migration workflow.
- **Webhook registration:** register the `stripe-webhook` function URL in the Stripe dashboard; set `STRIPE_WEBHOOK_SECRET` accordingly. Test with Stripe CLI (`stripe listen --forward-to`).
- **Types:** after schema changes, regenerate frontend types (`supabase gen types typescript` -> `frontend.md` `types/db.ts`).
- **Order of build:** migrations (tables -> enums -> RLS -> triggers -> storage) first, then functions, then wire the frontend.

---

## 9. Security Checklist (must pass)
- [ ] Every table has RLS enabled and a vessel-scoped (or user-scoped) policy.
- [ ] Server-written tables expose SELECT-only to clients; writes are service-role only.
- [ ] `profiles` access-gate columns (payment_status, product_tier) are writable ONLY by `stripe-webhook`; the Stripe reference columns (stripe_customer_id, stripe_subscription_id) are server-written via service-role (create-checkout-session / webhook). All four are unwritable by clients (policy + trigger).
- [ ] Edge Functions re-derive `vessel_id` from the JWT; never trust a client-supplied vessel_id.
- [ ] `stripe-webhook` verifies the Stripe signature (async constructor) and is idempotent.
- [ ] `seed-fairness` and Triple/Dual-only capabilities reject Solo callers server-side.
- [ ] `schedule-chat` loads only the requesting vessel's data; Claude key stays server-side.
- [ ] Storage buckets are private with path-prefixed (vessel_id) policies.
- [ ] No secret keys present in any client bundle (anon key only).

> Supabase is the single source of truth; Stripe owns billing truth; Claude is a stateless reasoning service called only from the server. The schedule and fairness tables are written exclusively by server functions — the algorithms that fill them are specified next in `fairness.md` and `schedule.md`.
