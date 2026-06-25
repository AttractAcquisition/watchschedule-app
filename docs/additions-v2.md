# additions-v2.md — WatchSchedule Second-Wave Feature Build

> **Purpose.** Build context for the second wave of features on the shipped, live WatchSchedule product (`app.watchschedule.com`). This document merges (a) the gaps found cross-referencing the live marketing site against the built product and (b) the operator's required feature additions, deduplicated into one build-ordered plan. It follows the same discipline as the original spec suite (`master.md`, `backend.md`, `frontend.md`, `fairness.md`, `schedule.md`, `branding.md`, `additions.md`): **one phase per session, an explicit verification gate before proceeding, surface conflicts rather than invent solutions, and update the relevant spec doc when implementation diverges.**
>
> **This document extends the original specs; it does not supersede them.** Where it touches an existing surface, the original doc remains the source of truth for everything not explicitly changed here. Where this document *deliberately reverses* a prior decision (noted inline), the reversal is intentional and the prior spec must be updated to match.

---

## 0. Hard Constraints (read before any work)

Non-negotiable. Any phase that would violate one of these must STOP and surface the conflict.

1. **FAIRNESS SCORING IS FROZEN.** The fairness *scoring* — the ledger fields, the weights (`W_WEEKDAY`, `W_FRIDAY`, `W_WEEKEND`, `W_CONSEC`, `W_FRIDAY_SELECT`, `RECENCY_NUDGE`, `K`, `EPSILON`), the selection-cost formula, tie-break order, the 0–100 score formula, and the ledger-write rules in `fairness.md` — must not change. No phase here alters a single fairness number, weight, formula, or tie-break. **Important distinction this wave depends on:** several phases change *scheduling structure* (how/when watches are assigned — weekend grouping, charter pausing, lane counts). Changing scheduling structure is permitted; changing fairness *scoring* is not. The boundary is sometimes subtle (e.g. weekend grouping changes what a "weekend watch" is, which the scoring counts). **Therefore every engine-touching phase (B5, B6, B7) is AUDIT-GATED:** its first action is a read-only audit establishing exactly where the scoring boundary lies and confirming the change can be made without altering the frozen scoring path. If the only way to deliver a phase is to change scoring, the phase is wrong — STOP and surface it.

2. **Project identity gate.** Before any Supabase write, re-verify the active connection resolves to project `gvpyknochnntoqsetomk` (org "Watch Schedule", `vpfjpwtoddgwaurjbmuy`) and **NOT** any Attract Acquisition project. If it does not, STOP. Confirm the active `project_ref` in output before the first migration.

3. **Canonical repo & tree.** All work happens in the live local tree `~/Desktop/watch-schedule`, whose remote is the live repo `watchschedule-app` (under AttractAcquisition). The archived `watch-schedule-new` repo (which formerly held the domain and served the dead `diepraznybnjlwryibod` ref) is **frozen** — never deploy from or edit it. If a path/remote discrepancy appears, STOP and resolve which tree is live before editing.

4. **Deploy gap.** Edge-function changes committed to GitHub do **NOT** reach the backend. After any function change, deploy explicitly via the Supabase MCP/CLI and confirm the new version. Keep `verify_jwt` settings as-is on existing functions (frontend-invoked = TRUE).

5. **RLS model is inherited, not redesigned.** Server-written tables (`schedules`, `watch_assignments`, `fairness_ledger`, `fairness_events`) remain **client-SELECT-only**; only the service role writes them. Vessel-scoped tables remain scoped to `current_vessel_id()`. The gate-column guard on `profiles` (blocking client writes to `payment_status`, `product_tier`, `stripe_*`) stays intact. Any new table or policy follows this same pattern.

6. **Determinism preserved.** No randomness introduced anywhere. Identical inputs → identical schedules.

7. **Pricing source of truth = the marketing site.** The live marketing site prices (Solo €39, Dual €99, Triple €199 monthly; €390/€990/€1990 annual) are now authoritative. The app and Stripe are realigned to them in **Phase B1**. (This *reverses* the Phase-3 correction to €79/€149 — intentional.)

---

## 1. Scope — Deduplicated Feature Map

Merged from the website cross-reference and the operator's required additions, with duplicates collapsed (e.g. "PDF export" appeared in both). Ordered low-risk → high-risk.

