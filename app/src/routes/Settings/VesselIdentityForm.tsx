// Vessel identity is account data: it controls the name in the top bar and on
// shared/exported schedules, but it does not change rota configuration.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Pencil, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'

export function VesselIdentityForm() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)

  const { data: vessel, isLoading } = useQuery({
    queryKey: ['vessel', vesselId],
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('vessels').select('name').eq('id', vesselId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
  useEffect(() => { if (vessel?.name != null) setName(vessel.name) }, [vessel])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!vesselId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const { error } = await supabase.from('vessels').update({ name: name.trim() }).eq('id', vesselId)
      if (error) throw error
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vessel', vesselId] }),
        queryClient.invalidateQueries({ queryKey: ['vessel-name', vesselId] }),
      ])
      setSaved(true)
      setEditing(false)
    } catch {
      setError('Could not save the vessel name.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-4 shadow-ws-md">
      <div className="flex items-start justify-between gap-ws-3"><div><p className="ws-eyebrow">— Vessel</p><h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Vessel identity</h2></div><button type="button" onClick={() => { setEditing(true); setSaved(false) }} className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-2 text-ws-sm text-ws-text hover:border-ws-gold hover:bg-ws-steel-3"><Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Edit</button></div>
      {isLoading ? <p className="mt-ws-4 flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading vessel…</p> : <div className="mt-ws-4"><p className="text-ws-xs text-ws-text-muted">Vessel name</p><p className="mt-ws-1 text-ws-base text-ws-text">{name || 'Not set'}</p><p className="mt-ws-1 text-ws-xs text-ws-text-faint">Used in the top bar and on shared schedules.</p></div>}
      {saved && <p role="status" className="mt-ws-3 text-ws-sm text-ws-ok">Vessel name saved.</p>}
      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-label="Edit vessel identity"><form onSubmit={save} className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-5 shadow-ws-lg"><div className="flex items-center justify-between"><h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Edit vessel identity</h3><button type="button" onClick={() => setEditing(false)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3"><X className="h-4 w-4" aria-hidden /></button></div><label htmlFor="vessel_name" className="mt-ws-4 block text-ws-xs text-ws-text-muted">Vessel name<input id="vessel_name" type="text" value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} placeholder="M/Y Serenity" maxLength={120} required className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-text focus:border-ws-gold focus:outline-none" /></label>{error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}<div className="mt-ws-5 flex justify-end"><button type="submit" disabled={saving} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save vessel name</button></div></form></div>}
    </section>
  )
}
