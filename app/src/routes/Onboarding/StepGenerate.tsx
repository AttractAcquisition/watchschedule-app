// Onboarding Step 3 — Generate (frontend.md §4.4 Step 3).
// Dual/Triple: an optional past-schedule uploader sits ABOVE the Generate button.
// Uploading previous schedules calls seed-fairness, which seeds the persistent
// ledger so the FIRST rota accounts for who's already stood watch. Unmatched
// names are surfaced for the captain to reconcile (never silently dropped). Solo
// never sees the uploader. Then Generate -> generate-schedule (reads the seed as
// its replay base) -> /dashboard. Tokens only.
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Sparkles, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { profileQueryKey } from '../../auth/useProfile'

interface SeedMember { crew_id: string; total_watches: number; weekend_watches: number; friday_watches: number; fairness_score: number }
interface SeedResult { seeded: boolean; lanes: { lane_id: string; members: SeedMember[] }[]; unmatched: string[]; records_extracted: number }

const extOf = (file: File) => {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type] ?? 'jpg'
}

export default function StepGenerate() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const userId = session?.user?.id
  const vesselId = profile?.vessel_id ?? undefined
  const isMultiLane = profile?.product_tier === 'dual' || profile?.product_tier === 'triple'

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seed, setSeed] = useState<SeedResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // crew_id -> name, to render the seed summary readably
  const { data: crewNames } = useQuery({
    queryKey: ['crew_names', vesselId],
    enabled: !!vesselId && isMultiLane,
    queryFn: async () => {
      const { data } = await supabase.from('crew_members').select('id,full_name').eq('vessel_id', vesselId!)
      return new Map((data ?? []).map((c) => [c.id, c.full_name]))
    },
  })

  async function onSeedFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0 || !vesselId) return
    setSeedError(null); setSeeding(true)
    try {
      const objectPaths: string[] = []
      for (const file of files) {
        const path = `${vesselId}/${crypto.randomUUID()}.${extOf(file)}`
        const up = await supabase.storage.from('past-schedules').upload(path, file, { contentType: file.type })
        if (up.error) throw up.error
        objectPaths.push(path)
      }
      const { data, error } = await supabase.functions.invoke<SeedResult>('seed-fairness', { body: { object_paths: objectPaths } })
      if (error) throw error
      setSeed(data ?? null)
    } catch {
      setSeedError("We couldn't read those past schedules. You can skip seeding and generate from a clean slate.")
    } finally {
      setSeeding(false)
    }
  }

  async function onGenerate() {
    setError(null); setGenerating(true)
    try {
      const { error } = await supabase.functions.invoke('generate-schedule', { body: { regenerate: false } })
      if (error) throw error
      if (userId) await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
      navigate('/dashboard', { replace: true })
    } catch {
      setError("We couldn't generate the schedule just now. Please try again.")
      setGenerating(false)
    }
  }

  const seededCount = seed?.lanes.reduce((n, l) => n + l.members.length, 0) ?? 0

  return (
    <div>
      <p className="ws-eyebrow">— Step 3 · Generate</p>
      <h2 className="mt-ws-1 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">Generate your watch schedule</h2>
      <p className="mt-ws-2 text-ws-sm text-ws-text-muted">
        We'll build a fair rotation from your crew and settings — balancing weekdays and weekends
        separately, weighting Fridays, and explaining every choice.
      </p>

      {/* Past-schedule uploader — Dual/Triple only */}
      {isMultiLane && (
        <section className="mt-ws-5 rounded-ws-md border border-ws-line bg-ws-steel-2 p-ws-5">
          <p className="ws-eyebrow">— Optional · Seed fairness</p>
          <h3 className="mt-ws-1 font-display text-ws-md font-semibold text-ws-offwhite">Upload past schedules</h3>
          <p className="mt-ws-2 text-ws-sm text-ws-text-muted">
            Upload previous schedules so the first rotation accounts for who's already stood watch.
          </p>

          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onSeedFiles} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={seeding}
            className="mt-ws-4 flex items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-60"
          >
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            {seeding ? 'Reading past schedules…' : 'Upload past schedule images'}
          </button>

          {seedError && <p role="alert" className="mt-ws-3 text-ws-sm text-ws-alert">{seedError}</p>}

          {seed && (
            <div className="mt-ws-4">
              <p role="status" className="text-ws-sm text-ws-ok">
                Seeded {seededCount} crew member{seededCount === 1 ? '' : 's'} from {seed.records_extracted} historical watch{seed.records_extracted === 1 ? '' : 'es'}.
              </p>
              {seed.lanes.some((l) => l.members.length > 0) && (
                <div className="mt-ws-3 overflow-hidden rounded-ws-sm border border-ws-line">
                  <table className="w-full text-ws-sm">
                    <thead>
                      <tr className="bg-ws-steel-3 text-left font-mono text-ws-xs uppercase tracking-ws-wide text-ws-text-muted">
                        <th className="px-ws-3 py-ws-2">Crew</th><th className="px-ws-3 py-ws-2">Total</th><th className="px-ws-3 py-ws-2">Weekend</th><th className="px-ws-3 py-ws-2">Friday</th><th className="px-ws-3 py-ws-2">Fairness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seed.lanes.flatMap((l) => l.members).map((m) => (
                        <tr key={m.crew_id} className="border-t border-ws-line">
                          <td className="px-ws-3 py-ws-2 text-ws-text">{crewNames?.get(m.crew_id) ?? m.crew_id.slice(0, 8)}</td>
                          <td className="px-ws-3 py-ws-2 font-mono text-ws-text-muted">{m.total_watches}</td>
                          <td className="px-ws-3 py-ws-2 font-mono text-ws-text-muted">{m.weekend_watches}</td>
                          <td className="px-ws-3 py-ws-2 font-mono text-ws-text-muted">{m.friday_watches}</td>
                          <td className="px-ws-3 py-ws-2 font-mono text-ws-gold">{Math.round(m.fairness_score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {seed.unmatched.length > 0 && (
                <div className="mt-ws-3 flex items-start gap-ws-2 rounded-ws-sm border border-ws-warn bg-ws-steel-3 p-ws-3">
                  <AlertTriangle className="mt-ws-1 h-4 w-4 shrink-0 text-ws-warn" strokeWidth={1.5} aria-hidden />
                  <p className="text-ws-sm text-ws-text">
                    Couldn't match {seed.unmatched.length} name{seed.unmatched.length === 1 ? '' : 's'} to your crew:{' '}
                    <span className="font-mono text-ws-warn">{seed.unmatched.join(', ')}</span>. Check spelling or add them as crew, then re-upload — these watches weren't seeded.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {error && <p role="alert" className="mt-ws-4 text-ws-sm text-ws-alert">{error}</p>}

      <div className="mt-ws-6">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="flex items-center gap-ws-2 rounded-ws-sm bg-ws-gold px-ws-5 py-ws-3 font-ui font-semibold text-ws-text-on-gold shadow-ws-glow-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint disabled:shadow-none"
        >
          {generating ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Sparkles className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
          {generating ? 'Computing fair rotation…' : 'Generate watch schedule'}
        </button>
        {generating && (
          <p className="mt-ws-3 font-mono text-ws-xs text-ws-text-faint">
            Balancing lanes, weighting Fridays, applying the weekend→Monday rule…
          </p>
        )}
      </div>
    </div>
  )
}