| Phase | Feature | Source | Touches engine? | Touches pay-gate? | Reverses prior decision? |
|---|---|---|---|---|---|
| **B0** | Marketing-site copy reconciliation (non-code) | Website | No | No | — |
| **B1** | Pricing realignment to site (€99/€199) in app + Stripe | Website + operator | No | **Yes** (prices, not gate logic) | **Yes** (reverts Phase-3 €79/€149) |
| **B2** | Quick-win UI/config batch (6 items) | Operator | No | No | No |
| **B3** | Export cluster (schedule PDF/print; fairness export trio) | Website + operator | No | No | No |
| **B4** | Billing depth (full portal + tier upgrade) | Operator | No | **Yes** | Partly (Phase-3 deferred tier change) |
| **B5** | Tier flexibility ("up to N" departments, floor = 1) | Operator | **Yes** (lane derivation) | No | **Yes** (relaxes Phase-1 `dept_count_matches_tier`) |
| **B6** | Weekend watch structure (per-day / Sat+Sun / Fri+Sat+Sun) | Operator | **Yes (audit-gated)** | No | No (extends) |
| **B7** | Charter Mode (pause / freeze / resume-from-correct-crew) | Website | **Yes (audit-gated)** | No | No (new) |
| **— ** | **A3 Personal Crew View — DEFERRED** (see §3) | additions.md | — | — | — |

**Explicitly OUT of scope (not built here):** per-crew logins / multi-user seats (A3 deferred), the A4 leave/fairness simulator (cut), fleet benchmarking, predictive forecasting, fairness alerts, analytics dashboards, manual per-day schedule editing/locking, an approval/publication lifecycle (the product has no such lifecycle — see B0). If a phase drifts toward any of these, STOP.

---

## 2. Sequencing & Gate Discipline

Build in order **B0 → B1 → B2 → B3 → B4 → B5 → B6 → B7.** One phase per session. Do not start a phase until the prior phase's gate passes.

Rationale for the order:
- **B0** is non-code copy reconciliation — do first to stop the live site over/mis-promising (the pricing inconsistency is a live billing-trust risk).
- **B1** realigns app+Stripe pricing to the site — billing correctness, do early, before any customer acquisition.
- **B2/B3** are pure frontend/output with no engine and no gate — high value, low risk.
- **B4** touches the payment gate — careful, after the low-risk work.
- **B5/B6/B7** touch scheduling structure and are **audit-gated** — done last, each beginning with a read-only audit confirming the fairness scoring boundary before any code. B7 (Charter Mode) is the largest and last.

---

## PHASE B0 — Marketing-Site Copy Reconciliation (NON-CODE)

### Objective
Bring the live marketing site's claims into line with the built product. This is content editing on the marketing site — **not** an app/repo code change (unless the marketing site lives in this repo; confirm first). No build, no deploy of the app.

### Changes
1. **Department naming:** site says "Deck, Interior, Engineering, and **Command**." The product enum is `officer`. Change site copy "Command" → "Officer" (or "Officer / Command" if preferred), to match the product.
2. **Approval/publish language:** the site implies a review→approve→publish lifecycle ("Captain approval required," "Reviewed. Approved. Posted.," "reviews every draft before publication"). The product has **no approval/publication/locking lifecycle** (confirmed by the additions.md A2.0 audit — schedules are *generated and confirmed*, not approved). Soften this copy to a "generate and confirm" framing. Do **not** build an approval system to match the copy — change the copy.
3. **"Coverage analytics" (Triple):** no analytics surface exists beyond fairness scores. Either soften to "coverage insight via the Fairness Engine" or leave pending until B3's fairness export lands — operator's choice; default to softening.
4. **Strengthen (optional, accurate):** the "Ask the Schedule" assistant explains *why* any assignment was made (from recorded reasons) — stronger than the current "clear reasoning" copy. Consider strengthening this claim, as it is real and differentiating.
5. **Pricing:** the site already shows €39/€99/€199 — these are now the source of truth and are correct on the site. **No site pricing change.** (The *app/Stripe* change to match is Phase B1.)

### Gate
- [ ] Site no longer promises an approval/publication lifecycle the product lacks (or the language is softened to generate-and-confirm).
- [ ] "Command" reconciled to "Officer."
- [ ] "Coverage analytics" softened or scoped.
- [ ] Site pricing confirmed €39/€99/€199 (unchanged — it is the source of truth).
- [ ] No app code changed in this phase (unless the marketing site is in this repo — if so, scope the edit to marketing pages only and note it).

