// LeaveManager (C3) — captain-managed DATED per-crew leave in /settings. Leave is
// Charter Mode scoped to one crew member: their booked leave dates are removed from
// THEIR opportunity denominator (standing preserved) and they aren't scheduled then;
// the watch goes to an available crew member. Client-RW, vessel-scoped (the
// crew_members/charter_periods pattern). Soft-cancel ('cancelled' retained but
// ignored by generation). Distinct from the eligibility toggle, which is a blanket
// "unavailable for the next generation" (all dates); leave is dated periods.
// Changes apply on the next regeneration. Tokens only.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { CalendarOff, Loader2, Plus, Trash2, Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import type { Database } from '../../types/db'

type Leave = Pick<Database['public']['Tables']['crew_leave']['Row'], 'id' | 'crew_member_id' | 'start_date' | 'end_date' | 'label' | 'status'>
type Crew = { id: string; full_name: string }
const fmt = (d: string) => format(parseISO(d), 'd MMM yyyy')

export function LeaveManager() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const qc = useQueryClient()
  const leaveKey = ['crew_leave', vesselId]

  const { data: crew } = useQuery({
    queryKey: ['leave_crew', vesselId],
    enabled: !!vesselId,
    queryFn: async () => (await supabase.from('crew_members').select('id,full_name').eq('vessel_id', vesselId!).order('full_name')).data as Crew[],
  })
  const { data: leave, isLoading } = useQuery({
    queryKey: leaveKey,
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('crew_leave').select('id,crew_member_id,start_date,end_date,label,status').eq('vessel_id', vesselId!).order('start_date')
      if (error) throw error
      return data as Leave[]
    },
  })

  const [crewId, setCrewId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const crewName = (id: string) => crew?.find((c) => c.id === id)?.full_name ?? 'crew'
  const invalidate = () => { qc.invalidateQueries({ queryKey: leaveKey }); qc.invalidateQueries({ queryKey: ['dashboard', vesselId] }) }

  const addM = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('crew_leave').insert({ vessel_id: vesselId!, crew_member_id: crewId, start_date: start, end_date: end }); if (error) throw error },
    onSuccess: () => { setStart(''); setEnd(''); setError(null); invalidate() },
    onError: () => setError('Could not add the leave.'),
  })
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'booked' | 'cancelled' }) => { const { error } = await supabase.from('crew_leave').update({ status }).eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not update the leave.'),
  })
  const deleteM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('crew_leave').delete().eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not delete the leave.'),
  })
  const busy = addM.isPending || setStatus.isPending || deleteM.isPending
  const canAdd = !!crewId && !!start && !!end && end >= start

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      <div className="flex items-center gap-ws-2">
        <CalendarOff className="h-4 w-4 text-ws-gold" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="ws-eyebrow">— Leave</p>
          <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Crew leave</h2>
        </div>
      </div>
      <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Book dated leave for a crew member — they won't be scheduled those days, and their fairness standing is preserved (the leave days don't count for or against them). For a blanket "off the watch bill", use the eligibility toggle instead. Applies on the next regeneration.</p>

      {/* add */}
      <form onSubmit={(e) => { e.preventDefault(); if (canAdd) addM.mutate() }} className="mt-ws-4 flex flex-wrap items-end gap-ws-2 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3">
        <div className="flex-1">
          <label className="block text-ws-xs text-ws-text-muted">Crew member</label>
          <select value={crewId} onChange={(e) => setCrewId(e.target.value)} className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
            <option value="">Select…</option>
            {(crew ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-ws-xs text-ws-text-muted">From</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-ws-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
        </div>
        <div>
          <label className="block text-ws-xs text-ws-text-muted">To</label>
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="mt-ws-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
        </div>
        <button type="submit" disabled={busy || !canAdd} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
          {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Add leave
        </button>
      </form>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}

      <div className="mt-ws-4 space-y-ws-2">
        {isLoading ? (
          <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading leave…</p>
        ) : leave && leave.length > 0 ? (
          leave.map((l) => {
            const cancelled = l.status === 'cancelled'
            return (
              <div key={l.id} className={`flex flex-wrap items-center justify-between gap-ws-3 rounded-ws-sm border border-ws-line bg-ws-steel-2 px-ws-4 py-ws-3 ${cancelled ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <p className="flex items-center gap-ws-2 text-ws-sm font-medium text-ws-text">
                    <span>{crewName(l.crew_member_id)}</span>
                    <span className="font-mono text-ws-xs text-ws-text-muted">{fmt(l.start_date)} – {fmt(l.end_date)}</span>
                    {cancelled && <span className="rounded-ws-full border border-ws-line-strong px-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Cancelled</span>}
                  </p>
                </div>
                <div className="flex items-center gap-ws-2">
                  {cancelled ? (
                    <button type="button" disabled={busy} onClick={() => setStatus.mutate({ id: l.id, status: 'booked' })} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-1 text-ws-sm text-ws-text-muted hover:border-ws-gold hover:text-ws-text">
                      <Undo2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Restore
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setStatus.mutate({ id: l.id, status: 'cancelled' })} className="rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-1 text-ws-sm text-ws-text-muted hover:border-ws-gold hover:text-ws-text">Cancel</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => deleteM.mutate(l.id)} aria-label="Delete leave" className="rounded-ws-sm p-ws-1 text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-alert">
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <p className="text-ws-sm text-ws-text-faint">No leave booked.</p>
        )}
      </div>
    </section>
  )
}
