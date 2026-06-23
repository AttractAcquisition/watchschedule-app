<!-- WatchSchedule spec set — v2 (cross-referenced & seam-verified). Document 6 of 6: master orchestrator. READ THIS FIRST. See §0.1 for the verified cross-document seam index. -->
# master.md — WatchSchedule Build Orchestrator

> **Read this first.** This is the control document for building WatchSchedule with Claude Code. It explains the system, the rules of engagement, and the **ordered build plan** — a sequence of self-contained prompts. Each phase names exactly which context documents to load, what to build, and how to verify it before proceeding. The five companion documents are the source of truth for their domains; this document is the conductor.

---

## 0. The Five Companion Documents (load as directed)

| Doc | Owns | Load for |
|---|---|---|
| **branding.md** | Visual system: LOCKED palette, type, components, motion, a11y | Any UI work |
| **frontend.md** | React/TS SPA: stack, the gate, screens, routing, tier UX, client contracts | Any frontend work |
| **backend.md** | Supabase: schema, enums, RLS, storage, secrets, the 7 Edge Function contracts, payment flow | Any backend/data work |
| **fairness.md** | The fairness algorithm: ledger, weights, candidate selection, score, tie-breaks, seeding | The fairness/score logic |
| **schedule.md** | The generation engine: lanes, two-rotation model, the loop, regeneration, edge cases | The schedule generator |

**Conflict rule:** if any two documents disagree, precedence is **backend.md (data contracts) > fairness.md / schedule.md (engine) > frontend.md (client) > branding.md (visual)** for behaviour; branding.md always wins on visual tokens. Never invent a contract — if something is unspecified, stop and flag it rather than guessing.

---

## 0.1 Cross-Document Seam Index (v2 — verified consistent)

These are the load-bearing seams between documents. They were cross-checked in v2; keep them aligned if you edit any document.

| Seam | Definition | Appears in |
|---|---|---|
| **Edge functions (7)** | `create-checkout-session`, `stripe-webhook`, `create-billing-portal-session`, `parse-crew-list`, `seed-fairness`, `generate-schedule`, `schedule-chat` | backend.md (contracts) = frontend.md (invokes) = master.md (phases) |
| **`stripe-webhook`** | canonical function name (not bare "webhook"); the **only** writer of `payment_status` / `product_tier` | backend.md 6.2, frontend.md 6, master.md Phase 3 |
| **`seed-fairness`** | canonical directory name; `parse-past-schedule` is an alias for the **same** function (do not create two) | backend.md 6.5, master.md Phase 8 |
| **Fairness↔schedule call** | `selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned) -> { crew_id, reason_code, detail }` then `updateLedger(lane, crew_id, date, dayType, isFriday)` | fairness.md §4 & §11 = schedule.md §5 & §11 (identical 6-arg signature) |
| **Tables (11)** | vessels, profiles, crew_members, watch_settings, watch_lanes, schedules, watch_assignments, fairness_ledger, fairness_events, storage_uploads, chat_messages | defined in backend.md §2; read/written per frontend.md, schedule.md, fairness.md |
| **Lane rule** | Solo = 1 lane (all eligible crew, no dept); Dual = 2 dept lanes; Triple = 3 dept lanes; one fairness ledger per lane | backend.md (watch_lanes + dept-count check), frontend.md §4.4/§8, schedule.md §3, fairness.md §1 |
| **Horizon cap** | `horizon_weeks` ∈ [1,13] (~3 months); enforced by DB check + UI control + engine clamp | backend.md §2, frontend.md §4.4, schedule.md §8 |
| **Departments (4)** | enum `deck, interior, engineering, officer` (Command/Captain is a role, not a watch dept; handled via per-member eligibility) | backend.md enum; matched in frontend.md, schedule.md |
| **Tiers (3)** | `solo` / `dual` / `triple`; Solo €39, Dual €79, Triple €149 (monthly); annual = 2 months free | backend.md enum + price secrets, frontend.md §4.2 |
| **Gate** | Auth -> `payment_status` -> `onboarding_complete`; gate columns webhook-written, client read-only; RLS is the real gate | frontend.md §2, backend.md §3 (policy + trigger) |
| **Claude model** | `ANTHROPIC_MODEL=claude-sonnet-4-6`, server-side only (parse-crew-list, seed-fairness, schedule-chat) | backend.md §5, §6.4, §6.5, §6.7 |

