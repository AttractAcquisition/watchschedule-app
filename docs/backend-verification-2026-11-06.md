# Backend verification — 6 November 2026

Verified production project: `gvpyknochnntoqsetomk` (Watch Schedule, healthy). The frontend was confirmed correct by the owner and received no runtime/UI changes during this audit.

## Deployment reconciliation

All 32 migrations already in `main` were applied before this audit. Earlier commit messages saying deployment was pending were stale.

Downloaded deployed function sources and compared their entrypoints and bundled shared modules with the repository. All entrypoints matched. Three functions still bundled older `rota_data.ts` and `rota_v2.ts`; redeployed them from the current source and downloaded them again to confirm byte-for-byte agreement:

| Function | Verified live version |
|---|---:|
| `seed-fairness` | 11 |
| `suggest-generation-horizon` | 6 |
| `override-assignment` | 2 |

The other seven functions were already current. All ten functions are active; JWT verification remains enabled except on the Stripe webhook, which checks its Stripe signature.

## Database correction

Found two gaps in `watch_pins`: foreign keys did not enforce crew/lane vessel ownership, and pin changes did not increment `rota_revision`. Existing pins had no ownership mismatches.

Applied `20261106010000_watch_pin_integrity.sql` after successfully testing the migration and its assertions inside a rolled-back production transaction. It adds composite foreign keys and the existing revision-bump trigger to pin inserts, updates (including consent), and deletes. A generation calculated before a pin edit now fails its revision check. Existing schedules, pins, crew, and fairness scores were not rewritten.

Updated TypeScript relationship metadata to match the foreign keys; no frontend behavior changes. Fixed the original pin SQL test to explicitly use the `authenticated` role when testing RLS, and added `supabase/tests/watch_pin_integrity.sql`.

Final migration dry run reported the remote database up to date, with no pending migrations (33 total).

## Verification completed

- All 52 Deno engine, recommendation, manual-override, and fixed-watch tests passed, including type checking.
- Live SQL tests for rota V2 and manual overrides passed inside transactions that were rolled back.
- Original fixed-watch schema tests and new ownership/concurrency tests passed against the updated live schema and were rolled back. These cover duplicate refusal, client consent writes, tenant isolation, cascade behavior, insert/update/delete revision changes, and stale-publish refusal.
- All public application tables have RLS enabled. Schedule/fairness tables have SELECT-only client policies. Publishing, manual override, and seed replacement RPCs reject client execution.
- Integrity queries found no duplicate current schedules per vessel, no duplicate crew/day assignments within schedules, and no assignments referencing a crew member or lane from another vessel.
- App TypeScript check and `git diff --check` passed.

## Live HTTP integration checks

Used disposable, email-confirmed test users and vessels. Only those test profiles received synthetic active subscriptions through an administrative SQL update; no customer subscription was changed and no Stripe event was fabricated. All test users, vessels, related application data, and uploaded images were removed afterward.

Passed:

- Authentication, sign-in, automatic profile/vessel bootstrap.
- Crew creation and atomic watch-configuration saves through ordinary client permissions.
- Fixed-watch preview, production CORS, schedule generation, the pin being honoured, and stored fairness watch totals matching generated assignments.
- Manual-override candidate lookup, applying a change, and its persisted manual flag.
- Horizon recommendation across all 13 candidate windows.
- Explicit date-range configuration and regeneration with the requested boundaries.
- Browser OPTIONS preflight and invalid JWT rejection.
- Private crew-list image upload, live Anthropic OCR, and correct department classification.
- Private past-schedule image upload, live OCR, crew matching, and fairness seeding.
- Live schedule chat answering from the generated rota and persisting both conversation turns.
- Billing endpoint validation: invalid checkout tier, missing billing customer, unauthorized subscription upgrade, and unsigned webhook are rejected.

## Verification limits

No actual Stripe checkout/payment, customer portal session, subscription upgrade, or signed payment webhook was exercised. Their deployed sources match the repository, required secret names are present, and rejection paths were checked; successful financial transactions are not established by this audit. Tests establish the exercised backend paths rather than every possible crew/configuration combination.
