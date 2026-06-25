<!-- WatchSchedule spec set — v2 (cross-referenced & seam-verified). Document 2 of 6: frontend. Conforms to backend.md contracts. -->
# frontend.md — WatchSchedule Frontend Architecture

> **Purpose.** Complete specification of the WatchSchedule client application: a React + TypeScript single-page application served as static files from GitHub Pages at `app.watchschedule.com`. This tells Claude Code exactly what to build on the client — stack, routing, the auth->payment->onboarding gate, every screen, state management, tier behaviour, and the contract with the Supabase backend. Pair with `backend.md` (server side), `branding.md` (visual system — LOCKED palette), `fairness.md` and `schedule.md` (the engines). Where this document and `backend.md` disagree on a payload shape, **`backend.md` wins**.

---

## 1. Stack & Tooling

- **Framework:** React 18 + TypeScript (`strict: true`).
- **Build:** Vite.
- **Styling:** Tailwind CSS, themed entirely from `branding.md`. Every `--ws-*` token is declared in a global `tokens.css` AND mapped into `tailwind.config.js` (`theme.extend.colors / fontFamily / spacing / borderRadius`) so they are usable as utilities (`bg-ws-navy`, `text-ws-gold`, `border-ws-line`). **No raw hex values in components — ever.**
- **Routing:** React Router v6+, `BrowserRouter`. **GitHub Pages SPA caveat:** Pages has no server rewrite, so deep links 404. Ship the standard fix — a `404.html` that redirects into `index.html` preserving the path, plus the matching restore script in `index.html`. (`HashRouter` is an acceptable fallback only if the redirect proves fragile; prefer clean URLs.)
- **Supabase client:** `@supabase/supabase-js` v2 — one shared instance in `src/lib/supabase.ts`, initialised with project URL + anon key (public, injected at build).
- **Server state / data fetching:** TanStack Query (React Query) for all server data (crew, settings, schedule, fairness, subscription). Local UI state via hooks/context. **No Redux** — the app is small.
- **Forms:** React Hook Form + Zod (onboarding settings, crew edits).
- **Icons:** Lucide React (stroke 1.5, per `branding.md`).
- **Dates:** `date-fns` for display/navigation math only. **Authoritative schedule generation is server-side** — the client never computes the rota.

### Environment variables (Vite, build-time, public only)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_APP_URL=https://app.watchschedule.com
```
No secret keys in the frontend, ever. Stripe secret, Supabase service-role, and Claude API keys live only in Edge Functions (`backend.md`).

---

## 2. The Core Gate (Auth -> Payment -> Onboarding -> App)

The spine of the app. On every load (and on auth-state change) a top-level `<AuthGate>` resolves the user's state and routes them to exactly one place.

### Resolution sequence
1. **Get session** (`supabase.auth.getSession()`). No session -> `/login`.
2. **Session exists** -> fetch the user's profile row (see `backend.md` schema) carrying `payment_status`, `product_tier`, and onboarding progress.
3. **Branch on `payment_status`:**
   - unpaid -> `/payment-required`
   - active -> check onboarding.
4. **Branch on `onboarding_complete`:**
   - false -> `/onboarding` (resume at the correct step — section 5)
   - true -> `/dashboard`

```
                         +-------------+
   load / auth change -> | getSession  |
                         +------+------+
                    no session  |  session
                  +-------------+-------------+
                  v                           v
              /login                 fetch profile row
                                              |
                       payment_status=unpaid  |  active
                      +-----------------------+----------+
                      v                                  v
              /payment-required               onboarding_complete?
                      |                        +---------+--------+
             (Stripe checkout)          false  v                  v  true
                      |                   /onboarding         /dashboard
       webhook flips payment_status            |
                      +-------------------------+
                 (realtime/refetch -> re-resolve gate)
