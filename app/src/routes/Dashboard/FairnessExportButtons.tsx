// B3 — Fairness export trio: WhatsApp/clipboard text, Download PDF, Print.
// The WhatsApp action reuses the A1 clipboard pattern (writeClipboard + a manual
// fallback). PDF + Print route through the browser print pipeline (PrintLayer).
// All read-only over the displayed fairness_ledger — recomputes nothing. Tokens only.
import { useState } from 'react'
import { Check, Copy, FileDown, Printer, X } from 'lucide-react'
import { writeClipboard } from './whatsappExport'
import { formatFairnessText } from './fairnessText'
import type { DashboardData } from './useDashboardData'

const btn = 'flex min-h-[36px] items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-50'

export function FairnessExportButtons({ data, vesselName, onPrint }: { data: DashboardData; vesselName: string; onPrint: () => void }) {
  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState<string | null>(null)
  const hasLedger = data.ledger.length > 0

  async function onCopy() {
    const text = formatFairnessText(data, vesselName)
    if (await writeClipboard(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      setFallback(text)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-ws-2">
        <button type="button" onClick={onCopy} disabled={!hasLedger} className={btn}>
          {copied ? <Check className="h-4 w-4 text-ws-seagreen" strokeWidth={2} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          {copied ? 'Copied!' : 'WhatsApp'}
        </button>
        <button type="button" onClick={onPrint} disabled={!hasLedger} className={btn} title="Save fairness as a PDF (choose “Save as PDF” in the dialog)">
          <FileDown className="h-4 w-4" strokeWidth={1.5} aria-hidden /> PDF
        </button>
        <button type="button" onClick={onPrint} disabled={!hasLedger} className={btn}>
          <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Print
        </button>
      </div>

      {fallback !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Copy the fairness summary</h3>
              <button type="button" onClick={() => setFallback(null)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Your browser blocked clipboard access — select all and copy this into WhatsApp.</p>
            <textarea readOnly value={fallback} onFocus={(e) => e.currentTarget.select()} rows={12}
              className="mt-ws-4 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-3 font-mono text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
          </div>
        </div>
      )}
    </>
  )
}
