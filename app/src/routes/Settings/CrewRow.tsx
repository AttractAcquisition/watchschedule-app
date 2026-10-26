// CrewRow — one crew member in the settings CrewManager (frontend.md §4.6).
// Inline edit (name/position/department), the "not eligible for watch" toggle
// (with reason), and delete (destructive, confirmed). Ineligible crew stay in
// the list (status dot + label) but are excluded from the next generation's pool.
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { DEPARTMENTS, type Department } from '../../lib/classifyDepartment'
import type { Database } from '../../types/db'

type Reason = Database['public']['Enums']['ineligibility_reason']
export type CrewMember = Pick<Database['public']['Tables']['crew_members']['Row'], 'id' | 'full_name' | 'position' | 'department' | 'eligible' | 'ineligible_reason' | 'ineligible_note' | 'available_from'>
export type CrewPatch = Partial<Pick<CrewMember, 'full_name' | 'position' | 'department' | 'eligible' | 'ineligible_reason' | 'ineligible_note' | 'available_from'>>

const DEPT_LABEL: Record<Department, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }
const REASON_LABEL: Record<Reason, string> = { leave: 'On leave', sick: 'Sick', training: 'Training / junior', role_exempt: 'Role exempt', other: 'Other' }
const REASONS = Object.keys(REASON_LABEL) as Reason[]

