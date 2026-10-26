// CrewManager — crew CRUD on /settings (frontend.md §4.6). Lists crew, adds
// via a focused add-crew modal (manual entry or crew-list image), edits, deletes,
// and toggles eligibility.
// All writes are RLS-scoped to the vessel. Changes take effect on the next
// regeneration — stated explicitly in the UI.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { CrewRow, type CrewMember, type CrewPatch } from './CrewRow'
import { CrewUploadModal } from './CrewUploadModal'

const crewNameOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function CrewManager() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const qc = useQueryClient()
  const key = ['settings_crew', vesselId]

  const { data: crew, isLoading } = useQuery({
    queryKey: key,
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('crew_members').select('id,full_name,position,department,eligible,ineligible_reason,ineligible_note,available_from').eq('vessel_id', vesselId!).order('full_name')
      if (error) throw error
      // Keep the roster consistently alphabetical after every refetch, including
      // immediately after adding crew through either modal path.
      return [...(data as CrewMember[])].sort((a, b) => crewNameOrder.compare(a.full_name, b.full_name))
    },
  })

  const [error, setError] = useState<string | null>(null)
  const [addCrewOpen, setAddCrewOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const updateM = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: CrewPatch }) => { const { error } = await supabase.from('crew_members').update(patch).eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not save changes.'),
  })
  const deleteM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('crew_members').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { setError(null); invalidate() },
    onError: () => setError("Couldn't permanently delete this crew member. Please try again."),
  })

  const busy = updateM.isPending || deleteM.isPending

  return (
    <section className="rounded-ws-md border border-ws-line bg-ws-steel p-ws-5 shadow-ws-md">
      <div className="flex items-center justify-between">
        <div>
          <p className="ws-eyebrow">— Crew</p>
          <h2 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Crew management</h2>
        </div>
        <div className="flex items-center gap-ws-3">
          <button
            type="button"
            onClick={() => setAddCrewOpen(true)}
            className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright"
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add crew
          </button>
          <span className="font-mono text-ws-xs text-ws-text-faint">{crew?.length ?? 0} crew</span>
        </div>
      </div>

      {addCrewOpen && vesselId && (
        <CrewUploadModal vesselId={vesselId} onClose={() => setAddCrewOpen(false)} onAdded={invalidate} />
      )}
      <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Changes apply when you regenerate the schedule.</p>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}

      {/* roster */}
      <div className="mt-ws-4 overflow-x-auto rounded-ws-sm border border-ws-line">
        {isLoading ? (
          <p className="flex items-center gap-ws-2 p-ws-4 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading crew…</p>
        ) : crew && crew.length > 0 ? (
          <table className="w-full min-w-[48rem] border-collapse text-ws-sm">
            <thead className="bg-ws-steel-3 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">
              <tr>
                <th className="px-ws-3 py-ws-2 font-medium">Crew member</th>
                <th className="px-ws-3 py-ws-2 font-medium">Position</th>
                <th className="px-ws-3 py-ws-2 font-medium">Department</th>
                <th className="px-ws-3 py-ws-2 font-medium">Watch status</th>
                <th className="px-ws-3 py-ws-2 font-medium">Available from</th>
                <th className="w-24 px-ws-3 py-ws-2 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {crew.map((m) => <CrewRow key={m.id} member={m} busy={busy} onSave={(id, patch) => updateM.mutate({ id, patch })} onDelete={(id) => deleteM.mutate(id)} />)}
            </tbody>
          </table>
        ) : (
          <p className="p-ws-4 text-ws-sm text-ws-text-faint">No crew yet.</p>
        )}
      </div>
    </section>
  )
}