If you change a seam, update **every** document in its row and (if the schema changed) regenerate `app/src/types/db.ts`.

---

## 1. What We Are Building (one paragraph)

WatchSchedule is a vertical SaaS that generates fair, automated watch-rotation schedules for superyachts. A captain signs up (Supabase Auth), pays (Stripe), and is gated by RLS into onboarding: build the crew list (OCR or manual), configure tier-specific watch settings, and generate. The product has exactly two authenticated pages — a **dashboard** (per-crew fairness scores + a week/month watch calendar + regenerate + a Claude chatbot) and a **settings** page (crew CRUD + watch settings + billing). The differentiator is a **persistent, per-lane fairness engine** that balances Mon–Fri and Sat–Sun as separate rotations, weights Fridays more heavily, forbids a Monday watch right after a weekend watch, and explains every decision.

---

## 2. Architecture & Boundaries (the invariants)

- **Supabase = single source of truth** (Auth, Postgres, Storage, Edge Functions).
- **GitHub Pages** hosts the static React SPA at `app.watchschedule.com` (static only — no server code there).
- **Stripe** = payment processor; the **webhook is the only writer** of `payment_status` / `product_tier`.
- **Claude** = stateless reasoning, called only from Edge Functions (OCR/classify + the schedule chatbot). The API key never reaches the client.
- **RLS is the real access gate.** Client routing is UX only. Every table is vessel-scoped.
- **The schedule + fairness tables are written only by server functions.** The client reads them.
- **Secrets live only in Edge Functions.** The client holds the anon key only.
- **Determinism:** identical inputs -> identical schedule. No randomness in the engine.

If a build step would violate one of these, it is wrong — stop and reconsider.

---

## 3. Tech Stack (fixed)

- Frontend: React 18 + TypeScript (strict), Vite, Tailwind (themed from branding.md tokens), React Router (with Pages 404 redirect fix), TanStack Query, React Hook Form + Zod, Lucide, date-fns, `@supabase/supabase-js` v2.
- Backend: Supabase Postgres + RLS, Supabase Storage (2 private buckets), Supabase Edge Functions (Deno/TypeScript).
- Integrations: Stripe (Checkout + Billing Portal + webhook), Anthropic API (Claude) from Edge Functions.
- Hosting/CI: GitHub + GitHub Pages (custom domain, CNAME). Supabase CLI for migrations + function deploys, driven from VS Code.

---

## 4. Repository Layout (target)

```
watchschedule/
  app/                         # the React SPA (frontend.md section 7 structure)
    src/...
    index.html                 # + SPA 404 redirect restore script
    404.html                   # GitHub Pages SPA redirect
    tailwind.config.js         # maps --ws-* tokens
    vite.config.ts
    .env                       # VITE_SUPABASE_URL / ANON_KEY / APP_URL (public)
  supabase/
    migrations/                # schema -> enums -> RLS -> triggers -> storage policies
    functions/
      create-checkout-session/
      stripe-webhook/
      create-billing-portal-session/
      parse-crew-list/
      seed-fairness/
      generate-schedule/
      schedule-chat/
      _shared/                 # fairness_constants.ts, fairness engine, schedule engine, supabase admin client, cors
  docs/                        # these six .md documents
  README.md
```

Put the fairness + schedule engines in `supabase/functions/_shared/` so both `generate-schedule` and `seed-fairness` import the same logic. Keep `fairness_constants.ts` there as the single tuning point.