export function CrewRow({ member, onSave, onDelete, busy }: { member: CrewMember; onSave: (id: string, patch: CrewPatch) => void; onDelete: (id: string) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.full_name)
  const [position, setPosition] = useState(member.position)
  const [department, setDepartment] = useState<Department>(member.department)
  const [availFrom, setAvailFrom] = useState(member.available_from)
  const [eligible, setEligible] = useState(member.eligible)
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmHardDelete, setConfirmHardDelete] = useState(false)
  const [markingIneligible, setMarkingIneligible] = useState(false)
  const [reason, setReason] = useState<Reason>(member.ineligible_reason ?? 'leave')
  const [note, setNote] = useState(member.ineligible_note ?? '')

  function saveEdit() {
    onSave(member.id, {
      full_name: name.trim(), position: position.trim(), department, available_from: availFrom,
      eligible,
      ineligible_reason: eligible ? null : reason,
      ineligible_note: eligible ? null : note.trim() || null,
    })
    setEditing(false)
  }

  return (
    <>
      {editing ? (
        <tr className="border-t border-ws-line bg-ws-steel-2">
          <td colSpan={6} className="p-ws-3">
            <div className="flex flex-wrap items-end gap-ws-2">
              <label className="flex-1 text-ws-xs text-ws-text-muted">Full name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
              </label>
              <label className="flex-1 text-ws-xs text-ws-text-muted">Position
                <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Position" className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
              </label>
              <label className="text-ws-xs text-ws-text-muted">Department
                <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} className="mt-ws-1 block rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
                </select>
              </label>
              <label className="text-ws-xs text-ws-text-muted">Available from
                <input type="date" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} className="mt-ws-1 block rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
              </label>
              <label className="text-ws-xs text-ws-text-muted">Watch eligibility
                <select value={eligible ? 'eligible' : 'ineligible'} onChange={(e) => setEligible(e.target.value === 'eligible')} className="mt-ws-1 block rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
                  <option value="eligible">Included in rotation</option>
                  <option value="ineligible">Not on watch</option>
                </select>
              </label>
              {!eligible && <label className="text-ws-xs text-ws-text-muted">Reason
                <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className="mt-ws-1 block rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
                  {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                </select>
              </label>}
              {!eligible && <label className="min-w-48 flex-1 text-ws-xs text-ws-text-muted">Note <span className="text-ws-text-faint">(optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
              </label>}
              <button type="button" onClick={saveEdit} disabled={busy || !name.trim() || !position.trim()} aria-label="Save" className="flex h-10 w-10 items-center justify-center rounded-ws-sm bg-ws-gold text-ws-text-on-gold hover:bg-ws-gold-bright disabled:bg-ws-steel-3"><Check className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => { setEditing(false); setName(member.full_name); setPosition(member.position); setDepartment(member.department); setAvailFrom(member.available_from); setEligible(member.eligible); setReason(member.ineligible_reason ?? 'leave'); setNote(member.ineligible_note ?? '') }} aria-label="Cancel" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text"><X className="h-4 w-4" aria-hidden /></button>
            </div>
          </td>
        </tr>
      ) : (
        <>
          <tr className="border-t border-ws-line bg-ws-steel-2 transition-colors hover:bg-ws-steel-3">
            <td className="px-ws-3 py-ws-3"><div className="flex items-center gap-ws-2"><span className={`inline-block h-2 w-2 shrink-0 rounded-ws-full ${member.eligible ? 'bg-ws-seagreen' : 'bg-ws-text-faint'}`} aria-hidden /><span className="font-medium text-ws-text">{member.full_name}</span></div></td>
            <td className="px-ws-3 py-ws-3 text-ws-text-muted">{member.position}</td>
            <td className="px-ws-3 py-ws-3 text-ws-text-muted">{DEPT_LABEL[member.department]}</td>
            <td className="px-ws-3 py-ws-3">
              {member.eligible ? (
                <button type="button" onClick={() => setMarkingIneligible(true)} aria-label={`Change watch eligibility for ${member.full_name}`} title="Change watch eligibility" className="text-ws-xs font-medium text-ws-seagreen transition-colors hover:text-ws-gold">On watch</button>
              ) : (
                <button type="button" onClick={() => onSave(member.id, { eligible: true, ineligible_reason: null, ineligible_note: null })} aria-label={`Mark ${member.full_name} as on watch`} title="Mark as on watch" className="text-ws-xs text-ws-text-muted transition-colors hover:text-ws-gold">Off watch{member.ineligible_reason ? ` · ${REASON_LABEL[member.ineligible_reason]}` : ''}</button>
              )}
            </td>
            <td className="px-ws-3 py-ws-3 font-mono text-ws-xs text-ws-text-muted">{format(parseISO(member.available_from), 'd MMM yyyy')}</td>
            <td className="px-ws-3 py-ws-2"><div className="flex justify-end gap-ws-1"><button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${member.full_name}`} className="flex h-9 w-9 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-2 hover:text-ws-text"><Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button><button type="button" onClick={() => setConfirmDel(true)} aria-label={`Delete ${member.full_name}`} className="flex h-9 w-9 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-2 hover:text-ws-alert"><Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button></div></td>
          </tr>
          {markingIneligible && (
            <tr className="border-t border-ws-line bg-ws-steel-inset">
              <td colSpan={6} className="p-ws-3">
                <div className="flex flex-wrap items-end gap-ws-2">
                  <label className="text-ws-xs text-ws-text-muted">Reason
                    <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className="mt-ws-1 block rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none">
                      {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                    </select>
                  </label>
                  <label className="min-w-56 flex-1 text-ws-xs text-ws-text-muted">Note <span className="text-ws-text-faint">(optional)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-ws-1 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none" />
                  </label>
                  <button type="button" onClick={() => { onSave(member.id, { eligible: false, ineligible_reason: reason, ineligible_note: note.trim() || null }); setMarkingIneligible(false) }} className="rounded-ws-sm bg-ws-gold px-ws-3 py-ws-2 text-ws-sm font-semibold text-ws-text-on-gold hover:bg-ws-gold-bright">Confirm</button>
                  <button type="button" onClick={() => setMarkingIneligible(false)} className="rounded-ws-sm px-ws-2 py-ws-2 text-ws-sm text-ws-text-muted hover:text-ws-text">Cancel</button>
                </div>
              </td>
            </tr>
          )}
        </>
      )}

      {confirmDel && !confirmHardDelete && (
        <tr><td colSpan={6} className="p-0">
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
              <h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Remove {member.full_name}?</h3>
              <p className="mt-ws-2 text-ws-sm text-ws-text-muted">You are about to permanently remove this crew member. There is one final confirmation.</p>
              <div className="mt-ws-5 flex justify-end gap-ws-3">
                <button type="button" onClick={() => setConfirmDel(false)} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text hover:bg-ws-steel-3">Cancel</button>
                <button type="button" onClick={() => setConfirmHardDelete(true)} className="rounded-ws-sm border border-ws-alert px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-alert hover:bg-ws-alert hover:text-ws-offwhite">Continue</button>
              </div>
            </div>
          </div>
        </td></tr>
      )}

      {confirmDel && confirmHardDelete && (
        <tr><td colSpan={6} className="p-0">
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="alertdialog" aria-modal="true" aria-labelledby={`hard-delete-title-${member.id}`}>
            <div className="w-full max-w-sm rounded-ws-lg border border-ws-alert bg-ws-steel-2 p-ws-6 shadow-ws-lg">
              <p className="ws-eyebrow text-ws-alert">— Permanent deletion</p>
              <h3 id={`hard-delete-title-${member.id}`} className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Are you absolutely sure?</h3>
              <p className="mt-ws-2 text-ws-sm text-ws-text-muted">This permanently deletes {member.full_name}, including their past watch assignments, fairness records, explanations, and leave records. This cannot be undone.</p>
              <div className="mt-ws-5 flex justify-end gap-ws-3">
                <button type="button" onClick={() => { setConfirmHardDelete(false); setConfirmDel(false) }} disabled={busy} className="rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm text-ws-text hover:bg-ws-steel-3 disabled:opacity-60">Keep crew member</button>
                <button type="button" onClick={() => { onDelete(member.id); setConfirmHardDelete(false); setConfirmDel(false) }} disabled={busy} className="rounded-ws-sm bg-ws-alert px-ws-4 py-ws-2 text-ws-sm font-semibold text-ws-offwhite hover:opacity-90 disabled:opacity-60">Permanently delete</button>
              </div>
            </div>
          </div>
        </td></tr>
      )}
    </>
  )
}
