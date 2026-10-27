// watch_pins.ts — fixed watches: the captain names someone for a specific date
// BEFORE the rota is built (docs/fixed-watches.md, 27 October 2026).
//
// A pin is an INPUT to generation, where a manual override is an edit of its
// output. The rules are the same rules, so they are not restated here:
// `checkPins` delegates to `checkOverride` and differs only in what it treats
// as a fact.
//
// That difference is the whole contract. The days around a pin do not exist
// yet. Pinning someone to a weekend breaks nothing on its own — the generator
// will not hand them that weekend's Friday or the Monday after, because the pin
// is already on the ledger when those days are chosen. So the neighbour rules
// are checked ONLY against facts: another pin, or a watch already stood before
// the generation window. Checking them against ungenerated days would raise a
// false alarm about a day the engine was never going to assign.
//
// Nothing here writes: these are pure predicates.
import { blockFor, checkOverride, type Blocker, type OverrideCrew, type Violation } from './manual_override.ts'
import type { LeaveRange, WeekendStructure } from './schedule_engine.ts'

export interface WatchPin {
  id: string
  crew_member_id: string
  lane_id: string
  watch_date: string
  acknowledged: string[]
}

// What the engine needs: who stands which lane on which day.
export interface EnginePin { lane_id: string; crew_id: string; watch_date: string }

export interface EvaluatedPin {
  id: string
  crew_id: string
  crew_name: string
  lane_id: string
  lane_label: string
  watch_date: string
  /** The block this pin covers — every day it moves together. Empty when inert. */
  days: string[]
  /** Will generation apply it? */
  applies: boolean
  /** Why not, when it will not. */
  inert_reason: string | null
  violations: Violation[]
  blockers: Blocker[]
  /** Codes still needing the captain's consent. */
  unacknowledged: string[]
}

export interface PinLane { id: string; label: string; departments: string[] }

export interface CheckPinsInput {
  pins: WatchPin[]
  crew: OverrideCrew[]
  /** Active lanes only — a pin on a retired lane is inert. */
  lanes: PinLane[]
  structure: WeekendStructure
  leave: LeaveRange[]
  /** The generation window. A pin outside it is kept, but not applied now. */
  start: string
  end: string
  /** Would the engine schedule this day at all? Charter pauses, weekends off. */
  scheduled: (d: string) => boolean
  /** Did they stand a watch BEFORE the window? The only history that is a fact. */
  stoodBefore: (crewId: string, date: string) => boolean
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Pins in a fixed order, so evaluation and generation never depend on row order. */
export const orderPins = <T extends { watch_date: string; lane_id: string }>(pins: T[]): T[] =>
  [...pins].sort((a, b) => cmp(a.watch_date, b.watch_date) || cmp(a.lane_id, b.lane_id))

/**
 * Who, if anyone, is pinned to `laneId` for a block the engine is about to fill.
 * A block is one watch, so the earliest pinned day in it decides.
 */
export function pinnedCrewForBlock(pins: EnginePin[], laneId: string, days: string[]): string | null {
  const inBlock = new Set(days)
  const hits = orderPins(pins.filter(p => p.lane_id === laneId && inBlock.has(p.watch_date)))
  return hits.length ? hits[0].crew_id : null
}

/**
 * Every pin, with the block it covers and everything it breaks. `violations`
 * need the captain's consent (stored per pin in `acknowledged`); `blockers` are
 * refused outright — though the unique constraints on `watch_pins` mean the
 * database refuses the common ones before they ever reach here.
 */
export function checkPins(input: CheckPinsInput): EvaluatedPin[] {
  const { pins, crew, lanes, structure, leave, start, end, scheduled, stoodBefore } = input
  const crewById = new Map(crew.map(c => [c.id, c]))
  const laneById = new Map(lanes.map(l => [l.id, l]))
  const ordered = orderPins(pins)

  // Resolve each pin to the block it covers first: a pin is only a FACT for the
  // neighbour rules once we know it will actually be applied.
  const resolved = ordered.map(pin => {
    const member = crewById.get(pin.crew_member_id)
    const lane = laneById.get(pin.lane_id)
    const days = lane && member ? blockFor(pin.watch_date, start, end, structure, scheduled) : []
    const inert = !member
      ? 'That crew member is no longer on the crew list.'
      : !lane
        ? 'That watch lane is no longer active.'
        : pin.watch_date < start
          ? 'This date has passed, or falls before the generation window.'
          : pin.watch_date > end
            ? 'This date is outside the generation window.'
            : !days.length
              ? 'The schedule does not cover this day — it is charter-paused, or weekends are switched off.'
              : null
    return { pin, member, lane, days, inert }
  })

  // The facts: days an applying pin claims. Pins that will not be applied are
  // not facts, so they cannot raise a neighbour rule against anything.
  const pinnedDays = new Set<string>()
  for (const r of resolved) {
    if (r.inert || !r.member) continue
    for (const d of r.days) pinnedDays.add(r.member.id + ':' + d)
  }

  return resolved.map(({ pin, member, lane, days, inert }): EvaluatedPin => {
    const base = {
      id: pin.id,
      crew_id: pin.crew_member_id,
      crew_name: member?.full_name ?? 'Unknown crew member',
      lane_id: pin.lane_id,
      lane_label: lane?.label ?? 'Retired lane',
      watch_date: pin.watch_date,
      days,
    }
    if (inert || !member || !lane) {
      return { ...base, applies: false, inert_reason: inert, violations: [], blockers: [], unacknowledged: [] }
    }
    const own = new Set(days)
    // Facts only — another pin, or a watch stood before the window. Never a day
    // the generator has yet to plan, and never this pin's own block.
    const stood = (crewId: string, date: string) =>
      (!own.has(date) && pinnedDays.has(crewId + ':' + date)) || stoodBefore(crewId, date)
    const { violations, blockers } = checkOverride({
      crew: member, days, laneDepartments: lane.departments, laneLabel: lane.label,
      structure, leave, scheduled, stood,
    })
    const unacknowledged = violations.filter(v => !pin.acknowledged.includes(v.code)).map(v => v.code)
    return { ...base, applies: true, inert_reason: null, violations, blockers, unacknowledged }
  })
}

/** The pins generation should apply, in engine form. */
export const enginePins = (evaluated: EvaluatedPin[]): EnginePin[] =>
  evaluated.filter(p => p.applies).map(p => ({ lane_id: p.lane_id, crew_id: p.crew_id, watch_date: p.watch_date }))

/** Pins the captain still has to answer for before anything can be generated. */
export const pinsNeedingConsent = (evaluated: EvaluatedPin[]): EvaluatedPin[] =>
  evaluated.filter(p => p.applies && (p.unacknowledged.length > 0 || p.blockers.length > 0))
