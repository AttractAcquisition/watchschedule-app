// CharterManager (B7) — captain-managed charter periods on /settings. A charter
// PAUSES the watch rotation for its date range; the schedule resumes afterward from
// the correct crew (an emergent property of the unchanged fairness ledger — no
// burden accrues while paused). Client-RW, vessel-scoped (the crew_members RLS
// pattern — a charter is configuration INPUT, not server output). Soft-cancel keeps
// history (status 'cancelled' is retained but does NOT affect generation). Changes
// apply on the next regeneration. Tokens only.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { CalendarClock, Loader2, Plus, Trash2, Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import type { Database } from '../../types/db'

type Charter = Pick<Database['public']['Tables']['charter_periods']['Row'], 'id' | 'start_date' | 'end_date' | 'label' | 'status'>
const fmt = (d: string) => format(parseISO(d), 'd MMM yyyy')

export function CharterManager() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const qc = useQueryClient()
  const key = ['charters', vesselId]

  const { data: charters, isLoading } = useQuery({
    queryKey: key,
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('charter_periods').select('id,start_date,end_date,label,status').eq('vessel_id', vesselId!).order('start_date')
      if (error) throw error
      return data as Charter[]
    },
  })

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  // invalidate both the settings list and the dashboard (calendar Paused state)
  const invalidate = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['dashboard', vesselId] }) }

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('charter_periods').insert({ vessel_id: vesselId!, start_date: start, end_date: end, label: label.trim() || null })
      if (error) throw error
    },
    onSuccess: () => { setStart(''); setEnd(''); setLabel(''); setError(null); invalidate() },
    onError: () => setError('Could not add the charter.'),
  })
  const cancelM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('charter_periods').update({ status: 'cancelled' }).eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not cancel the charter.'),
  })
  const restoreM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('charter_periods').update({ status: 'booked' }).eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not restore the charter.'),
  })
  const deleteM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('charter_periods').delete().eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not delete the charter.'),
  })

  const busy = addM.isPending || cancelM.isPending || restoreM.isPending || deleteM.isPending
  const canAdd = !!start && !!end && end >= start

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      <div className="flex items-center gap-ws-2">
        <CalendarClock className="h-4 w-4 text-ws-gold" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="ws-eyebrow">— Charters</p>
          <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Charter mode</h2>
        </div>
      </div>
      <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Pause the watch rotation for a charter. The schedule resumes from the right crew afterward — fairness is preserved. Changes apply when you regenerate.</p>

      {/* add */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (canAdd) addM.mutate() }}
        className="mt-ws-4 flex flex-wrap items-end gap-ws-2 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3"
      >
        <div>
          <label className="block text-ws-xs text-ws-text-muted">Start</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-ws-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
        </div>
        <div>
          <label className="block text-ws-xs text-ws-text-muted">End</label>
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="mt-ws-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="block text-ws-xs text-ws-text-muted">Label (optional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Caribbean charter" className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" />
        </div>
        <button type="submit" disabled={busy || !canAdd} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
          {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Add charter
        </button>
      </form>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}

      {/* list */}
      <div className="mt-ws-4 space-y-ws-2">
        {isLoading ? (
          <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading charters…</p>
        ) : charters && charters.length > 0 ? (
          charters.map((c) => {
            const cancelled = c.status === 'cancelled'
            return (
              <div key={c.id} className={`flex flex-wrap items-center justify-between gap-ws-3 rounded-ws-sm border border-ws-line bg-ws-steel-2 px-ws-4 py-ws-3 ${cancelled ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <p className="flex items-center gap-ws-2 text-ws-sm font-medium text-ws-text">
                    <span className="font-mono">{fmt(c.start_date)} – {fmt(c.end_date)}</span>
                    {cancelled && <span className="rounded-ws-full border border-ws-line-strong px-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Cancelled</span>}
                  </p>
                  {c.label && <p className="mt-ws-1 truncate text-ws-xs text-ws-text-muted">{c.label}</p>}
                </div>
                <div className="flex items-center gap-ws-2">
                  {cancelled ? (
                    <button type="button" disabled={busy} onClick={() => restoreM.mutate(c.id)} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-1 text-ws-sm text-ws-text-muted hover:border-ws-gold hover:text-ws-text">
                      <Undo2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Restore
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => cancelM.mutate(c.id)} className="rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-1 text-ws-sm text-ws-text-muted hover:border-ws-gold hover:text-ws-text">
                      Cancel
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => deleteM.mutate(c.id)} aria-label="Delete charter" className="rounded-ws-sm p-ws-1 text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-alert">
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <p className="text-ws-sm text-ws-text-faint">No charters. Add one to pause the rotation for a charter period.</p>
        )}
      </div>
    </section>
  )
}