---

## 5. Build Plan — Ordered Phases

Each phase is a prompt you can hand to Claude Code. Build in order. **Do not start a phase until the previous one's verification passes.** After each phase, commit.

### Phase 0 — Scaffold & Tokens
**Load:** branding.md, frontend.md (sections 1, 7, 9).
**Build:**
- Initialise the repo per section 4. Scaffold the Vite + React + TS app with Tailwind.
- Create `src/styles/tokens.css` with **all** `--ws-*` custom properties from branding.md, and wire `tailwind.config.js` to expose them (colors, fontFamily, spacing, borderRadius). Load Inter Tight/Manrope/Inter/JetBrains Mono.
- Add the GitHub Pages SPA routing fix (`404.html` + restore script in `index.html`).
- Set up the Supabase client (`src/lib/supabase.ts`) and React Query.
**Verify:** app builds and runs; a test page renders using only token-based Tailwind classes (no raw hex); fonts load; a deep-link route (e.g. `/settings`) survives a refresh in a Pages-like static serve.

### Phase 1 — Database Schema, RLS, Storage
**Load:** backend.md (sections 2, 3, 4, 9).
**Build:**
- Migrations in order: enums -> tables (all 11) -> `updated_at` trigger -> RLS policies (every table) -> the `profiles` gate-column guard (policy + trigger) -> storage buckets (`crew-lists`, `past-schedules`) + path-prefixed policies.
- Implement `current_vessel_id()` helper.
- Generate TypeScript types (`supabase gen types typescript`) into `app/src/types/db.ts`.
**Verify (security-critical):** with a normal (anon+JWT) client, confirm you can read/write only your own vessel's rows; confirm you **cannot** update `profiles.payment_status` / `product_tier`; confirm server-written tables (schedules, assignments, fairness_ledger, fairness_events) are **SELECT-only** for the client; confirm storage objects are isolated per vessel. Run the backend.md section 9 checklist.

### Phase 2 — Auth & The Gate
**Load:** frontend.md (sections 2, 3, 4.1, 5), backend.md (profiles).
**Build:**
- `/login` (Supabase email/password + optional OAuth).
- `<AuthGate>`: session -> profile resolution -> route to `/payment-required` | `/onboarding` (resume step) | `/dashboard`.
- On first sign-up, ensure a `vessels` row + `profiles` row exist for the user (via a DB trigger on `auth.users` insert, or a first-login bootstrap function — choose the trigger approach and document it).
**Verify:** new user lands on `/payment-required`; a manually-flipped paid user lands on `/onboarding`; a completed user lands on `/dashboard`; refresh preserves location; signing out returns to `/login`.

### Phase 3 — Stripe Payment Flow
**Load:** backend.md (sections 5, 6.1, 6.2, 6.3, 7), frontend.md (4.2, 4.3).
**Build:**
- Edge Functions: `create-checkout-session`, `stripe-webhook` (async signature verify, idempotent, service-role writes), `create-billing-portal-session`. Configure the six Stripe price secrets.
- Frontend: `/payment-required` (three tiers + annual toggle -> checkout), `/payment-processing` (Realtime watch on profile -> advance on flip; 60s timeout copy).
- Register the webhook; test with Stripe CLI.
**Verify:** end-to-end in Stripe test mode — pick a tier, pay, webhook flips `payment_status='active'` + correct `product_tier`, client auto-advances to `/onboarding`. Cancel returns to `/payment-required`. Subscription cancel sets `canceled`. Confirm the client never writes gate columns.

