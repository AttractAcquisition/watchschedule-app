// GaugeBar — the thin horizontal fairness gauge under a score (branding.md §5
// fairness chip + §8 motion: animate width 0->value on first paint, 400ms
// ease-out; reduced-motion renders at value). Colour comes from the caller (the
// fairness band). Tokens only.
import { useEffect, useState } from 'react'

export function GaugeBar({ value, barClass }: { value: number; barClass: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [width, setWidth] = useState(reduced ? pct : 0)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setWidth(pct))
    return () => cancelAnimationFrame(id)
  }, [pct, reduced])
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-ws-full bg-ws-steel-3" role="presentation">
      <div
        className={`h-full rounded-ws-full ${barClass}`}
        style={{ width: `${width}%`, transition: reduced ? undefined : 'width 400ms ease-out' }}
      />
    </div>
  )
}
