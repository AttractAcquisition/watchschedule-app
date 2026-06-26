// CrewUploadModal (B2 item 5) — a SECOND mount of the proven Phase-4 crew-OCR
// capability inside /settings crew management. Upload (or take a photo of) a crew
// list → the existing `parse-crew-list` Edge Function (Claude OCR) returns
// candidates → editable review table → confirm inserts crew_members (RLS-scoped,
// appended to the vessel's crew). NO new backend, NO new function — it reuses the
// same storage bucket, path-prefix policy, and function as onboarding. Tokens only.
import { useRef, useState } from 'react'
import { Camera, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { classifyDepartment, DEPARTMENTS, type Department } from '../../lib/classifyDepartment'

const DEPT_LABEL: Record<Department, string> = { deck: 'Deck', interior: 'Interior', engineering: 'Engineering', officer: 'Officer' }

interface Row { key: string; full_name: string; position: string; department: Department; deptTouched: boolean }
const newRow = (full_name = '', position = '', department: Department = 'deck'): Row => ({ key: crypto.randomUUID(), full_name, position, department, deptTouched: false })
const extOf = (file: File) => {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type] ?? 'jpg'
}

export function CrewUploadModal({ vesselId, onClose, onAdded }: { vesselId: string; onClose: () => void; onAdded: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  function patch(key: string, next: Partial<Row>) { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r))) }
  function onPositionChange(key: string, position: string) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, position, department: r.deptTouched ? r.department : classifyDepartment(position) } : r)))
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) e.target.value = ''
    if (!file) return
    setError(null); setNotice(null); setParsing(true)
    try {
      // Same bucket + {vessel_id}/{uuid}.{ext} path-prefix policy as onboarding.
      const path = `${vesselId}/${crypto.randomUUID()}.${extOf(file)}`
      const up = await supabase.storage.from('crew-lists').upload(path, file, { contentType: file.type })
      if (up.error) throw up.error
      const { data, error } = await supabase.functions.invoke<{ crew: { full_name: string; position: string; department: Department }[] }>(
        'parse-crew-list', { body: { object_path: path } }
      )
      if (error) throw error
      const parsed = (data?.crew ?? []).map((c) => ({ ...newRow(c.full_name, c.position, c.department), deptTouched: true }))
      if (parsed.length === 0) setNotice('No crew detected in that image — add rows manually or try another photo.')
      else setNotice(`Detected ${parsed.length} crew member${parsed.length > 1 ? 's' : ''}. Review and confirm below.`)
      setRows((rs) => [...rs, ...parsed])
    } catch {
      setError("We couldn't read that crew list. You can add the crew manually below.")
    } finally {
      setParsing(false)
    }
  }

  async function onConfirm() {
    const clean = rows.map((r) => ({ ...r, full_name: r.full_name.trim(), position: r.position.trim() }))
    if (clean.length === 0) return setError('Add at least one crew member.')
    if (clean.some((r) => !r.full_name || !r.position)) return setError('Every crew member needs a name and a position.')
    setError(null); setSaving(true)
    try {
      const insert = await supabase.from('crew_members').insert(
        clean.map((r) => ({ vessel_id: vesselId, full_name: r.full_name, position: r.position, department: r.department }))
      )
      if (insert.error) throw insert.error
      onAdded()
      onClose()
    } catch {
      setError('Could not save the crew. Please try again.'); setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true" aria-label="Upload crew list">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-ws-lg border border-ws-line bg-ws-steel-2 shadow-ws-lg">
        <header className="flex items-center justify-between border-b border-ws-line px-ws-5 py-ws-3">
          <span className="font-display text-ws-md font-semibold text-ws-offwhite">Add crew from a photo</span>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </header>

        <div className="overflow-y-auto p-ws-5">
          <p className="text-ws-sm text-ws-text-muted">Upload an image of your crew list, or take a photo. We read it automatically — review every row before confirming. New crew are added to your list.</p>

          <input ref={uploadRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
          <div className="mt-ws-4 flex flex-wrap gap-ws-3">
            <button type="button" onClick={() => uploadRef.current?.click()} disabled={parsing}
              className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-60">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
              {parsing ? 'Reading crew list…' : 'Upload image'}
            </button>
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={parsing}
              className="flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-60">
              <Camera className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Take photo
            </button>
          </div>

          {error && <p role="alert" className="mt-ws-4 text-ws-sm text-ws-alert">{error}</p>}
          {notice && <p role="status" className="mt-ws-4 text-ws-sm text-ws-ok">{notice}</p>}

          {rows.length > 0 && (
            <div className="mt-ws-5 overflow-hidden rounded-ws-md border border-ws-line">
              <table className="w-full border-collapse text-ws-sm">
                <thead>
                  <tr className="bg-ws-steel-2 text-left">
                    <th className="px-ws-3 py-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Full name</th>
                    <th className="px-ws-3 py-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Position</th>
                    <th className="px-ws-3 py-ws-2 font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">Department</th>
                    <th className="w-px px-ws-3 py-ws-2" aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t border-ws-line">
                      <td className="px-ws-2 py-ws-2">
                        <input value={r.full_name} onChange={(e) => patch(r.key, { full_name: e.target.value })} placeholder="A. Mason"
                          className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" />
                      </td>
                      <td className="px-ws-2 py-ws-2">
                        <input value={r.position} onChange={(e) => onPositionChange(r.key, e.target.value)} placeholder="Chief Officer"
                          className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none" />
                      </td>
                      <td className="px-ws-2 py-ws-2">
                        <select value={r.department} onChange={(e) => patch(r.key, { department: e.target.value as Department, deptTouched: true })}
                          className="w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-2 py-ws-1 text-ws-text focus:border-ws-gold focus:outline-none">
                          {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
                        </select>
                      </td>
                      <td className="px-ws-2 py-ws-2 text-right">
                        <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.full_name || 'crew member'}`}
                          className="rounded-ws-sm p-ws-1 text-ws-text-muted transition-all hover:bg-ws-steel-3 hover:text-ws-alert">
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <div className="mt-ws-3 flex items-center justify-between">
              <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])} className="flex items-center gap-ws-2 text-ws-sm font-medium text-ws-gold hover:text-ws-gold-bright">
                <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add row
              </button>
              <span className="font-mono text-ws-xs text-ws-text-faint">{rows.length} to add</span>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-ws-3 border-t border-ws-line px-ws-5 py-ws-3">
          <button type="button" onClick={onClose} className="rounded-ws-sm px-ws-4 py-ws-2 text-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={saving || rows.length === 0}
            className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-5 py-ws-2 font-ui font-semibold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Add {rows.length || ''} crew
          </button>
        </footer>
      </div>
    </div>
  )
}
