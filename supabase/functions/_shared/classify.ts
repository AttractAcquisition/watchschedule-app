// Deno copy of the position -> department classifier. parse-crew-list uses this
// to NORMALISE Claude's output: if the model returns a department outside the
// enum (or none), fall back to these deterministic rules so the candidate is
// always one of the four watch departments.
//
// KEEP IN SYNC with app/src/lib/classifyDepartment.ts (the client copy used by
// manual entry). Same rules, both runtimes — backend.md §6.4 "the same
// position->department classification ... also used to auto-detect on manual entry".
export type Department = 'deck' | 'interior' | 'engineering' | 'officer'

export const DEPARTMENTS: Department[] = ['deck', 'interior', 'engineering', 'officer']

const RULES: [RegExp, Department][] = [
  [/\b(eng|engineer|engineering|e\.?t\.?o\.?|electro.?technical|motorman|oiler|mechanic|fitter)\b/i, 'engineering'],
  [/\b(capt|captain|master|skipper|chief officer|first officer|1st officer|second officer|2nd officer|third officer|3rd officer|officer|mate|navigat|bridge)\b/i, 'officer'],
  [/\b(stew|stewardess|steward|chef|cook|galley|interior|purser|housekeep|laundry|service|sommelier|masseu|massage|spa|nurse|hostess)\b/i, 'interior'],
  [/\b(deck|deckhand|bosun|boatswain|able seaman|a\.?b\.?|seaman|mariner|tender|lead deck)\b/i, 'deck'],
]

export function classifyDepartment(position: string): Department {
  const p = (position ?? '').trim()
  if (!p) return 'deck'
  for (const [re, dept] of RULES) if (re.test(p)) return dept
  return 'deck'
}

export function isDepartment(value: unknown): value is Department {
  return typeof value === 'string' && (DEPARTMENTS as string[]).includes(value)
}