### Spec to update on completion
None (marketing copy). If the marketing site lives in this repo, note where.

---

## PHASE B1 — Pricing Realignment (App + Stripe → Site Prices)

### Objective
Make the app and Stripe charge the site's authoritative prices: Solo €39 (**unchanged**), **Dual €99**, **Triple €199** monthly; €390 / **€990** / **€1990** annual. This realigns away from the Phase-3 €79/€149 figures (intentional reversal).

### Critical Stripe mechanics (do this correctly)
**Stripe Price objects are immutable — you cannot edit an amount.** Do not attempt to change €79 → €99 on an existing price; it will fail. The correct pattern:
1. **Create new Price objects** for the changed tiers at the new amounts: Dual €99/mo + €990/yr, Triple €199/mo + €1990/yr. (Solo €39/€390 is **unchanged** — keep its existing prices; do NOT recreate Solo.)
2. **Repoint the app/secrets** to the new price IDs (update `STRIPE_PRICE_DUAL_MONTH/_YEAR` and `STRIPE_PRICE_TRIPLE_MONTH/_YEAR` to the new IDs; leave the Solo secrets untouched).
3. **Archive the old €79/€149 price objects** in Stripe (set active=false) so no new checkout uses them. Do not delete — archiving preserves history.
4. **Existing subscriptions are unaffected:** Stripe keeps any current subscription on its original price; only *new* checkouts use the new prices. (In test mode with no real customers this is moot, but the mechanism stands.)

All in **Stripe TEST mode** unless the operator explicitly authorizes live mode (they have not).

### Build
1. Create the four new test-mode prices (Dual + Triple, monthly + annual) at the confirmed amounts via the Stripe API (through the temporary server-side tooling pattern used in Phase 3, so the Stripe key stays in the Edge environment — never echoed).
2. Update the four Dual/Triple price secrets to the new IDs; redeploy any function that reads them in the set-then-deploy order. (`create-checkout-session` reads price secrets.)
3. Archive the old Dual/Triple price objects.
4. Update the app's `/payment-required` screen copy to €99 / €199 (and €990 / €1990 annual). Update any in-repo/doc references that still say €79/€149 (frontend.md §4.2, master.md, CLAUDE.md, the Phase-3 wording) to the new figures — the app must everywhere display the site prices.

### Gate
- [ ] Four new test-mode prices exist at exactly: Dual €99/mo (9900), €990/yr (99000); Triple €199/mo (19900), €1990/yr (199000). Show the new price IDs + amounts.
- [ ] Solo prices are **unchanged** (€39/€390 — not recreated).
- [ ] App secrets repointed to the new Dual/Triple IDs; `create-checkout-session` redeployed and confirmed.
- [ ] A fresh test checkout for Dual shows €99/mo at Stripe Checkout (and Triple €199) — the new amount, end-to-end.
- [ ] Old €79/€149 prices archived (active=false), not deleted.
- [ ] `/payment-required` and all in-repo/doc price references now read €39/€99/€199 (no remaining €79/€149).
- [ ] Payment gate logic unchanged (webhook still the only writer of `payment_status`/`product_tier`; Phase-1 guard intact).
- [ ] Cleanup: remove any test customers/subscriptions created; baseline restored.

### Spec to update on completion
`frontend.md` §4.2 (prices), `backend.md` §5 (note the price secrets now point at the €99/€199 IDs), `master.md`/`CLAUDE.md` (price figures). Record that this intentionally reverses the Phase-3 €79/€149 correction.

---

## PHASE B2 — Quick-Win UI / Config Batch (no engine, no gate)

### Objective
Six small, independent frontend/config improvements with no engine or payment-gate impact. Batchable in one phase.

