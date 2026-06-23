-- Phase 1 · Step 1 — Enums (backend.md §2.1)
-- The seven domain enums. Created first so tables can reference them.

create type product_tier as enum ('solo', 'dual', 'triple');
create type payment_status as enum ('unpaid', 'active', 'past_due', 'canceled');
create type department as enum ('deck', 'interior', 'engineering', 'officer');
create type watch_lane_kind as enum ('solo', 'dept');         -- solo = single shared pool; dept = department lane
create type day_type as enum ('weekday', 'weekend');           -- Mon-Fri vs Sat-Sun rotations
create type onboarding_step as enum ('crew', 'settings', 'generate', 'complete');
create type ineligibility_reason as enum ('leave', 'sick', 'training', 'role_exempt', 'other');
