// FairnessChip — the signature data element (branding.md §5). Mono % + thin
// gauge bar coloured by the fairness scale (fairness.md §5). Click to expand the
// breakdown (total / weekends / Fridays / last-on-watch / consecutive run — the
// same data the Phase-10 chatbot will cite). Status never by colour alone: the
// numeric % accompanies the gauge (branding.md §9). Score is READ from the
// ledger — never computed here.
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { GaugeBar } from '../../components/ui/GaugeBar'
import { BAND_BAR, BAND_TEXT, scoreBand } from './fairness'
import type { Crew, LedgerRow } from './useDashboardData'

export function FairnessChip({ crew, row }: { crew: Crew; row: LedgerRow | undefined }) {
  const [open, setOpen] = useState(false)
  const hasScore = row?.fairness_score != null
  const score = hasScore ? Math.round(row!.fairness_score as number) : null
  const band = score != null ? scoreBand(score) : null

  return (
    <div className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-ws-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate font-ui text-ws-base font-medium text-ws-text">{crew.full_name}</p>
          <p className="truncate text-ws-xs text-ws-text-muted">{crew.position}</p>
        </div>
        <div className="flex items-center gap-ws-2">
          <span className={`font-mono text-ws-lg tracking-ws-tight ${band ? BAND_TEXT[band] : 'text-ws-text-faint'}`}>
            {score != null ? `${score}` : '—'}
            {score != null && <span className="text-ws-sm text-ws-text-muted">%</span>}
          </span>
          <ChevronDown className={`h-4 w-4 text-ws-text-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.5} aria-hidden />
        </div>
      </button>

      <div className="mt-ws-3">
        {band ? <GaugeBar value={score!} barClass={BAND_BAR[band]} /> : <div className="h-1.5 w-full rounded-ws-full bg-ws-steel-3" />}
      </div>

      {open && (
        <dl className="mt-ws-4 grid grid-cols-2 gap-x-ws-4 gap-y-ws-2 border-t border-ws-line pt-ws-3 text-ws-sm">
          {[
            ['Total watches', row?.total_watches ?? 0],
            ['Weekends', row?.weekend_watches ?? 0],
            ['Fridays', row?.friday_watches ?? 0],
            ['Consecutive run', row?.consecutive_run ?? 0],
            ['Last on watch', row?.last_watch_date ?? '—'],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between gap-ws-2">
              <dt className="text-ws-text-muted">{label}</dt>
              <dd className="font-mono text-ws-text">{String(val)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