### Phase 4 — Onboarding Step 1 (Crew) + OCR
**Load:** frontend.md (4.4 Step 1, 5), backend.md (6.4 parse-crew-list, storage).
**Build:**
- `parse-crew-list` Edge Function (Claude vision -> `{full_name, position, department}` JSON; returns candidates, writes nothing).
- The shared position->department classifier helper (used by OCR + manual entry).
- Step 1 UI: image upload (to `crew-lists` bucket) -> parse -> editable review table; OR manual entry with auto-department; add/edit/remove; confirm -> persist `crew_members`.
**Verify:** uploading a sample crew list returns sensible parsed rows; manual entry auto-detects department; edits persist; crew rows are correctly vessel-scoped; advancing sets `onboarding_step='settings'`.

### Phase 5 — Onboarding Step 2 (Shared Watch Settings)
**Load:** frontend.md (4.4 Step 2 + the settings-parity note, 4.6), backend.md (watch_settings, watch_lanes), schedule.md (section 3).
**Build:**
- The **shared `WatchSettingsForm`** (used by both onboarding Step 2 and `/settings`): tier-aware controls — Solo (no department pick), Dual (pick 2 departments), Triple (pick 3) from {deck, interior, engineering, officer}; universal settings (horizon <=13 weeks, start date, include_weekends, anchors). Zod validation incl. the dept-count-matches-tier rule.
- Persist `watch_settings`; derive/persist `watch_lanes`.
**Verify:** the same component renders correctly in onboarding and settings; tier gating works; invalid department counts are rejected client+DB; lanes are created (1/2/3 by tier); advancing sets `onboarding_step='generate'`.

### Phase 6 — The Fairness Engine (shared lib)
**Load:** fairness.md (all), backend.md (fairness_ledger, fairness_events).
**Build:**
- In `supabase/functions/_shared/`: `fairness_constants.ts` (all weights/scaling) + the fairness engine: `selectCandidate(lane, date, dayType, isFriday, ledger, alreadyAssigned)` and `updateLedger(...)` and `computeFairnessScore(...)`, exactly per fairness.md (hard constraints incl. Monday-after-weekend, selection cost with Friday selection penalty, deterministic tie-breaks, ledger updates, 0–100 score).
- Unit tests: the worked example (fairness.md section 9) must reproduce; determinism test (same inputs -> same picks); Monday-exclusion test; Friday-spread test; tie-break ordering test.
**Verify:** all unit tests pass; no randomness; constants are the only tuning surface.

