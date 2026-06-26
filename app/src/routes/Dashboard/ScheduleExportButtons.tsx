// B3 — Schedule export actions (PDF + Print). Both route through the browser
// print pipeline (PrintLayer + print stylesheet): "Download PDF" prompts the
// user to choose "Save as PDF" as the destination; "Print" goes to a printer.
// Read-only over the current schedule — no recompute, no backend. Tokens only.
import { FileDown, Printer } from 'lucide-react'

const btn = 'flex min-h-[40px] items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-50'

export function ScheduleExportButtons({ hasSchedule, onPrint }: { hasSchedule: boolean; onPrint: () => void }) {
  return (
    <>
      <button type="button" onClick={onPrint} disabled={!hasSchedule} className={btn} title="Save the schedule as a PDF (choose “Save as PDF” in the dialog)">
        <FileDown className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Download PDF
      </button>
      <button type="button" onClick={onPrint} disabled={!hasSchedule} className={btn}>
        <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Print
      </button>
    </>
  )
}
