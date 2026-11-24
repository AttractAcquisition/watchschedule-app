// Toast — a brief, self-dismissing confirmation, bottom-right.
//
// Used for the fairness recompute that follows a manual watch change: fairness
// is already recalculated server-side by the ordinary replay
// (docs/manual-override.md), but nothing on screen said so, which left the
// captain unsure whether the scores had moved. This says it, then gets out of
// the way.
//
// Tokens only (branding.md) — no raw hex, no fonts. Announced politely so a
// screen reader hears it without stealing focus; motion is opt-out under
// prefers-reduced-motion.
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

export const TOAST_DURATION_MS = 3000

export function Toast({ message, onDismiss, duration = TOAST_DURATION_MS }: {
  message: string
  onDismiss: () => void
  duration?: number
}) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Fade for the last 300ms rather than vanishing mid-read.
    const fade = window.setTimeout(() => setLeaving(true), Math.max(0, duration - 300))
    const close = window.setTimeout(onDismiss, duration)
    return () => { window.clearTimeout(fade); window.clearTimeout(close) }
  }, [duration, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-ws-5 right-ws-5 z-50 flex items-center gap-ws-2 rounded-ws-sm border border-ws-ok bg-ws-steel-2 px-ws-4 py-ws-3 shadow-ws-lg motion-safe:transition-opacity motion-safe:duration-300 ${leaving ? 'opacity-0' : 'opacity-100'}`}
    >
      <Check className="h-4 w-4 shrink-0 text-ws-ok" strokeWidth={1.5} aria-hidden />
      <p className="text-ws-sm text-ws-text">{message}</p>
    </div>
  )
}
