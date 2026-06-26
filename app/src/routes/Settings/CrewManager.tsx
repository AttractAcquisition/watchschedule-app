// CrewManager — crew CRUD on /settings (frontend.md §4.6). Lists crew, adds
// (name + position -> auto department via the SAME classifyDepartment helper as
// onboarding Step 1, override allowed), edits, deletes, and toggles eligibility.
// All writes are RLS-scoped to the vessel. Changes take effect on the next
// regeneration — stated explicitly in the UI.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Loader2, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { classifyDepartment, DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import { CrewRow, type CrewMember, type CrewPatch } from './CrewRow'
import { CrewUploadModal } from './CrewUploadModal'

const DEPT_LABEL: Record<Department, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }

export function CrewManager() {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const qc = useQueryClient()
  const key = ['settings_crew', vesselId]

  const { data: crew, isLoading } = useQuery({
    queryKey: key,
    enabled: !!vesselId,
    queryFn: async () => {
      const { data, error } = await supabase.from('crew_members').select('id,full_name,position,department,eligible,ineligible_reason,ineligible_note').eq('vessel_id', vesselId!).order('full_name')
      if (error) throw error
      return data as CrewMember[]
    },
  })

  // add form
  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [department, setDepartment] = useState<Department>('deck')
  const [deptTouched, setDeptTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  function onPosition(v: string) {
    setPosition(v)
    if (!deptTouched) setDepartment(classifyDepartment(v))
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('crew_members').insert({ vessel_id: vesselId!, full_name: name.trim(), position: position.trim(), department })
      if (error) throw error
    },
    onSuccess: () => { setName(''); setPosition(''); setDepartment('deck'); setDeptTouched(false); setError(null); invalidate() },
    onError: () => setError('Could not add crew member.'),
  })
  const updateM = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: CrewPatch }) => { const { error } = await supabase.from('crew_members').update(patch).eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError('Could not save changes.'),
  })
  const deleteM = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('crew_members').delete().eq('id', id); if (error) throw error },
    onSuccess: invalidate, onError: () => setError("Couldn't delete (a crew member with watch assignments can't be removed — mark them not eligible instead)."),
  })

  const busy = addM.isPending || updateM.isPending || deleteM.isPending

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
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-3 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3"
          >
            <Camera className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Upload / photo
          </button>
          <span className="font-mono text-ws-xs text-ws-text-faint">{crew?.length ?? 0} crew</span>
        </div>
      </div>

      {uploadOpen && vesselId && (
        <CrewUploadModal vesselId={vesselId} onClose={() => setUploadOpen(false)} onAdded={invalidate} />
      )}
      <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Changes apply when you regenerate the schedule.</p>

      {/* add */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim() && position.trim()) addM.mutate() }}
        className="mt-ws-4 flex flex-wrap items-end gap-ws-2 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3"
      >
        <div className="flex-1">
          <label className="block text-ws-xs text-ws-text-muted">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="A. Mason" className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="block text-ws-xs text-ws-text-muted">Position</label>
          <input value={position} onChange={(e) => onPosition(e.target.value)} placeholder="Chief Officer" className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" />
        </div>
        <div>
          <label className="block text-ws-xs text-ws-text-muted">Department</label>
          <select value={department} onChange={(e) => { setDepartment(e.target.value as Department); setDeptTouched(true) }} className="mt-ws-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy || !name.trim() || !position.trim()} className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
          {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Add
        </button>
      </form>

      {error && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{error}</p>}

      {/* list */}
      <div className="mt-ws-4 space-y-ws-2">
        {isLoading ? (
          <p className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading crew…</p>
        ) : crew && crew.length > 0 ? (
          crew.map((m) => <CrewRow key={m.id} member={m} busy={busy} onSave={(id, patch) => updateM.mutate({ id, patch })} onDelete={(id) => deleteM.mutate(id)} />)
        ) : (
          <p className="text-ws-sm text-ws-text-faint">No crew yet.</p>
        )}
      </div>
    </section>
  )
}