### Build
1. **Vessel name in watch configuration.** Surface an editable vessel name field in BOTH onboarding setup and `/settings` (schema already has `vessels.name` — this is a form field + persist, no migration). The name should flow through to where the vessel is displayed (top bar, exports).
2. **"Advanced rotation anchors" help tooltip.** Next to the "Show advanced rotation anchors" control, add a `?` icon with a hover popup (accessible tooltip) explaining, in plain English: *"Sets which crew member the rotation starts from on a brand-new schedule, before any watch history exists. Once schedules have been generated, fairness takes over automatically and this no longer applies. Most vessels can leave this at default."* Keyboard-focusable + `prefers-reduced-motion` respected per branding.
3. **Calendar names → "Firstname.X".** Change the dashboard calendar cell display from initials (`AT`) to first name + first letter of surname (`Alexander.T`). Parse from `crew_members.full_name`. Check cell width handles longer names (truncate/ellipsis gracefully if needed). Apply consistently to the calendar; keep the hover tooltip showing full name + position.
4. **Render the chatbot's markdown.** "Ask the Schedule" returns valid markdown that is currently displayed raw. Add markdown rendering to the `ScheduleChat` assistant-message display so headings/lists/emphasis render. Note: this likely adds the first new dependency since the build froze `package.json` (a markdown renderer) — that is acceptable here; pick a lightweight, well-maintained renderer and sanitize output (no raw HTML injection). Cited schedule data (dates/initials/scores) should still read clearly (mono where appropriate per branding).
5. **Settings crew-list image upload.** In `/settings` crew management, add a small button → popup/modal with the option to upload or take a photo of the crew list, reusing the proven Phase-4 `parse-crew-list` flow (OCR → editable review → confirm → upsert crew). This is a second mount of an existing capability, not new backend.
6. **Dual/Triple department mix-and-match (all combinations).** Ensure the department picker allows EVERY valid combination of `{deck, interior, engineering, officer}` (e.g. all four, deck+interior, engineering+interior, engineering+deck, etc.) up to the tier's nominal count. This is a UI/validation relaxation + confirming `deriveLanes`/`reconcileLanes` handle any combination. (NB: the *count* relaxation — running a Dual with one dept, etc. — is Phase B5, which is engine-touching and audit-gated. B2 only ensures all *combinations at the nominal count* are selectable; B5 relaxes the count.)

### Gate
- [ ] Vessel name editable in onboarding + settings; persists; displays where the vessel is shown.
- [ ] Anchors `?` tooltip present, accessible (keyboard + hover), copy explains it plainly.
- [ ] Calendar shows `Firstname.X`; long names handled; hover still shows full name + position.
- [ ] Chatbot markdown renders correctly (headings/lists/emphasis); output sanitized; cited data readable.
- [ ] Settings crew-upload popup works end-to-end via existing `parse-crew-list` (OCR → review → confirm → persist), vessel-scoped.
- [ ] All department combinations at the nominal tier count are selectable and produce correct lanes.
- [ ] No engine change, no payment-gate change, no scoring change. New dependency (markdown renderer) is the only addition; confirm it's lightweight + sanitized.
- [ ] Branding tokens only; build passes; RLS scoping intact.

### Spec to update on completion
`frontend.md` (vessel-name field, anchors tooltip, calendar name format, chatbot markdown rendering, settings crew-upload, department-combination selection).

---

## PHASE B3 — Export Cluster (no engine)

### Objective
Complete the export matrix the site promises and the operator requires. A1 already shipped **WhatsApp export for the schedule**. This phase adds PDF + print for the schedule, and the WhatsApp/PDF/print trio for the per-crew fairness balance.

Export matrix after this phase:
| Surface | WhatsApp | PDF | Print |
|---|---|---|---|
| Schedule (calendar) | ✅ A1 | **B3** | **B3** |
| Fairness (per-crew balance) | **B3** | **B3** | **B3** |

### Scope fence
- **IN:** PDF generation + browser print for the schedule; WhatsApp text + PDF + print for the fairness panel. All read-only over already-displayed data.
- **OUT:** Any server-side document service, any emailing/sending integration, any new secret. PDFs are generated client-side or via existing capability; "send to WhatsApp" remains the copy-to-clipboard pattern from A1 (text), not a WhatsApp API.

