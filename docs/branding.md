<!-- WatchSchedule spec set — v2 (cross-referenced & seam-verified). Document 1 of 6: branding. -->
# branding.md — WatchSchedule Application Design System

> **Purpose.** Single source of truth for the visual identity of the WatchSchedule *application* (the authenticated product behind `app.watchschedule.com`). Claude Code must derive every colour, font, spacing, radius, and component decision from this document. Do not introduce colours, fonts, or shadows that are not defined here. This palette is **locked for v1** — do not substitute, tint, or "improve" it.

---

## 1. Design Thesis

**A professional bridge tool, not a startup productivity app.** WatchSchedule is dedicated watch-scheduling software for superyachts. The reference points are **Feadship, Burgess, Fraser, Garmin Marine, Furuno** — luxury maritime and marine instrumentation. The anti-references are **Monday.com, Asana, ClickUp, HubSpot** — generic SaaS. Every design decision is judged against that line: if it looks like a productivity startup, it's wrong.

Three principles:

1. **Maritime luxury, not flashy.** Deep midnight navy surfaces, a restrained warm-gold accent that reads as yacht-interior brass/teak rather than neon. Premium through material and restraint, never through brightness or saturation.
2. **Operational clarity.** This is a tool captains and officers rely on at a chart table. Information is laid out like quality marine instrumentation: clear zones, calm surfaces, legible data, no decorative noise. Fairness scores and watch grids read like trustworthy gauges and readouts.
3. **One accent, used with discipline.** Warm Gold (`--ws-gold`) is the only strong chromatic colour. It marks primary actions, active states, key metrics, and icons. Everything else is navy/steel/greyscale. If everything is gold, nothing is.

---

## 2. Colour Tokens — LOCKED PALETTE

Define these as CSS custom properties on `:root`. The application is **dark-theme only** for v1 (no light mode).

```css
:root {
  /* ============ CORE LOCKED PALETTE ============ */
  --ws-navy:      #0B1420;  /* Midnight Navy — primary background, header, footer, hero, UI chrome */
  --ws-steel:     #1A2433;  /* Steel Grey — UI surfaces: cards, schedule panels, dashboard widgets */
  --ws-gold:      #C8A46B;  /* Warm Gold — primary accent: CTAs, active states, key metrics, icons */
  --ws-offwhite:  #F7F5F1;  /* Off White — primary text, headlines, hero text (NEVER pure white) */
  --ws-slate:     #8A94A6;  /* Slate Grey — secondary text, captions, metadata, explanatory copy */
  --ws-seagreen:  #4E8D74;  /* Sea Green — success/fairness/approved/rotation intact (NOT bright SaaS green) */

  /* ============ DERIVED SURFACES (navy/steel family) ============ */
  /* Derived by small luminance steps from the locked core — stay within the family. */
  --ws-navy-deep:   #070E17;  /* deepest well — app background base, inset areas, behind cards */
  --ws-steel-2:     #212D3E;  /* raised surface: modal, popover, hovered card */
  --ws-steel-3:     #2A384B;  /* input fields, hover state on surfaces, segmented-control track */
  --ws-steel-inset: #0B142066;/* semi-transparent inset: calendar empty cells, code/data wells */

  /* ============ HAIRLINES & BORDERS ============ */
  --ws-line:        #2A384B;  /* default hairline divider, card border */
  --ws-line-strong: #3A4A60;  /* emphasised / focused-input border */
  --ws-line-faint:  #1E2937;  /* barely-there internal grid lines (calendar) */

  /* ============ TEXT ============ */
  --ws-text:        var(--ws-offwhite); /* primary text */
  --ws-text-muted:  var(--ws-slate);    /* secondary text, labels, metadata */
  --ws-text-faint:  #5C6678;            /* captions, disabled, timestamps, watermark */
  --ws-text-on-gold:#0B1420;            /* text placed on top of gold fills — use navy */

  /* ============ GOLD ACCENT STATES ============ */
  --ws-gold-bright: #D8B985;  /* hover / brighten */
  --ws-gold-dim:    #A8854F;  /* pressed / low-emphasis */
  --ws-gold-ghost:  #C8A46B1A;/* 10% gold — selected backgrounds, focus ring base, subtle fills */
  --ws-gold-glow:   #C8A46B3D;/* ~24% gold — glow on genuinely active/live elements only */

  /* ============ DASHBOARD METRIC COLOURS (from brief) ============ */
  --ws-metric-balance:   #C8A46B;  /* Watch Balance — gold */
  --ws-metric-weekend:   #D4B483;  /* Weekend Fairness — lighter gold/sand */
  --ws-metric-rotation:  #4E8D74;  /* Rotation Continuity — sea green */
  --ws-metric-status:    #F7F5F1;  /* Status — off white */

  /* ============ SEMANTIC STATUS ============ */
  --ws-ok:     var(--ws-seagreen); /* fair / balanced / approved / intact */
  --ws-warn:   #D4A24E;            /* mild imbalance / attention — amber-gold, stays in warm family */
  --ws-alert:  #C2685E;            /* unfair / conflict / error — muted maritime red, NOT bright */
  --ws-info:   var(--ws-gold);     /* informational — reuse gold */

  /* ============ FAIRNESS GAUGE SCALE ============ */
  /* The fairness chip/bar fill colour is driven by these thresholds (see fairness.md). */
  --ws-fair-high: #4E8D74;  /* >=85% — sea green */
  --ws-fair-mid:  #C8A46B;  /* 70-84% — gold */
  --ws-fair-low:  #C2685E;  /* <70% — muted red */
}
```

