// ImportHistoryButton — "Upload past watches" (docs/history-import.md).
//
// Records watches that were actually stood: typed in by hand, or uploaded as a
// CSV. They become ordinary assignments, so they appear on the calendar and
// fairness recomputes — the client holds NO parsing or matching rules, it sends
// raw rows to `import-watch-history` and shows what comes back.
//
// A crew member who has left the vessel can still be credited: the picker lists
// everyone on the crew list, eligible or not. Hard-deleting a departed member
// destroys their watch history (it cascades), so leaving them on the list as
// ineligible is what keeps the record intact.
import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { dashboardKey, type DashboardData } from './useDashboardData'

interface ImportResult {
  imported?: number
  amended?: number
  new_days?: number
  crew?: number
  from?: string
  to?: string
  unmatched?: string[]
  rejected?: string[]
  errors?: string[]
  applied?: boolean
  error?: string
}

interface Entry { crew_id: string; watch_date: string }

const CSV_TEMPLATE = 'date,crew\n2026-11-05,Greta Pearson\n2026-11-06,Elisa Moreau\n'
const today = () => new Date().toISOString().slice(0, 10)
const pretty = (d?: string) => (d ? format(parseISO(d), 'd MMM yyyy') : '')

async function callImport(body: Record<string, unknown>): Promise<ImportResult> {
  const { data, error } = await supabase.functions.invoke<ImportResult>('import-watch-history', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    const payload = context ? (await context.json().catch(() => null)) as ImportResult | null : null
    throw new Error(payload?.error ?? "That import didn't go through. Please try again.")
  }
  if (data?.error) throw new Error(data.error)
  return data ?? {}
}