```

### Gate rules (non-negotiable)
- **The frontend never trusts itself for access control.** RLS in Supabase is the real gate (`backend.md`). Client routing is UX only — the database refuses another vessel's data regardless of what the client does.
- **`payment_status` is written only by the Stripe webhook**, server-side. After Stripe Checkout the client lands on `/payment-processing` and **waits via Supabase Realtime (or polls) for `payment_status` to flip**, then advances. The client never writes its own payment status.
- **`product_tier`** also arrives from Stripe via the webhook and is **read-only** on the client. It drives onboarding settings, scheduling lanes, and feature gating.

---

## 3. Route Map

| Path | Screen | Guard |
|---|---|---|
| `/login` | Auth (sign in / sign up) | Public; if already authed, resolve gate |
| `/payment-required` | Plan selection + Stripe checkout launch | Authed + unpaid |
| `/payment-processing` | "Confirming your subscription..." (realtime/poll) | Authed, returned from Stripe |
| `/onboarding` | 3-step wizard (single route, internal step state) | Authed + paid + not onboarded |
| `/dashboard` | Fairness + watch calendar + chatbot + regenerate | Authed + paid + onboarded |
| `/settings` | Crew management + watch settings + billing | Authed + paid + onboarded |
| `*` | Resolve gate | — |

Top-bar nav exposes **only Dashboard and Settings**. Payment and onboarding are flow states, not nav items.

---

## 4. Screens — Detailed Specs

### 4.1 `/login` — Authentication
- Supabase Auth: email/password at minimum (`signInWithPassword` / `signUp`); OAuth providers (e.g. Google) via `signInWithOAuth` if configured. The brief calls this "simple Supabase OAuth to log in / sign up."
- Visual: full-bleed yacht/bridge-at-night photo with navy overlay (`branding.md`), centred card with logo, form, single primary CTA, sign-in/sign-up toggle.
- On success -> `<AuthGate>` resolves and routes onward.
- Errors in the interface voice ("That email is already registered. Sign in instead." — never raw codes).

### 4.2 `/payment-required` — Plan Selection
- Shown to authenticated users without an active subscription.
- Three tiers (from the marketing site / `branding.md`):
  - **Solo Watch** — EUR 39/mo (EUR 390/yr)
  - **Dual Watch** — EUR 99/mo (EUR 990/yr) — *Most Popular*
  - **Triple Watch** — EUR 199/mo (EUR 1990/yr)
  - Annual toggle (two months free). Copy: billed per watch structure the vessel runs.
- Each card has a "Start [tier]" primary button. Clicking calls the **`create-checkout-session`** Edge Function with `{ tier, interval }`, receives a Stripe Checkout URL, and redirects (`window.location.href = checkoutUrl`).
- The selected tier is encoded in the Checkout session metadata so the webhook writes the correct `product_tier`.

### 4.3 `/payment-processing` — Confirmation Wait
- Stripe `success_url` returns here.
- Calm "Confirming your subscription..." state.
- Subscribe to the profile row via **Supabase Realtime** (poll every ~2s as fallback) until `payment_status -> active`, then route to `/onboarding`.
- ~60s timeout -> friendly "still processing, refresh shortly / contact support" (never claim failure; the webhook may be delayed).
- Stripe `cancel_url` -> back to `/payment-required`, non-judgemental note.

### 4.4 `/onboarding` — The 3-Step Wizard
One route, internal stepper, progress persisted to the backend so refresh resumes (section 5). Progress header: **1 Crew · 2 Settings · 3 Generate**. Each step validates before advancing. Gated to paid, non-onboarded users.

> **Settings parity (important):** the settings rendered in **Step 2 are exactly the same settings shown on the `/settings` page** — one shared schema, one shared `WatchSettingsForm` component, rendered in both places. Build it once.

#### Step 1 — Build the crew list
- Two input paths (captain picks either):
  - **(a) Snap/upload crew list image** -> upload to a Supabase Storage bucket -> call **`parse-crew-list`** (OCR + position/department detection, `backend.md`). Returns `[{ name, position, department }]`.
  - **(b) Manual entry** -> repeatable rows: name + position. Entering a position auto-detects department (shared classification with the OCR path; client maps known positions -> departments with server confirmation). Captain can override.
- Both paths converge on an **editable review table** (name, position, department dropdown). Add / edit / remove rows before saving. **Nothing is trusted blindly — the captain confirms.**
- Departments: **Deck, Interior, Engineering, Officer** (the four watch-eligible departments referenced by the watch modes). A "Command/Captain" role may exist in the list but is typically not in a watch pool — eligibility is controlled per-member (section 4.6).
- On confirm -> persist crew to `crew_members` (RLS-scoped to this vessel). Advance to Step 2.

#### Step 2 — Watch settings (tier-specific) — SHARED WITH /settings
Render the shared `WatchSettingsForm`. Available controls depend on `product_tier`:

- **Solo Watch:** one watch lane. The watch pool is **every crew member toggled eligible, regardless of department** — there is no department selection. One person per day.
- **Dual Watch:** two concurrent lanes per day. The captain **selects which two departments** are on watch, chosen from **{ Deck, Engineering, Officer, Interior }**. Each selected department is its own lane with its own rotation and its own fairness ledger.
- **Triple Watch:** three concurrent lanes per day. The captain **selects which three departments** from the same set. Same per-lane rotation + per-lane fairness as Dual.

**Universal settings (all tiers):**
- **Generation horizon** — how far ahead to generate, **capped at a maximum of 3 months** (e.g. 2 / 4 / 6 / 8 / 12 weeks). 
- **Schedule start date / watch start day.**
- Weekday vs weekend handling is **enforced by the engine** (Mon–Fri and Sat–Sun are separate rotations — `schedule.md`); surface only the user-tunable parts (e.g. whether weekends are scheduled at all, rotation start point).
- The precise settings schema is defined alongside `schedule.md`; this form binds controls to it and validates with Zod.

On confirm -> persist to `watch_settings`. Advance to Step 3.

#### Step 3 — Generate
- Primary action: one prominent **"Generate watch schedule"** button.
- **Past-schedule upload — Dual & Triple only:** an optional uploader above the button. Uploading previous schedules (image/file) calls **`parse-past-schedule` / `seed-fairness`** (`backend.md` + `fairness.md`): it extracts who has already stood watch, computes each crew member's starting fairness ledger **per lane/department**, and seeds the persistent fairness state so the first generated rota is fairness-aware rather than cold.
  - **Solo does NOT see this uploader.**
  - Copy: "Upload past schedules so the first rotation accounts for who's already stood watch."
- Pressing Generate calls **`generate-schedule`** (`schedule.md`), which writes the schedule + fairness scores to the database.
- "Generating" state per `branding.md` (calm computing state + skeleton grid).
- On success -> mark `onboarding_complete = true` (server-side, as part of the generate flow) -> route to `/dashboard`.

### 4.5 `/dashboard` — The Product
Top bar (`branding.md`), then two primary regions plus actions.

- **Fairness panel.** One **fairness score chip per crew member** (mono %, gauge bar coloured by the fairness scale). Grouping reflects the tier's fairness scope:
  - **Solo** -> single ungrouped list (one shared pool).
  - **Dual** -> grouped by the two selected department lanes.
  - **Triple** -> grouped by the three selected department lanes.
  - Clicking a member expands a breakdown (total watches, weekends, Fridays, last-on-watch, consecutive exposure) — the same data the chatbot uses. See `fairness.md`.
- **Watch calendar.** Calendar view of the generated schedule, **toggleable Week / Month** (segmented control).
  - Lanes depend on tier: Solo -> one lane; Dual -> two department lanes; Triple -> three department lanes.
  - Cells show assigned crew initials (mono); hover -> full name + position.
  - **Friday cells** and **weekend cells** visually distinguished per `branding.md` (Friday = higher-weight marker; Sat/Sun = separate-rotation background).
  - Paused/charter periods (if applicable) rendered distinctly.
  - Week view: 7-day detailed grid. Month view: compact, active week highlighted.
- **Actions:**
  - **Regenerate schedule** — calls `generate-schedule` again, recomputing from current crew + settings + the **up-to-date persistent fairness ledger** (regeneration stays fair, never random). Confirm dialog if a schedule already exists ("Regenerate from today forward?"). Show generating state.
  - **Chatbot (Claude)** — docked panel/modal where the user asks natural-language questions about the schedule: *"Why is Alex on watch on Friday?"*, *"Who has the most weekends this month?"*, *"Is the rotation fair?"*. Calls **`schedule-chat`** (`backend.md`), which holds the schedule + fairness data as context and answers via Claude (key server-side only). Render per `branding.md`; cite schedule data in mono.
  - **Copy for WhatsApp** (additions.md A1) — a one-tap action beside Regenerate that formats the **current** schedule into day-keyed plain text and writes it to the clipboard (with a success confirmation; falls back to a selectable text area if the clipboard API is blocked). Pure client-side presentation over the assignments + crew already read for the dashboard — no backend call, recomputes no fairness. Format: a header line (vessel + date range), then one line per scheduled day — Solo `Mon 6 — Tom`; Dual/Triple grouped with lane labels `Mon 6 — Deck: Tom | Interior: Luke`. Plain text only (no markdown/emoji).
  - **Schedule history** (additions.md A2) — a read-only "History" action that opens a list of past **generated** schedules for the vessel (ordered by `generated_at`, most recent first, with a derived version index `v1, v2, …` and the current one marked). Each entry is openable read-only to view that version's assignments (the historical `watch_assignments` persist intact — regeneration flips `is_current=false`, never deletes). Reads via the existing SELECT-only vessel-scoped RLS — **no schema change, no new policy, no approval/lock lifecycle** (the audit confirmed none exists; schedules are generated, not approved). **No** editing, regenerate-from-history, or revert/restore.
- **Edge states:** no schedule yet (shouldn't happen post-onboarding) -> invite generation. Crew changed since last generation -> gentle "Crew has changed — regenerate to update the schedule" banner.

### 4.6 `/settings` — Crew & Watch Management
The captain's control surface. Three sections:

- **Crew management (CRUD):**
  - List all crew (name, position, department, eligibility).
  - **Add** (name + position -> auto department, override allowed).
  - **Edit** (name, position, department).
  - **Delete** (destructive button per `branding.md`; confirm).
  - **"Not eligible for watch" toggle** per member, with an optional reason (leave, sickness, role exemption, training/junior). Ineligible crew are excluded from the next generation's watch pool but stay in the list. Marked visually (status dot + label).
  - Make the timing explicit: "Changes apply when you regenerate the schedule."
- **Watch settings:** the **same shared `WatchSettingsForm`** from onboarding Step 2 — tier-specific lanes/department selection + generation horizon + start date. Editing does not auto-regenerate; offer a "Save & regenerate" affordance, otherwise the captain regenerates from the dashboard.
- **Subscription / account:** current tier, "Manage billing" -> **`create-billing-portal-session`** (Stripe customer portal), sign out. (Tier changes beyond the Stripe portal are out of scope for v1 — note for later.)

---

## 5. Onboarding Resumption & Progress Persistence
- Current step + partial progress persisted server-side (`profiles.onboarding_step` or equivalent, plus existence of crew/settings/schedule rows). On reload mid-onboarding, resume at the furthest completed step:
  - Crew saved, no settings -> Step 2.
  - Settings saved, no schedule -> Step 3.
- Keeps the gate deterministic and prevents refresh from losing progress.

---

## 6. Data Contracts (client <-> server)
Two channels:

1. **Direct table reads/writes via `supabase-js`**, governed by RLS: crew list, settings, reading the generated schedule + fairness rows. The client **reads** schedule/fairness; it does not compute them.
2. **Edge Function calls** (`supabase.functions.invoke(name, { body })`, JWT passed automatically) for anything privileged/compute-heavy:
   - `create-checkout-session` — start Stripe checkout for a tier.
   - `create-billing-portal-session` — open Stripe customer portal.
   - `parse-crew-list` — OCR + classify an uploaded crew list image.
   - `parse-past-schedule` / `seed-fairness` — seed fairness from uploaded past schedules (Dual/Triple).
   - `generate-schedule` — generate/regenerate the watch schedule + fairness scores.
   - `schedule-chat` — Claude-powered Q&A over the schedule.
   - (The Stripe `stripe-webhook` function is server-to-server; never called by the client.)

**Exact request/response shapes live in `backend.md`** — the frontend conforms to those.

---

## 7. Component Architecture (suggested structure)
```
src/
  lib/
    supabase.ts            # client init
    queryClient.ts         # React Query
    api/                   # typed wrappers around edge-function invokes
  auth/
    AuthGate.tsx           # session + profile resolution, routing
    useSession.ts
    useProfile.ts          # payment_status, product_tier, onboarding state
  routes/
    Login.tsx
    PaymentRequired.tsx
    PaymentProcessing.tsx
    Onboarding/
      Onboarding.tsx       # stepper shell
      StepCrew.tsx
      StepSettings.tsx     # renders shared WatchSettingsForm
      StepGenerate.tsx     # past-schedule uploader (Dual/Triple) + generate
    Dashboard/
      Dashboard.tsx
      FairnessPanel.tsx
      FairnessChip.tsx
      WatchCalendar.tsx    # week/month toggle, tier lanes
      RegenerateButton.tsx
      ScheduleChat.tsx     # Claude chatbot panel
    Settings/
      Settings.tsx
      CrewManager.tsx
      CrewRow.tsx
      WatchSettingsForm.tsx  # SHARED with onboarding Step 2
  components/
    ui/                    # Button, Card, Input, Select, StatusDot, Eyebrow, GaugeBar, Modal, Tooltip, SegmentedControl
    layout/
      TopBar.tsx
      AppShell.tsx
  styles/
    tokens.css             # all --ws-* custom properties (from branding.md)
    index.css
  types/
    db.ts                  # generated Supabase row types
    domain.ts              # CrewMember, WatchSettings, ScheduleEntry, FairnessScore, ProductTier, Department
