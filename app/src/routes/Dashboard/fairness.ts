// Client-side fairness display helpers (fairness.md §5 score interpretation +
// branding.md §2 fairness gauge scale). The 0–100 score is computed server-side
// (fairness_engine.computeFairnessScore); the client only maps it to the gauge.
//
// Thresholds mirror fairness.md §10 (SCORE_HIGH=85, SCORE_MID=70) and
// supabase/functions/_shared/fairness_constants.ts — keep in sync.
export type Band = 'high' | 'mid' | 'low'

export function scoreBand(score: number): Band {
  if (score >= 85) return 'high' // sea green — well balanced
  if (score >= 70) return 'mid' // gold — slightly off
  return 'low' // muted red — over/under-loaded
}

// branding.md fairness scale tokens (--ws-fair-high / mid / low).
export const BAND_BAR: Record<Band, string> = {
  high: 'bg-ws-fair-high',
  mid: 'bg-ws-fair-mid',
  low: 'bg-ws-fair-low',
}
export const BAND_TEXT: Record<Band, string> = {
  high: 'text-ws-fair-high',
  mid: 'text-ws-fair-mid',
  low: 'text-ws-fair-low',
}

// "James Holloway" -> "JH"; single token -> first two letters.
export function initials(fullName: string): string {
  const toks = fullName.trim().split(/\s+/).filter(Boolean)
  if (toks.length === 0) return '—'
  if (toks.length === 1) return toks[0].slice(0, 2).toUpperCase()
  return (toks[0][0] + toks[toks.length - 1][0]).toUpperCase()
}
