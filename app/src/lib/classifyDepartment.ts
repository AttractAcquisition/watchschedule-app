// Canonical position -> department classifier (frontend.md §4.4 Step 1:
// "shared classification with the OCR path"). Used by manual crew entry to
// auto-detect a department from a typed position; the captain can override.
//
// The four watch departments (backend.md enum): deck, interior, engineering,
// officer. Command/Captain maps to `officer` here; whether such a person stands
// watch is controlled per-member by the eligibility flag later (§4.6), not here.
//
// NOTE: keep in sync with supabase/functions/_shared/classify.ts (the Deno copy
// parse-crew-list uses to normalise Claude's output). Same rules, both runtimes.
export type Department = 'deck' | 'interior' | 'engineering' | 'officer'

export const DEPARTMENTS: Department[] = ['deck', 'interior', 'engineering', 'officer']

// Ordered rules — first match wins. Engineering is checked before officer so an
// "Electro-Technical Officer (ETO)" classifies as engineering, not officer.
const RULES: [RegExp, Department][] = [
  [/\b(eng|engineer|engineering|e\.?t\.?o\.?|electro.?technical|motorman|oiler|mechanic|fitter)\b/i, 'engineering'],
  [/\b(capt|captain|master|skipper|chief officer|first officer|1st officer|second officer|2nd officer|third officer|3rd officer|officer|mate|navigat|bridge)\b/i, 'officer'],
  [/\b(stew|stewardess|steward|chef|cook|galley|interior|purser|housekeep|laundry|service|sommelier|masseu|massage|spa|nurse|hostess)\b/i, 'interior'],
  [/\b(deck|deckhand|bosun|boatswain|able seaman|a\.?b\.?|seaman|mariner|tender|lead deck)\b/i, 'deck'],
]

// Classify a free-text position. Unknown/blank -> 'deck' (a sane default the
// captain confirms in the review table). Never throws.
export function classifyDepartment(position: string): Department {
  const p = (position ?? '').trim()
  if (!p) return 'deck'
  for (const [re, dept] of RULES) if (re.test(p)) return dept
  return 'deck'
}

export function isDepartment(value: unknown): value is Department {
  return typeof value === 'string' && (DEPARTMENTS as string[]).includes(value)
}
