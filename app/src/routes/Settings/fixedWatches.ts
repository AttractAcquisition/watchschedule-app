// Fixed watches (docs/fixed-watches.md) — the client contract.
//
// The browser holds NO rota rules. `generate-schedule` with `preview_pins`
// evaluates the captain's pins against the window the next run would build and
// returns what each one covers and breaks; the UI renders that and writes back
// only the codes the server named. Same shape reaches the regenerate dialog.
import { supabase } from '../../lib/supabase'

export interface PinViolation { code: string; severity: 'rule' | 'caution'; message: string }
export interface PinBlocker { code: string; message: string }

export interface EvaluatedPin {
  id: string
  crew_id: string
  crew_name: string
  lane_id: string
  lane_label: string
  watch_date: string
  /** Every day this pin covers — a weekend block moves together. */
  days: string[]
  applies: boolean
  inert_reason: string | null
  violations: PinViolation[]
  blockers: PinBlocker[]
  unacknowledged: string[]
}

export interface PinPreview {
  start_date: string
  end_date: string
  pins: EvaluatedPin[]
}

/** What generation would do with the pins as they stand. Writes nothing. */
export async function previewPins(regenerate: boolean): Promise<PinPreview> {
  const { data, error } = await supabase.functions.invoke<PinPreview & { error?: string }>('generate-schedule', {
    body: { preview_pins: true, regenerate },
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const payload = context ? ((await context.json().catch(() => null)) as { error?: string } | null) : null
    throw new Error(payload?.error ?? "Couldn't check the fixed watches just now.")
  }
  if (data?.error) throw new Error(data.error)
  return { start_date: data?.start_date ?? '', end_date: data?.end_date ?? '', pins: data?.pins ?? [] }
}

/** Record the captain's consent for one pin. Only codes the server reported. */
export async function acknowledgePin(id: string, codes: string[]) {
  const { error } = await supabase.from('watch_pins').update({ acknowledged: codes }).eq('id', id)
  if (error) throw error
}

export const pinNeedsAnswer = (p: EvaluatedPin) => p.applies && (p.unacknowledged.length > 0 || p.blockers.length > 0)
