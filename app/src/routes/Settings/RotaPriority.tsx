// RotaPriority (docs/fairness.md §7, 28 Nov 2026) — Settings → Watch
// configuration → Advanced. "Who takes the extra watch".
//
// Tester feedback: "choose who to favour on the fairness calculator — assign the
// greenest crew to the least fair slot, or assign the least fair to me". Watches
// rarely divide evenly; when the engine rates crew as equally owed it needs an
// order, and until now that order was the crew members' internal ids (the
// numeric rotation anchors only rotated a list the captain could not see).
//
// The order is stored as watch_settings.rota_priority and written through the
// set_rota_priority RPC (watch_settings is SELECT-only for the client). Saving
// bumps watch_settings.updated_at, so the dashboard's "settings changed" notice
// prompts a regeneration. The copy promises only what the engine measurably
// does: first in the list carries the extra; it never overrides fairness.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronsUp, ListOrdered, Loader2, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { InfoTooltip } from '../../components/ui/InfoTooltip'
import { Toast } from '../../components/ui/Toast'

const HELP =
  'Watches rarely divide evenly — 31 days across 6 crew leaves one over, and the same happens with weekends and Fridays. When the fairness engine rates crew as equally due a watch, the person higher in this list is picked first, so they carry the extra and the person at the bottom is spared it. It never overrides fairness: nobody is given a watch while someone else is owed one, and over a season the gap stays within what the engine already allows (a watch or two).'

type CrewRow = { id: string; full_name: string; position: string | null; eligible: boolean }

/** The order shown: saved ids still aboard first, then everyone else alphabetically. */
export function displayOrder(saved: string[], crew: CrewRow[]) {
  const byId = new Map(crew.map((c) => [c.id, c]))
  const listed = saved.filter((id, i) => byId.has(id) && saved.indexOf(id) === i)
  const rest = crew.filter((c) => !listed.includes(c.id)).sort((a, b) => a.full_name.localeCompare(b.full_name)).map((c) => c.id)
  return { order: [...listed, ...rest], unplaced: saved.length ? new Set(rest) : new Set<string>() }
}

export function RotaPriority() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const qc = useQueryClient()
  const key = useMemo(() => ['rota_priority', vesselId], [vesselId])

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: key,
    enabled: !!vesselId,
    queryFn: async () => {
      const [settings, crew] = await Promise.all([
        supabase.from('watch_settings').select('rota_priority').eq('vessel_id', vesselId!).maybeSingle(),
        supabase.from('crew_members').select('id,full_name,position,eligible').eq('vessel_id', vesselId!).order('full_name'),
      ])
      if (settings.error) throw settings.error
      if (crew.error) throw crew.error
      return { saved: (settings.data?.rota_priority ?? []) as string[], crew: (crew.data ?? []) as CrewRow[] }
    },
  })

  const initial = useMemo(() => (data ? displayOrder(data.saved, data.crew) : { order: [], unplaced: new Set<string>() }), [data])
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => { setOrder(initial.order) }, [initial])
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])

  const isSet = (data?.saved.length ?? 0) > 0
  const dirty = order.join() !== initial.order.join()
  const crewById = useMemo(() => new Map((data?.crew ?? []).map((c) => [c.id, c])), [data])
  // "First" and "spared" describe who is actually on the watch bill.
  const onBill = order.filter((id) => crewById.get(id)?.eligible)

  const save = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await supabase.rpc('set_rota_priority', { p_order: next })
      if (error) throw error
    },
    onSuccess: (_, next) => {
      setError(null)
      setToast(next.length ? `Order saved — ${crewById.get(next[0])?.full_name ?? 'the first crew member'} takes the extra watch first. Regenerate to apply it.` : 'Order cleared. Regenerate to apply it.')
      qc.invalidateQueries({ queryKey: key })
      for (const k of ['watch_configuration', 'dashboard']) qc.invalidateQueries({ queryKey: [k, vesselId] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the order.'),
  })

  const move = (from: number, to: number) => setOrder((o) => {
    if (to < 0 || to >= o.length) return o
    const next = [...o]
    const [id] = next.splice(from, 1)
    next.splice(to, 0, id)
    return next
  })

  if (loadError) return <p role="alert" className="text-ws-sm text-ws-alert">Could not load the crew order.</p>

  return (
    <div>
      <div className="flex items-center gap-ws-2">
        <ListOrdered className="h-4 w-4 text-ws-gold" strokeWidth={1.5} aria-hidden />
        <p className="text-ws-sm font-medium text-ws-text">Who takes the extra watch</p>
        <InfoTooltip text={HELP} label="About who takes the extra watch" />
        {!isSet && data && <span className="rounded-ws-full border border-ws-line-strong px-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Not set</span>}
      </div>
      <p className="mt-ws-1 text-ws-xs text-ws-text-muted">
        Top of the list carries the extra watch, weekend or Friday when they don't divide evenly; the bottom is spared it.
        Fairness still comes first. Put a junior crew member — or yourself — at the top.
      </p>

      {isLoading ? (
        <p className="mt-ws-3 flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading crew…</p>
      ) : (
        <ol className="mt-ws-3 space-y-px" aria-label="Who takes the extra watch, first to last">
          {order.map((id, i) => {
            const c = crewById.get(id)
            if (!c) return null
            const last = i === order.length - 1
            return (
              <li key={id} className={`flex items-center gap-ws-2 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 ${c.eligible ? '' : 'opacity-60'}`}>
                <span className="w-6 shrink-0 text-right font-mono text-ws-xs text-ws-text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ws-sm text-ws-text">{c.full_name}</span>
                  <span className="block break-words text-ws-xs text-ws-text-faint">
                    {[c.position, !c.eligible && 'off the watch bill', initial.unplaced.has(id) && 'new — not placed yet', id === onBill[0] && 'takes the extra first', onBill.length > 1 && id === onBill[onBill.length - 1] && 'spared first'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  <button type="button" onClick={() => move(i, 0)} disabled={i === 0} aria-label={`Move ${c.full_name} to the top`} title="Move to top" className="flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-2 hover:text-ws-text disabled:opacity-30"><ChevronsUp className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${c.full_name} up`} title="Move up" className="flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-2 hover:text-ws-text disabled:opacity-30"><ArrowUp className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={last} aria-label={`Move ${c.full_name} down`} title="Move down" className="flex h-8 w-8 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-2 hover:text-ws-text disabled:opacity-30"><ArrowDown className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
                </span>
              </li>
            )
          })}
        </ol>
      )}

      {error && <p role="alert" className="mt-ws-2 text-ws-sm text-ws-alert">{error}</p>}
      <div className="mt-ws-3 flex flex-wrap items-center gap-ws-2">
        <button
          type="button"
          onClick={() => save.mutate(order)}
          disabled={save.isPending || !order.length || (isSet && !dirty && initial.unplaced.size === 0)}
          className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint"
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {isSet ? 'Save order' : 'Use this order'}
        </button>
        {isSet && (
          <button type="button" onClick={() => save.mutate([])} disabled={save.isPending} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-2 text-ws-sm text-ws-text-muted hover:border-ws-gold hover:text-ws-text">
            <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Clear order
          </button>
        )}
        {dirty && <span className="text-ws-xs text-ws-warn">Unsaved changes</span>}
      </div>
      {toast && <Toast message={toast} onDismiss={dismissToast} duration={5000} />}
    </div>
  )
}