export function ImportHistoryButton({ data, vesselId, onImported }: {
  data: DashboardData
  vesselId: string | undefined
  onImported?: () => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'manual' | 'csv'>('manual')
  const [entries, setEntries] = useState<Entry[]>([{ crew_id: '', watch_date: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Everyone on the crew list, not just those eligible for new watches: a
  // departed member still stood the watches they stood.
  const crew = useMemo(() => [...data.crew].sort((a, b) => a.full_name.localeCompare(b.full_name)), [data.crew])
  const ready = entries.filter((e) => e.crew_id && e.watch_date && e.watch_date < today())

  function close() {
    setOpen(false); setError(null); setResult(null)
    setEntries([{ crew_id: '', watch_date: '' }]); setMode('manual')
  }

  async function finish(run: () => Promise<ImportResult>) {
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await run()
      setResult(res)
      if (res.applied) {
        await queryClient.invalidateQueries({ queryKey: dashboardKey(vesselId) })
        onImported?.()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitManual = () => finish(() => callImport({ records: ready }))

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const csv = await file.text()
    await finish(() => callImport({ csv }))
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'past-watches-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 font-ui text-ws-sm text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3"
      >
        <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        Upload past watches
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-label="Upload past watches">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <div className="flex items-start justify-between gap-ws-3">
              <div>
                <p className="ws-eyebrow">— Past watches</p>
                <h3 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Record watches already stood</h3>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <p className="mt-ws-2 text-ws-sm text-ws-text-muted">
              These go onto the calendar as watches that were stood, and fairness recounts from them.
              Past dates only — the generator owns what is still to come.
            </p>

            <div className="mt-ws-4 flex gap-ws-1 rounded-ws-sm border border-ws-line p-ws-1">
              {(['manual', 'csv'] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => { setMode(m); setResult(null); setError(null) }}
                  aria-pressed={mode === m}
                  className={`flex-1 rounded-ws-sm px-ws-3 py-ws-2 text-ws-sm transition-colors ${mode === m ? 'bg-ws-steel-3 text-ws-text' : 'text-ws-text-muted hover:text-ws-text'}`}
                >
                  {m === 'manual' ? 'Type them in' : 'Upload a CSV'}
                </button>
              ))}
            </div>

            <div className="mt-ws-4 min-h-0 flex-1 overflow-y-auto">
              {mode === 'manual' ? (
                <div className="space-y-ws-2">
                  {entries.map((entry, i) => (
                    <div key={i} className="flex items-center gap-ws-2">
                      <select
                        aria-label={`Crew member for row ${i + 1}`}
                        value={entry.crew_id}
                        onChange={(e) => setEntries((rows) => rows.map((r, j) => (j === i ? { ...r, crew_id: e.target.value } : r)))}
                        className="min-w-0 flex-1 rounded-ws-sm border border-ws-line-strong bg-ws-navy-deep px-ws-3 py-ws-2 text-ws-sm text-ws-text"
                      >
                        <option value="">Who stood it…</option>
                        {crew.map((c) => (
                          <option key={c.id} value={c.id}>{c.full_name}{c.eligible ? '' : ' (no longer on watch)'}</option>
                        ))}
                      </select>
                      <input
                        type="date" aria-label={`Date for row ${i + 1}`} max={today()}
                        value={entry.watch_date}
                        onChange={(e) => setEntries((rows) => rows.map((r, j) => (j === i ? { ...r, watch_date: e.target.value } : r)))}
                        className="rounded-ws-sm border border-ws-line-strong bg-ws-navy-deep px-ws-3 py-ws-2 font-mono text-ws-sm text-ws-text"
                      />
                      <button
                        type="button" aria-label={`Remove row ${i + 1}`}
                        onClick={() => setEntries((rows) => (rows.length === 1 ? [{ crew_id: '', watch_date: '' }] : rows.filter((_, j) => j !== i)))}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEntries((rows) => [...rows, { crew_id: '', watch_date: '' }])}
                    className="flex items-center gap-ws-2 rounded-ws-sm px-ws-2 py-ws-1 text-ws-sm text-ws-text-muted transition-colors hover:text-ws-text"
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add another watch
                  </button>
                  <p className="pt-ws-2 text-ws-xs text-ws-text-faint">
                    Someone who has left the vessel is still listed here, so their watches stay on the record.
                    Add them under Settings → Crew if they are missing.
                  </p>
                </div>
              ) : (
                <div className="space-y-ws-3">
                  <p className="text-ws-sm text-ws-text-muted">
                    One row per watch, with a <span className="font-mono text-ws-text">date</span> column and a{' '}
                    <span className="font-mono text-ws-text">crew</span> column. Dates as YYYY-MM-DD.
                  </p>
                  <button type="button" onClick={downloadTemplate} className="text-ws-sm text-ws-gold underline underline-offset-2 hover:text-ws-gold-bright">
                    Download a template
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                  <button
                    type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                    className="flex w-full items-center justify-center gap-ws-2 rounded-ws-sm border border-dashed border-ws-line-strong px-ws-4 py-ws-5 text-ws-sm text-ws-text-muted transition-colors hover:border-ws-gold hover:text-ws-text disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                    Choose a CSV file
                  </button>
                </div>
              )}

              {result && (
                <div className="mt-ws-4 rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-3">
                  {result.applied ? (
                    <p className="text-ws-sm text-ws-text">
                      Recorded {result.imported} {result.imported === 1 ? 'watch' : 'watches'} for {result.crew}{' '}
                      {result.crew === 1 ? 'person' : 'people'}
                      {result.from && <> · {pretty(result.from)} – {pretty(result.to)}</>}.
                    </p>
                  ) : (
                    <p className="text-ws-sm text-ws-text-muted">Nothing was imported.</p>
                  )}
                  {!!result.unmatched?.length && (
                    <p className="mt-ws-2 flex items-start gap-ws-2 text-ws-xs text-ws-warn">
                      <AlertTriangle className="mt-ws-1 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                      <span>Not matched to anyone on your crew list: {result.unmatched.join(', ')}. Add them under Settings → Crew, then import again.</span>
                    </p>
                  )}
                  {!!result.rejected?.length && (
                    <p className="mt-ws-2 text-ws-xs text-ws-text-muted">Skipped {result.rejected.length} {result.rejected.length === 1 ? 'row' : 'rows'}: {result.rejected.slice(0, 3).join('; ')}{result.rejected.length > 3 ? '…' : ''}</p>
                  )}
                  {!!result.errors?.length && (
                    <ul className="mt-ws-2 space-y-ws-1 text-ws-xs text-ws-warn">
                      {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}
            </div>

            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={close} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text transition-all hover:bg-ws-steel-3">
                {result?.applied ? 'Done' : 'Cancel'}
              </button>
              {mode === 'manual' && (
                <button
                  type="button" onClick={submitManual} disabled={busy || !ready.length}
                  className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {busy ? 'Recording…' : `Record ${ready.length || ''} ${ready.length === 1 ? 'watch' : 'watches'}`.trim()}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
