# Choosing the generation window when regenerating — approved 24 November 2026

The window is the single most consequential choice in a regeneration: it decides which days are re-planned and which are left standing. It lived only in Settings → Watch configuration, so changing it meant leaving the dashboard, finding the panel, saving, coming back, and regenerating.

**The regenerate dialog now carries the window.** Weeks ahead, a month, or an explicit date range — with the resulting span stated in plain dates before anything is built, including the note that a window which has already begun starts today, because watches already stood are never rewritten.

## It is saved, not passed

`generate-schedule` reads the window from the stored configuration. The dialog therefore **saves** the choice and then generates — which also keeps Settings showing the truth afterwards, rather than the dashboard and the settings page disagreeing about what the vessel is set to.

## Why a new RPC

`watch_settings` is SELECT-only for the client (master.md §2 invariant 2), so the write needs a server function — and `save_watch_configuration` is the wrong instrument: it rewrites the vessel's **lanes** as well, relabelling them and rebuilding `lane_departments`. Regenerating must not touch the lane configuration.

`set_generation_window(p_mode, p_start, p_end, p_horizon_weeks)` (migration `20261124050000`) writes those four columns and nothing else, re-deriving the vessel from `auth.uid()` like every other client RPC. It enforces the same caps the engine and the table do: 1–13 weeks, an explicit window of at most 91 days inclusive, end not before start.

## Validation lives in both places, deliberately

`windowProblem()` disables the Regenerate button and says why, so a bad window is caught before a round trip. The RPC re-checks all of it, because a client-side guard is a convenience and never a control.

## Seams

- **`GenerationWindowPicker.tsx`** — presentational, owns no persistence; exports `effectiveWindow` and `windowProblem` as pure functions.
- **`RegenerateButton.tsx`** — seeds from the saved configuration when the dialog opens, saves through the RPC, then generates. The fixed-watch consent gate is unchanged and still blocks the run.
- **RPC `set_generation_window`** — migration `20261124050000`, `authenticated`-only.

Verification: `GenerationWindowPicker.test.ts` — month spans incl. leap years, weeks inclusive of the final day, the 1–13 clamp, a begun window starting today, a future window taken as given, and refusal of incomplete, backwards, passed and oversized windows (with exactly 91 days accepted).