**Status colour rule.** `--ws-ok / warn / alert` and the metric colours appear *only* on fairness indicators, dashboard metrics, validation, and system status. They are never decoration. The default emphasis colour for interactive elements is always `--ws-gold`. Keep reds and ambers muted and maritime — never bright/SaaS.

---

## 3. Typography

Per the locked brief. Avoid Montserrat, Poppins, Roboto — they read as generic.

| Role | Family | Usage |
|---|---|---|
| **Headings / Display** | `"Inter Tight", "Manrope", system-ui, sans-serif` | All headings, page titles, card titles, hero text. Inter Tight primary; Manrope acceptable alternate. Tight, confident, slightly condensed. |
| **Body / UI** | `"Inter", -apple-system, "Segoe UI", system-ui, sans-serif` | Body copy, buttons, navigation, form controls, secondary text. |
| **Mono / Data** | `"JetBrains Mono", "SF Mono", ui-monospace, monospace` | Fairness scores, watch codes (crew initials like AM, BK), timestamps, vessel metadata, week/year numbers — anything tabular/"readout". |

Load `Inter Tight`, `Manrope` (optional), `Inter` (weights 400/500/600/700), `JetBrains Mono` (400/500/600). Google Fonts CDN acceptable for v1; self-hosting preferred for `app.` later (at-sea connectivity) — note as v1.1.

### Type scale

```css
:root {
  --ws-font-display: "Inter Tight", "Manrope", system-ui, sans-serif;
  --ws-font-ui:      "Inter", -apple-system, "Segoe UI", system-ui, sans-serif;
  --ws-font-mono:    "JetBrains Mono", "SF Mono", ui-monospace, monospace;

  --ws-text-xs:   0.75rem;   /* 12px — captions, timestamps */
  --ws-text-sm:   0.8125rem; /* 13px — secondary, table cells */
  --ws-text-base: 0.9375rem; /* 15px — body default */
  --ws-text-md:   1.0625rem; /* 17px — emphasised body, card titles */
  --ws-text-lg:   1.375rem;  /* 22px — section headings */
  --ws-text-xl:   1.875rem;  /* 30px — page titles */
  --ws-text-2xl:  2.5rem;    /* 40px — dashboard hero numbers (fairness %) */
  --ws-text-3xl:  3.5rem;    /* 56px — large gauge readout */

  --ws-leading-tight:   1.15;
  --ws-leading-normal:  1.5;
  --ws-leading-relaxed: 1.65;

  --ws-tracking-tight:  -0.02em; /* large display numbers, Inter Tight headings */
  --ws-tracking-normal: 0;
  --ws-tracking-wide:   0.08em;  /* eyebrows / labels */
  --ws-tracking-mono:   0.02em;  /* mono data */
}
```

### Eyebrow / label style (recurring structural device)

```css
.ws-eyebrow {
  font-family: var(--ws-font-mono);
  font-size: var(--ws-text-xs);
  font-weight: 500;
  letter-spacing: var(--ws-tracking-wide);
  text-transform: uppercase;
  color: var(--ws-gold);
}
```

Used for section labels (FAIRNESS ENGINE, WATCH SCHEDULE, CREW LIST). Optionally prefixed with an em dash. Use sparingly.

