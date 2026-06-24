// fairness_constants.ts — the SINGLE tuning surface for the fairness engine.
// Verbatim from fairness.md §10. No fairness magic numbers may live anywhere
// else; the engine imports every weight/threshold from here.

// Ledger burden weights (fairness.md §3)
export const W_WEEKDAY = 1.0 // a normal Mon–Thu watch
export const W_FRIDAY = 1.5 // Friday is heavier (extra 0.5 on top of being a weekday)
export const W_WEEKEND = 1.3 // a Sat or Sun watch (per day)
export const W_CONSEC = 0.25 // added burden per day of consecutive run beyond the first

// Selection-time extra penalties (fairness.md §4)
export const W_FRIDAY_SELECT = 2.0 // extra penalty per existing Friday when assigning a Friday
export const RECENCY_NUDGE = 0.1 // tiny tie-shaper for a very-recent last_watch_date

// Score scaling (fairness.md §5)
export const K = 25 // points lost per 1 std-dev from the lane mean
export const EPSILON = 0.5 // spread floor to avoid divide-by-zero
export const SCORE_HIGH = 85 // >= -> sea green (well balanced)
export const SCORE_MID = 70 // 70–84 -> gold; < -> muted red
