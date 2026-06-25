// CrewRow — one crew member in the settings CrewManager (frontend.md §4.6).
// Inline edit (name/position/department), the "not eligible for watch" toggle
// (with reason), and delete (destructive, confirmed). Ineligible crew stay in
// the list (status dot + label) but are excluded from the next generation's pool.
import { useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import type { Database } from '../../types/db'

type Reason = Database['public']['Enums']['ineligibility_reason']
export type CrewMember = Pick<Database['public']['Tables']['crew_members']['Row'], 'id' | 'full_name' | 'position' | 'department' | 'eligible' | 'ineligible_reason' | 'ineligible_note'>
export type CrewPatch = Partial<Pick<CrewMember, 'full_name' | 'position' | 'department' | 'eligible' | 'ineligible_reason' | 'ineligible_note'>>

const DEPT_LABEL: Record<Department, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }
const REASON_LABEL: Record<Reason, string> = { leave: 'On leave', sick: 'Sick', training: 'Training / junior', role_exempt: 'Role exempt', other: 'Other' }
const REASONS = Object.keys(REASON_LABEL) as Reason[]

export function CrewRow({ member, onSave, onDelete, busy }: { member: CrewMember; onSave: (id: string, patch: CrewPatch) => void; onDelete: (id: string) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.full_name)
  const [position, setPosition] = useState(member.position)
  const [department, setDepartment] = useState<Department>(member.department)
  const [confirmDel, setConfirmDel] = useState(false)
  const [markingIneligible, setMarkingIneligible] = useState(false)
  const [reason, setReason] = useState<Reason>(member.ineligible_reason ?? 'leave')
  const [note, setNote] = useState(member.ineligible_note ?? '')

  function saveEdit() {
    onSave(member.id, { full_name: name.trim(), position: position.trim(), department })
    setEditing(false)
  }

  return (
    <div className="rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3">
      {editing ? (
        <div className="flex flex-wrap items-center gap-ws-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="flex-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
          <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Position" className="flex-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
          <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} className="rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
          </select>
          <button type="button" onClick={saveEdit} disabled={busy || !name.trim() || !position.trim()} aria-label="Save" className="flex h-10 w-10 items-center justify-center rounded-ws-sm bg-ws-gold text-ws-text-on-gold hover:bg-ws-gold-bright disabled:bg-ws-steel-3"><Check className="h-4 w-4" aria-hidden /></button>
          <button type="button" onClick={() => { setEditing(false); setName(member.full_name); setPosition(member.position); setDepartment(member.department) }} aria-label="Cancel" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-ws-3">
          <div className="flex min-w-0 items-center gap-ws-3">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-ws-full ${member.eligible ? 'bg-ws-seagreen' : 'bg-ws-text-faint'}`} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-ws-sm font-medium text-ws-text">{member.full_name}</p>
              <p className="truncate text-ws-xs text-ws-text-muted">
                {member.position} · {DEPT_LABEL[member.department]}
                {!member.eligible && <span className="text-ws-text-faint"> · Not on watch{member.ineligible_reason ? ` (${REASON_LABEL[member.ineligible_reason]})` : ''}</span>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-ws-1">
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"><Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
            <button type="button" onClick={() => setConfirmDel(true)} aria-label="Delete" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-alert"><Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
          </div>
        </div>
      )}

      {/* eligibility control */}
      {!editing && (
        <div className="mt-ws-3 border-t border-ws-line pt-ws-3">
          {member.eligible ? (
            markingIneligible ? (
              <div className="flex flex-wrap items-end gap-ws-2">
                <label className="text-ws-xs text-ws-text-muted">Reason
                  <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className="mt-ws-1 block rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
                    {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                  </select>
                </label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="flex-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
                <button type="button" onClick={() => { onSave(member.id, { eligible: false, ineligible_reason: reason, ineligible_note: note.trim() || null }); setMarkingIneligible(false) }} className="rounded-ws-sm bg-ws-gold px-ws-3 py-ws-1 text-ws-sm font-semibold text-ws-text-on-gold hover:bg-ws-gold-bright">Confirm</button>
                <button type="button" onClick={() => setMarkingIneligible(false)} className="rounded-ws-sm px-ws-2 py-ws-1 text-ws-sm text-ws-text-muted hover:text-ws-text">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setMarkingIneligible(true)} className="text-ws-xs font-medium text-ws-text-muted hover:text-ws-alert">Mark not eligible for watch</button>
            )
          ) : (
            <button type="button" onClick={() => onSave(member.id, { eligible: true, ineligible_reason: null, ineligible_note: null })} className="text-ws-xs font-medium text-ws-gold hover:text-ws-gold-bright">Mark eligible for watch</button>
          )}
        </div>
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Remove {member.full_name}?</h3>
            <p className="mt-ws-2 text-ws-sm text-ws-text-muted">This deletes the crew member. (A member who already has watch assignments can't be deleted — mark them not eligible instead.)</p>
            <div className="mt-ws-5 flex justify-end gap-ws-3">
              <button type="button" onClick={() => setConfirmDel(false)} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text hover:bg-ws-steel-3">Cancel</button>
              <button type="button" onClick={() => { onDelete(member.id); setConfirmDel(false) }} className="rounded-ws-sm border border-ws-alert px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-alert hover:bg-ws-alert hover:text-ws-offwhite">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