---

## 4. Spacing, Radius, Elevation

```css
:root {
  /* Spacing (4px base) */
  --ws-space-1: 0.25rem;  /*  4px */
  --ws-space-2: 0.5rem;   /*  8px */
  --ws-space-3: 0.75rem;  /* 12px */
  --ws-space-4: 1rem;     /* 16px */
  --ws-space-5: 1.5rem;   /* 24px */
  --ws-space-6: 2rem;     /* 32px */
  --ws-space-7: 3rem;     /* 48px */
  --ws-space-8: 4rem;     /* 64px */

  /* Radius — restrained; quality instruments are mostly square with soft corners */
  --ws-radius-sm:   6px;   /* chips, small buttons, inputs */
  --ws-radius-md:   10px;  /* cards, panels */
  --ws-radius-lg:   16px;  /* modals, major containers */
  --ws-radius-full: 999px; /* pills, avatars, status dots */

  /* Elevation — on dark navy, raise by stepping surface + hairline, not heavy shadow */
  --ws-shadow-sm: 0 1px 2px rgba(0,0,0,0.45);
  --ws-shadow-md: 0 4px 18px rgba(0,0,0,0.50);
  --ws-shadow-lg: 0 18px 50px rgba(0,0,0,0.60);
  --ws-glow-gold: 0 0 0 1px var(--ws-gold-ghost), 0 0 24px var(--ws-gold-glow); /* live elements only */
}
```

**Elevation rule.** Raise elements by stepping the surface token (`steel -> steel-2`) plus a hairline border. Reserve `--ws-glow-gold` for genuinely live/active elements (active calendar week, generating state, primary CTA hover). No heavy drop shadows — they read as generic SaaS.

---

## 5. Core Components (specification — normative)

### Buttons
- **Primary** (`.ws-btn-primary`): bg `--ws-gold`, text `--ws-text-on-gold` (navy), weight 600, radius `--ws-radius-sm`, padding `10px 18px`. Hover -> `--ws-gold-bright` + `--ws-glow-gold`. Active -> `--ws-gold-dim`. Disabled -> bg `--ws-steel-3`, text `--ws-text-faint`, no glow.
- **Secondary** (`.ws-btn-secondary`): transparent bg, `1px solid --ws-line-strong`, text `--ws-text`. Hover -> bg `--ws-steel-3`, border `--ws-gold`.
- **Ghost** (`.ws-btn-ghost`): no border, text `--ws-text-muted`. Hover -> text `--ws-text`, bg `--ws-steel-2`.
- **Destructive**: secondary shape; border/text shift to `--ws-alert` on hover. Used for delete crew member.
- All: `transition: all 140ms ease;`. Focus-visible -> `outline: 2px solid var(--ws-gold); outline-offset: 2px;`.

### Cards / Panels
- bg `--ws-steel`, border `1px solid --ws-line`, radius `--ws-radius-md`, padding `--ws-space-5`.
- Header: eyebrow + title (`--ws-text-md`, `--ws-font-display`, weight 600), optional hairline divider below.

### Inputs / Selects
- bg `--ws-steel-3`, border `1px solid --ws-line`, radius `--ws-radius-sm`, text `--ws-text`, padding `10px 12px`.
- Placeholder `--ws-text-faint`. Focus -> border `--ws-gold`, ring `--ws-gold-ghost`.
- Labels above inputs: `--ws-text-sm`, `--ws-text-muted`, weight 500.

### Fairness Score Chip (signature data element)
- Mono percentage (large on dashboard hero), thin horizontal gauge bar beneath.
- Bar fill by fairness scale: >=85 `--ws-fair-high` (sea green), 70-84 `--ws-fair-mid` (gold), <70 `--ws-fair-low` (muted red).
- Shows crew member name, score %, gauge. On dashboard, one per crew member; grouped by department for Triple, by lane for Dual. See `fairness.md`.

### Watch Calendar Cell
- Empty: `--ws-steel-inset`, faint border `--ws-line-faint`.
- Assigned: bg `--ws-steel-2`, crew initials mono (`--ws-text-sm`, weight 500), full name on hover.
- **Friday cells:** subtle gold left-border (`2px solid --ws-gold-dim`) — visual nod to Friday's higher weight (see `fairness.md`).
- **Weekend cells (Sat/Sun):** faintly distinct background (`--ws-navy`) to show they're a separate rotation from Mon-Fri.
- Active/current week (month view) -> `--ws-glow-gold` ring. Today (week view) -> top border `2px solid --ws-gold`.