### Build
1. **Schedule PDF + print.** A "Download PDF" and a "Print" action on the schedule/calendar surface. The PDF should be captain-ready (clean, legible, the schedule grid with vessel name + date range + tier; Friday/weekend distinction preserved or legend'd). Print uses a print-stylesheet so the calendar prints cleanly. Reuse the current schedule's already-read assignments — recompute nothing.
2. **Fairness export trio.** For the per-crew fairness balance panel: (a) WhatsApp/clipboard text (reuse the A1 pattern — a plain-text fairness summary: crew + score + key counts), (b) Download PDF, (c) Print. Read-only over the already-displayed `fairness_ledger` data.
3. Branding tokens; the PDF/print layouts should look professional and on-brand (navy/gold, the instrument feel) but legible in print (mind dark backgrounds — provide a print-appropriate treatment).

### Gate
- [ ] Schedule: Download-PDF produces a correct, captain-ready PDF of the current schedule (every assignment, correct dates, tier lanes); Print produces a clean printed calendar.
- [ ] Fairness: WhatsApp/clipboard text, PDF, and Print all produce correct per-crew fairness output from the displayed ledger data.
- [ ] All exports are read-only over existing data — no recompute, no fairness change, engine untouched.
- [ ] Print/PDF treatments are legible (dark-theme handled for print) and on-brand.
- [ ] No server doc service, no new secret; any new client dependency is lightweight + justified.
- [ ] Build passes; tokens only.

### Spec to update on completion
`frontend.md` (the full export matrix on schedule + fairness surfaces).

---

## PHASE B4 — Billing Depth (full portal + tier upgrade) — PAYMENT-GATE ADJACENT

### Objective
Make "Manage billing" a full self-service surface (edit payment method, view past invoices, cancel subscription) and add a **tier upgrade** path that moves a vessel to a higher tier and unlocks its functionality.

### Scope fence
- **IN:** Confirm/enable the Stripe Customer Portal's full feature set (payment-method update, invoice history, cancellation); build a guided upgrade flow (Solo→Dual→Triple) that changes the Stripe subscription and, via the webhook, updates `product_tier` and the vessel's available capabilities.
- **OUT:** Downgrade flows with proration edge-cases beyond what the portal handles natively (defer unless trivial); any change to who can write `product_tier` (still webhook-only).

### Critical correctness (payment gate)
- `product_tier` remains **webhook-written only** (Phase-1 guard intact). The upgrade flow must NOT write `product_tier` from the client. The pattern: client initiates an upgrade → Stripe subscription is modified (new tier's price) → Stripe fires a subscription event → `stripe-webhook` updates `product_tier` (and the app re-derives lanes/settings for the new tier). Re-derive `vessel_id` from JWT; never trust client tier claims.
- When tier increases, the vessel's settings/lanes may need reconciliation (e.g. Solo→Dual now needs a department selection). Surface the onboarding-of-the-new-capability cleanly (prompt for the now-required settings) rather than leaving the vessel in an inconsistent state. Reuse the shared `WatchSettingsForm`.

### Build
1. **Full portal:** ensure `create-billing-portal-session` returns a portal configured (in Stripe dashboard / via API default config) to allow payment-method update, invoice history, and cancellation. Verify each works from the live portal.
2. **Upgrade flow:** a clear "Upgrade plan" entry in the billing/account section → tier comparison → confirm → Stripe subscription update → webhook flips `product_tier` → app reflects the new tier and prompts for any newly-required settings (e.g. department selection for the new lanes). Show pricing per B1 (€39/€99/€199).
3. Handle the in-flight state (upgrade pending → confirmed) using the same Realtime-on-profile pattern as the original payment flow.

### Gate
- [ ] Manage-billing portal allows: edit payment method, view past invoices, cancel subscription — each proven against the live (test-mode) portal.
- [ ] Upgrade flow: a tier increase modifies the Stripe subscription, the webhook updates `product_tier` (NOT the client), and the app unlocks the new tier's functionality.
- [ ] After upgrade, the vessel is prompted for any newly-required settings (e.g. Solo→Dual department selection) and ends in a consistent state (correct lanes for the new tier).
- [ ] `product_tier` is never client-written; Phase-1 gate guard re-confirmed; `vessel_id` re-derived from JWT.
- [ ] Pricing shown is the B1 figures.
- [ ] Cleanup of test customers/subscriptions; baseline restored.

### Spec to update on completion
`backend.md` (the upgrade flow + which webhook events drive `product_tier` changes), `frontend.md` (billing/upgrade surface).

---

## PHASE B5 — Tier Flexibility ("up to N" departments, floor = 1) — ENGINE-TOUCHING, AUDIT-GATED

### Objective
Allow a vessel to run **fewer** department lanes than its tier's nominal count: a Dual vessel may select 1 or 2 departments; a Triple may select 1, 2, or 3. **Floor: at least one department** (a multi-lane tier must run at least one watch lane). This **reverses** the Phase-1 `dept_count_matches_tier` CHECK (which enforced exactly 2 for Dual, exactly 3 for Triple) — intentional.

### Audit first (read-only; no code)
Before building:
1. Establish exactly where the count is enforced: the `dept_count_matches_tier` CHECK constraint (Phase-1 migration), the Zod validation in `WatchSettingsForm` (Phase-5), and any assumptions in `deriveLanes`/`reconcileLanes`/the schedule engine that the lane count equals the tier number.
2. Confirm that relaxing the count to "1..N, floor 1" requires changing ONLY: the CHECK constraint, the Zod rule, and any place that *assumes* exactly-N — and does **NOT** require any change to fairness scoring (each lane still has its own ledger; fewer lanes just means fewer ledgers — the per-lane scoring math is unchanged). Confirm the engine already handles "a tier with fewer lanes" gracefully (it loops active lanes; 1 active lane is already valid per `schedule.md`).
3. Report the audit + confirm the scoring boundary is not crossed, then proceed.

### Build (after audit confirms)
1. **Migration:** replace `dept_count_matches_tier` with a relaxed constraint: Solo → exactly 0 selected departments (pool = all eligible crew, unchanged); Dual → 1 or 2; Triple → 1, 2, or 3. Floor enforced: Dual/Triple must have ≥1. (Solo's "0 departments" semantics are unchanged.)
2. **Zod:** update `makeWatchSettingsSchema`/`deptCountForTier` to the new ranges (Dual 1–2, Triple 1–3, floor 1).
3. **UI:** the department picker for Dual/Triple now permits selecting fewer than the nominal count (down to 1), any combination.
4. **Lanes:** confirm `deriveLanes`/`reconcileLanes` produce the correct number of lanes for the selected count (and the lane-retirement/reactivation logic still holds when count changes).
5. Update `backend.md` (the constraint) and `schedule.md` §3 (lane derivation now "1..N by tier, floor 1") to match.

### Gate
- [ ] Audit produced; confirmed the change touches only the CHECK + Zod + count-assumptions, NOT fairness scoring.
- [ ] Migration applied: Dual accepts 1 or 2 departments; Triple accepts 1, 2, or 3; floor of 1 enforced (0 rejected for Dual/Triple); Solo unchanged (0).
- [ ] Client Zod matches the DB constraint (both reject below-floor; both accept the new valid ranges).
- [ ] A Dual vessel with ONE department generates a correct single-lane schedule; a Triple with two generates correct two-lane; lanes derived correctly.
- [ ] Fairness scoring unchanged — engine unit tests still reproduce the worked-example numbers; per-lane ledgers behave as before (verify the frozen-engine constraint).
- [ ] Lane retirement/reactivation still correct when the selected count changes.
- [ ] Build passes; RLS intact.

### Spec to update on completion
`backend.md` (`watch_settings` constraint), `schedule.md` §3, `frontend.md` §4.4/§8 (tier-gating now "up to N, floor 1"). Record the intentional reversal of the Phase-1 exact-N rule.

---

## PHASE B6 — Weekend Watch Structure — ENGINE-TOUCHING, AUDIT-GATED

### Objective
Make the weekend watch *structure* configurable per vessel: (a) **one person per day** (current behaviour — Sat and Sun each assigned separately), (b) **one person for the whole weekend** (a single assignee covers Sat+Sun), or (c) **one person for Fri+Sat+Sun** (a single assignee covers Friday through Sunday). The generated schedule must honour the chosen structure, and fairness counting must remain correct **without changing the frozen scoring formula**.

### Why this is the most delicate phase for the freeze
"What counts as a weekend watch" is an input the *scoring* consumes (the ledger tracks `weekend_watches`, `friday_watches`; the selection cost weights them). Changing the structure changes *how watches are grouped and counted*, which is adjacent to — but must not alter — the scoring math. **The audit must draw this line precisely.**

### Audit first (read-only; no code)
1. Establish how weekends and Fridays are currently generated and counted: the day-by-day loop, `day_type`/`is_friday`, the per-day weekend assignment, and how `updateLedger` increments `weekend_watches`/`friday_watches`.
2. Determine how options (b) and (c) can be expressed as a **scheduling-structure** change — i.e. assigning one crew member to a *block* of days — while the *scoring* still receives correct counts (e.g. a single weekend-block assignee accrues the appropriate weekend burden) **using the existing weights and formula unchanged**. Specifically confirm:
   - Whether a block assignment should count as one weighted weekend unit or per-covered-day, and that whichever choice is made is expressed as *input to* the unchanged scoring, not a change of the scoring weights/formula.
   - That Friday's higher weight and the Monday-after-weekend exclusion still behave correctly under (c) where Friday is part of the weekend block.
3. If options (b)/(c) cannot be delivered without changing a weight or the score formula → **STOP and surface** (the freeze forbids it; the operator decides whether to amend the freeze deliberately, which is a separate decision outside this document).
4. Report the audit + the precise structure-vs-scoring boundary, then proceed only if the boundary holds.

### Build (after audit confirms)
1. **Setting:** add a weekend-structure option to `watch_settings` (e.g. `weekend_structure enum('per_day','sat_sun_block','fri_sat_sun_block')`, default `per_day` to preserve current behaviour) — migration + the shared `WatchSettingsForm` control. (`include_weekends=false` still disables weekends entirely; this setting only applies when weekends are on.)
2. **Generation:** the schedule engine honours the structure — for block modes, assign one crew member to the block (Sat+Sun, or Fri+Sat+Sun) per the rotation/fairness selection, instead of per-day. Keep determinism. The fairness selection still uses the **unchanged** `selectCandidate` cost — the engine asks who should take the *weekend block* using the same scoring inputs, then records the block assignment.
3. **Ledger:** `updateLedger` records the correct counts for a block assignment **using the existing fields and rules** (the audit defines whether a block is one unit or per-day; implement that as input to the frozen formula). No new weight, no formula change.
4. **Display:** the calendar/exports render block assignments sensibly (e.g. a Sat+Sun block shows the same crew across both, Fri+Sat+Sun across all three), with the existing weekend/Friday cell styling.
5. Update `schedule.md` (the weekend-structure option and how block assignment works) and `backend.md` (the new setting). `fairness.md` is **NOT** edited — scoring is unchanged.

### Gate
- [ ] Audit produced; the structure-vs-scoring boundary is explicit; confirmed NO weight/formula/score change is required (frozen scoring intact).
- [ ] `weekend_structure` setting persists; default `per_day` reproduces current behaviour exactly (regression check — existing vessels unchanged).
- [ ] `sat_sun_block`: one crew member covers Sat+Sun in the generated schedule; fairness counts correctly via the unchanged formula; determinism holds.
- [ ] `fri_sat_sun_block`: one crew member covers Fri+Sat+Sun; Friday weighting and the Monday-after-weekend exclusion still behave correctly; determinism holds.
- [ ] Engine unit tests still reproduce the worked-example numbers (scoring frozen).
- [ ] Calendar/exports render block assignments correctly.
- [ ] Build passes; RLS intact; `fairness.md` unchanged.

### Spec to update on completion
`schedule.md` (weekend structure + block assignment), `backend.md` (`weekend_structure` setting), `frontend.md` (the setting control). `fairness.md` unchanged.

---

## PHASE B7 — Charter Mode — ENGINE-TOUCHING, AUDIT-GATED (flagship, largest)

### Objective
Deliver the marketing site's flagship promise: **Charter Mode** — pause the watch rotation when a charter begins, freeze it for the charter period, and **resume from the correct crew member** afterward so rotation continuity and fairness are preserved. (The site features this prominently: a "How It Works" pillar, a dedicated section, the hero mockup "Charter · Paused · Resumes Monday," and every tier's feature list.)

### Audit first (read-only; no code)
Before building:
1. Establish how generation currently produces the forward horizon and how the persistent ledger + replay model work (Phase-7), since Charter Mode is fundamentally "do not assign watches during the charter window, then continue the rotation as if uninterrupted."
2. Determine how a charter window (a date range during which the rotation is paused/frozen) can be expressed as a **scheduling-structure** change — i.e. the generator skips assignment within the charter range and resumes the rotation from the correct next-due crew member afterward — **without changing the fairness scoring**. Confirm:
   - The "resume from the correct crew member" requirement is satisfied by the existing fairness/replay logic (the next-due crew naturally falls out of the persistent ledger — paused days simply aren't assigned, so no one accrues burden during the charter, and the lowest-cumulative crew is correctly next).
   - Whether any new state is needed (a charter window record) vs. whether it can be modelled as a generation parameter.
3. If "resume from correct crew" cannot be achieved without altering the scoring/ledger rules → STOP and surface. Expectation: it can, because skipping assignment for a date range is a *structure* change; the unchanged scoring then picks the right next crew.
4. Report the audit + design (new `charter_periods` table vs. generation parameter; how pause/resume interacts with the horizon and `is_current`) before any code.

### Build (after audit confirms)
1. **Charter window model:** likely a `charter_periods` table (vessel_id, start_date, end_date, status) — server-written/SELECT-only per the inherited RLS model — OR a generation parameter, per the audit's recommendation. A charter has a clear start and end; "auto-resume" means generation resumes assignment after `end_date`.
2. **Generation:** during a charter window, the engine assigns no watches (the rotation is frozen); after the window, it resumes — and because no burden accrued during the pause, the existing fairness selection naturally resumes from the correct (next-due) crew member. Determinism preserved. The **scoring is unchanged** — Charter Mode is purely "skip this date range, then continue."
3. **UI:** a Charter Mode control (set a charter period: start/end; show "Paused · Resumes [date]" state on the dashboard, matching the marketing language); the calendar renders the charter window distinctly (paused state, per branding's charter/paused styling — `--ws-warn`). Regenerate honours active charter periods.
4. **Continuity check:** prove that after a charter, the rotation resumes from the correct crew member and fairness remains balanced (the differentiator's promise — "fairness disappears" is the problem; Charter Mode must visibly preserve it).
5. Update `schedule.md` (charter windows + pause/resume generation) and `backend.md` (the `charter_periods` model + RLS). `fairness.md` unchanged.

### Gate
- [ ] Audit produced; confirmed Charter Mode is a scheduling-structure change requiring NO scoring/ledger-rule change (frozen scoring intact); design (table vs parameter) recorded.
- [ ] A charter period can be set (start/end); the dashboard shows the paused state ("Paused · Resumes [date]") matching the site language.
- [ ] During the charter window, the generated schedule assigns NO watches (rotation frozen).
- [ ] After the window, generation resumes **from the correct next-due crew member**, and fairness remains balanced — proven (the continuity promise).
- [ ] Determinism holds (same inputs + same charter window → identical output).
- [ ] Engine unit tests still reproduce the worked-example numbers (scoring frozen).
- [ ] Calendar renders the charter window distinctly; regenerate honours active charter periods.
- [ ] If `charter_periods` added: RLS client-SELECT-only, service-role-write, vessel-scoped, cross-vessel denied (proven).
- [ ] Build passes; `fairness.md` unchanged.

### Spec to update on completion
`schedule.md` (charter windows + pause/resume), `backend.md` (`charter_periods` + RLS), `frontend.md` (Charter Mode surface). `fairness.md` unchanged.

---

## 3. Deferred — A3 Personal Crew View

**A3 (Personal Crew View) is explicitly deferred, not cancelled.** Rationale: cross-referencing the marketing site showed A3 is a feature the site does **not** promise, while several *promised* features (Charter Mode, PDF export, correct pricing) were unbuilt or inconsistent. Building an un-advertised surface ahead of already-promised features is the wrong priority. A personal per-crew view is genuinely valuable and is the natural foundation for future per-seat expansion — **revisit it after B0–B7 close**, at which point the crew-identity decision (Option A: captain-side per-crew view, zero auth change; vs Option B: per-crew logins, a larger auth/RLS effort) is made deliberately. Until then it stays out of the build queue.

---

## 4. Done Definition

This second wave is complete when:
- B0–B7 gates all pass.
- **Fairness scoring was never modified** (verifiable: `fairness.md` unchanged; engine unit tests still reproduce the worked-example numbers). The engine-touching phases (B5/B6/B7) changed only scheduling structure, each behind a passed audit.
- App + Stripe pricing matches the site (€39/€99/€199; €390/€990/€1990), with old prices archived.
- All new edge-function code is deployed and version-confirmed on `gvpyknochnntoqsetomk`.
- The relevant spec docs are updated to match what shipped (with intentional reversals — pricing, tier-count — explicitly recorded).
- The marketing site no longer promises anything the product lacks (B0).
- Nothing from the out-of-scope list crept in.

---

*Governing principle: this wave makes the product match what's been promised and what the operator requires, without ever changing how fairness is calculated. Three phases touch scheduling structure — each begins with a read-only audit that draws the line between structure (permitted) and scoring (frozen). If any phase can only be delivered by changing the scoring, the phase is wrong — stop and surface it.*
