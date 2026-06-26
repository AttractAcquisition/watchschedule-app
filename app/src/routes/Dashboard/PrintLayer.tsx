// B3 — PrintLayer + print trigger. The print document is portaled to <body> as a
// sibling of #root so the print stylesheet (index.css) can hide the dark app
// (#root) and show only this light layer when printing / saving as PDF.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export type PrintTarget = 'schedule' | 'fairness' | null

export function PrintLayer({ children }: { children: React.ReactNode }) {
  return createPortal(<div className="ws-print-layer">{children}</div>, document.body)
}

// When a target is set, wait two frames for the portal to paint, then open the
// browser print dialog (the user picks "Save as PDF" or a printer). Clears on
// afterprint. Both "Download PDF" and "Print" use this one browser capability —
// no document service, no new dependency.
export function usePrintWhenSet(target: PrintTarget, clear: () => void) {
  useEffect(() => {
    if (!target) return
    const onAfter = () => clear()
    window.addEventListener('afterprint', onAfter)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
    return () => { window.removeEventListener('afterprint', onAfter); cancelAnimationFrame(raf) }
  }, [target, clear])
}
