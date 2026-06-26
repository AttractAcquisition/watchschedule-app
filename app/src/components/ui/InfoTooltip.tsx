// InfoTooltip (B2 item 2) — a small "?" help affordance with an accessible
// tooltip. Keyboard-focusable button; the bubble shows on BOTH hover and focus
// and hides on blur/leave/Escape. The button is aria-describedby the bubble, so
// screen readers announce the help text. Animation is gated behind motion-safe:
// users with prefers-reduced-motion get an instant show/hide. Tokens only.
import { useId, useState } from 'react'
import { HelpCircle } from 'lucide-react'

export function InfoTooltip({ text, label = "What's this?" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        className="flex h-6 w-6 items-center justify-center rounded-ws-full text-ws-text-muted transition-colors hover:text-ws-gold focus:text-ws-gold focus:outline-none focus-visible:ring-1 focus-visible:ring-ws-gold"
      >
        <HelpCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute bottom-full left-1/2 z-50 mb-ws-2 w-64 -translate-x-1/2 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3 text-ws-xs leading-ws-normal text-ws-text shadow-ws-md motion-safe:transition-opacity"
      >
        {text}
      </span>
    </span>
  )
}