### Status Dots (8px, `--ws-radius-full`)
- Live/active -> `--ws-gold` (+ `--ws-gold-glow` halo). Approved/intact -> `--ws-ok` (sea green). Paused/charter -> `--ws-warn`. Conflict -> `--ws-alert`. Ineligible crew -> `--ws-text-faint`.

### Chatbot Panel (Claude integration)
- Docked panel or modal, bg `--ws-steel-2`. User messages right-aligned in `--ws-steel-3` bubbles; assistant messages left-aligned, borderless on `--ws-steel-2`, with a small gold tick/avatar.
- Input pinned bottom (input spec) + primary send button.
- Any schedule data the assistant cites (dates, initials, scores) rendered in mono.

---

## 6. Iconography & Imagery

- **Icons:** single line set (Lucide). Stroke `1.5px`, sized to text. Colour follows context text token; interactive icons brighten to `--ws-gold` on hover.
- **Imagery:** cinematic yacht/bridge photography only on the login/auth screen and empty states, always with a navy overlay (`--ws-navy` 60-80%) for legibility. Never behind data views — data is the hero.
- **Logo:** existing WatchSchedule wordmark in the app top bar, ~24-28px tall.

---

## 7. Layout Shell

```
+----------------------------------------------------------+
|  TOP BAR  [logo]   M/Y Vessel - 72m       [tier] [user v] |  <- --ws-navy, hairline bottom (--ws-line)
+----------------------------------------------------------+
|                                                          |
|   PAGE CONTENT  (max-width ~1200px, centered, padded)    |  <- --ws-navy-deep base
|                                                          |
+----------------------------------------------------------+
```

- **No heavy sidebar.** Two-view product (Dashboard, Settings) -> navigation lives as two tabs/links in the top bar.
- Top bar: logo, vessel name + size (mono), product-tier badge (gold outline), user menu (sign out, manage subscription).
- Content centred, comfortable max width. iPad portrait -> single column stack.

---

## 8. Motion

Restrained, functional. Respect `prefers-reduced-motion: reduce` (disable non-essential motion).

- State transitions `140-200ms ease`.
- Schedule generation: calm "computing" state — subtle gold shimmer / progress pulse on the generate button + skeleton calendar grid. No spinner carnival; it should feel like instrumentation computing.
- Week/month toggle: cross-fade or slide (`200ms`); reduced-motion -> instant.
- Fairness gauge bars: animate width 0 -> value on first paint (`400ms ease-out`); reduced-motion -> render at value.

---

## 9. Accessibility Floor (non-negotiable)

- All text meets WCAG AA against its surface. Verify any new combinations (note: gold on navy is strong; gold text on steel must be checked at small sizes — prefer off-white for body, reserve gold for emphasis/large/icons).
- Every interactive element has a visible `:focus-visible` (gold outline).
- Full keyboard navigation: onboarding steps, calendar toggle, crew CRUD, chatbot.
- Status never by colour alone — pair fairness colours with the numeric % and, where relevant, icon/label.
- Touch hit targets >= 40px.
- Charter "paused" and crew "ineligible" carry text labels, not just colour.

---

## 10. Token Quick-Reference

- App background: `--ws-navy` `#0B1420` (base well `--ws-navy-deep` `#070E17`)
- Cards/panels/widgets: `--ws-steel` `#1A2433`, border `--ws-line` `#2A384B`
- Primary text: `--ws-offwhite` `#F7F5F1`; secondary `--ws-slate` `#8A94A6`
- The accent (everything primary/live): `--ws-gold` `#C8A46B`
- Fairness/success: `--ws-seagreen` `#4E8D74`
- Fairness scale: high `#4E8D74`, mid `#C8A46B`, low `#C2685E`
- Headings Inter Tight / Manrope; body Inter; data/scores JetBrains Mono
- Radius: cards 10px, controls 6px
- Glow for live elements only: `--ws-glow-gold`

> **Brand feel test (apply before shipping any view):** Does this look like Feadship / Garmin Marine, or like Asana? If it drifts toward generic SaaS, pull it back — deeper navy, calmer surfaces, less gold, more restraint. Spend boldness only on the fairness gauge and the live-state gold accent. Before leaving the house, remove one accessory.
