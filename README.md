# WatchSchedule

Vertical SaaS that generates **fair, automated watch-rotation schedules for superyachts**. A captain signs up (Supabase Auth), pays (Stripe), and is gated by RLS into onboarding — build the crew list (OCR or manual), configure tier-specific watch settings, and generate. The product has two authenticated pages: a **dashboard** (per-crew fairness scores + a week/month watch calendar + regenerate + a Claude chatbot) and a **settings** page (crew CRUD + watch settings + billing). The differentiator is a **persistent, per-lane fairness engine** that balances Mon–Fri and Sat–Sun as separate rotations, weights Fridays more heavily, forbids a Monday watch right after a weekend watch, and explains every decision.

## Layout
- `app/` — React 18 + TypeScript (strict) + Vite + Tailwind SPA (GitHub Pages).
- `supabase/` — Postgres migrations + Edge Functions (Deno) — the single source of truth.
- `docs/` — the six-document specification (source of truth).

## Build guide
**Read [`docs/master.md`](docs/master.md) first.** It is the build orchestrator: the ordered, phase-by-phase plan, the architectural invariants, and the cross-document seam index that govern everything. The operating contract for every working session is in [`CLAUDE.md`](CLAUDE.md).

## App quickstart
```bash
cd app
npm install
cp .env.example .env   # fill in public Supabase values (anon key only)
npm run dev            # or: npm run build
```