```

- Generate types from the schema: `supabase gen types typescript` -> `types/db.ts`.
- `ProductTier = 'solo' | 'dual' | 'triple'`. `Department = 'deck' | 'interior' | 'engineering' | 'officer'`.
- Use `ProductTier` and the selected-departments setting to drive lanes, fairness grouping, and the past-schedule uploader.

---

## 8. Tier-Gating Rules (client-side UX, enforced server-side)
| Capability | Solo | Dual | Triple |
|---|---|---|---|
| Watch lane(s) | 1 (all eligible crew, no dept) | 2 (captain-selected depts) | 3 (captain-selected depts) |
| Department selection in settings | — | choose 2 of {Deck, Eng, Officer, Interior} | choose 3 of the same |
| Per-lane / per-department fairness ledgers | single pool | per selected dept | per selected dept |
| Past-schedule upload (fairness seeding) in Step 3 | — | yes | yes |
| Fairness grouping on dashboard | single list | by lane | by department |
| Coverage analytics | — | basic | yes |

The client hides/shows by tier, but the **server independently enforces** it (a Solo vessel calling a Triple-only capability must be rejected by the Edge Function / RLS). Client hiding is never security.

---

## 9. Hosting & Deployment (GitHub Pages)
- `vite build` -> static `dist/` -> GitHub Pages, custom domain `app.watchschedule.com` (CNAME).
- **SPA routing fix** (404 -> index redirect) as in section 1.
- Build-time env injects the public anon key only.
- All dynamic/privileged behaviour is in Supabase Edge Functions (`backend.md`), called over HTTPS — fully compatible with Pages serving static files.
- Set Supabase Auth **redirect URLs** and Stripe **success/cancel URLs** to the `app.watchschedule.com` origin.

---

## 10. What the Frontend Must NOT Do (guardrails)
- **Never** compute the watch schedule or fairness scores client-side — those are server engines (`schedule.md`, `fairness.md`). The client displays results.
- **Never** write `payment_status` or `product_tier` from the client — webhook-only.
- **Never** hold the Stripe secret key, Supabase service-role key, or Claude API key — anon key only.
- **Never** treat client-side route guards as security — they are UX; RLS is the gate.
- **Never** hardcode colours/fonts — use `branding.md` tokens via the Tailwind theme.

---

## 11. Build Order (frontend internal)
1. Scaffold (Vite + TS + Tailwind + `tokens.css` from `branding.md`), Supabase client, React Query, Router with Pages 404 fix.
2. UI primitives (`components/ui`) per `branding.md`.
3. `AuthGate` + session/profile resolution + route map (mock profile states first).
4. `/login`.
5. `/payment-required` + `/payment-processing` (wire to `create-checkout-session` once `backend.md` exists).
6. `/onboarding` (Crew -> shared Settings form -> Generate, with Dual/Triple past-schedule uploader).
7. `/dashboard` (FairnessPanel + WatchCalendar week/month + Regenerate + ScheduleChat).
8. `/settings` (CrewManager + the SAME WatchSettingsForm + billing portal link).
9. Polish: empty/edge/error states, reduced-motion, accessibility pass, responsive (iPad portrait).

> The frontend is the instrument's screen. The intelligence lives on the server. Keep this layer thin, typed, fast, and faithful to `branding.md`.