### Phase 7 — The Generation Engine + `generate-schedule`
**Load:** schedule.md (all), fairness.md (section 11 contract), backend.md (6.6, schedules, watch_assignments).
**Build:**
- In `_shared/`: the schedule engine (chronological ascending loop, per-lane, two-rotation, eligible-pool construction, writes container + assignments, calls fairness engine, increments ledger, appends events, completes onboarding on first run).
- The `generate-schedule` Edge Function wrapping it (JWT -> vessel; service-role writes; `regenerate` handling: flip prior current, default `from_date` to today).
- Step 3 UI: the "Generate watch schedule" button (Solo) and the **past-schedule uploader for Dual/Triple** (deferred to Phase 8's seed function — wire the button now, enable the uploader once Phase 8 lands).
**Verify:** generating on a test vessel writes a current schedule with correct dates/day-types/Friday flags; ledger increments; events recorded; regenerate replaces current and stays fairness-aware; determinism test at the function level (generate twice -> identical assignments).

### Phase 8 — Fairness Seeding (`seed-fairness`, Dual/Triple)
**Load:** backend.md (6.5), fairness.md (section 6).
**Build:**
- `seed-fairness` / `parse-past-schedule` Edge Function: Claude vision extracts historical (date, crew, lane) records; fuzzy-match to crew (surface unmatched); aggregate into ledger as a **set** (idempotent); compute initial scores; reject Solo callers.
- Enable the Step 3 past-schedule uploader (Dual/Triple) -> calls seed-fairness before/independently of generation.
**Verify:** uploading past schedules seeds the ledger sensibly; re-upload replaces (no double-count); Solo is rejected; the first generated schedule visibly reflects prior burden (less-rested crew favoured less).

### Phase 9 — Dashboard
**Load:** frontend.md (4.5), branding.md (fairness chip, calendar cell, status dots), fairness.md (score interpretation).
**Build:**
- FairnessPanel: per-crew fairness chips with gauge colours; grouped by lane/department (Solo ungrouped); expandable breakdown.
- WatchCalendar: week/month segmented toggle; tier lanes; Friday + weekend cell styling; hover names; today/active-week emphasis.
- RegenerateButton (confirm dialog; generating state).
- Reads everything via RLS-scoped selects from the current schedule + ledger.
**Verify:** scores render with correct colours/grouping; calendar matches assignments; week/month toggle works; regenerate updates the view; matches branding.md.

### Phase 10 — The Claude Chatbot (`schedule-chat`)
**Load:** backend.md (6.7), frontend.md (4.5 chatbot), branding.md (chatbot panel).
**Build:**
- `schedule-chat` Edge Function: JWT -> vessel; load current schedule + assignments + ledger + relevant fairness_events; Claude call with a strict, data-grounded system prompt; return reply; optional `chat_messages` persistence. Key stays server-side; answers only within this vessel's data.
- ScheduleChat UI per branding.md (mono for cited data).
**Verify:** "Why is Alex on watch on Friday?" yields an explanation traceable to a fairness_event; "Who has the most weekends?" is correct against the ledger; out-of-scope questions are declined; no cross-vessel leakage.

### Phase 11 — Settings Page
**Load:** frontend.md (4.6), backend.md (crew_members, billing portal).
**Build:**
- CrewManager: crew CRUD; the "not eligible for watch" toggle + reason; "changes apply on regenerate" messaging.
- The **same `WatchSettingsForm`** from Phase 5; optional "Save & regenerate".
- Subscription: current tier + "Manage billing" (`create-billing-portal-session`) + sign out.
**Verify:** CRUD persists and is vessel-scoped; eligibility toggle removes a member from the next generation's pool; settings edits persist; billing portal opens; the settings form is literally the same component as onboarding Step 2.

### Phase 12 — Polish, A11y, Deploy
**Load:** branding.md (a11y, motion), frontend.md (9, 10, 11).
**Build:**
- Empty/edge/error states across all screens; reduced-motion; keyboard nav; iPad-portrait responsive.
- Production env wiring; deploy the SPA to GitHub Pages (CNAME `app.watchschedule.com`); set Supabase Auth redirect URLs + Stripe success/cancel URLs to the production origin; deploy all Edge Functions; register the production Stripe webhook.
**Verify:** full production smoke test of the entire gate -> pay -> onboard -> generate -> dashboard -> chatbot -> settings loop; the backend.md security checklist passes in production; a deep link survives refresh on the live domain.

---

## 6. Cross-Cutting Definition of Done (every phase)
- No raw hex/fonts in components — only branding.md tokens.
- No secret keys in the client bundle — anon key only.
- Every new table access respects RLS and is vessel-scoped.
- Server-only writes stay server-only (schedule/fairness/gate columns).
- The engine remains deterministic (tests prove it).
- Each Edge Function re-derives `vessel_id` from the JWT and never trusts client-supplied ids.
- Committed, with the verification for that phase demonstrably passing.

---

## 7. How to Use This With Claude Code (operating notes)
- Open this `master.md` first. For each phase, load **only** the documents that phase names (keeps context focused).
- Build one phase at a time; run its verification; commit; then proceed.
- When something is unspecified or two documents seem to conflict, **stop and surface it** rather than inventing a contract — then we update the relevant document so the source of truth stays correct.
- The companion docs are living specs: if we change a rule (e.g. a fairness weight, a new setting), update the owning document, regenerate types if the schema changed, and note it here.

> You (Claude Code) are the execution; these six documents are the brain. Build in order, verify at every step, keep the invariants in section 2 sacred, and the result is a deterministic, explainable, trustworthy watch-scheduling instrument worthy of the bridge it runs on.
