// Onboarding Step 3 — Generate (frontend.md §4.4 Step 3).
// Phase 7 wires the "Generate watch schedule" button -> generate-schedule, then
// routes to /dashboard on success (the function completes onboarding server-side,
// so the gate would also send us there). The Dual/Triple past-schedule uploader
// lands in Phase 8 (a placeholder note for now). Calm "computing" state per
// branding.md. Tokens only.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../../auth/AuthGate'
import { profileQueryKey } from '../../auth/useProfile'

export default function StepGenerate() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const userId = session?.user?.id
  const isMultiLane = profile?.product_tier === 'dual' || profile?.product_tier === 'triple'
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onGenerate() {
    setError(null)
    setGenerating(true)
    try {
      const { error } = await supabase.functions.invoke('generate-schedule', { body: { regenerate: false } })
      if (error) throw error
      // The function set onboarding_complete=true; refresh the gate then route.
      if (userId) await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
      navigate('/dashboard', { replace: true })
    } catch {
      setError("We couldn't generate the schedule just now. Please try again.")
      setGenerating(false)
    }
  }

  return (
    <div>
      <p className="ws-eyebrow">— Step 3 · Generate</p>
      <h2 className="mt-ws-1 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">Generate your watch schedule</h2>
      <p className="mt-ws-2 text-ws-sm text-ws-text-muted">
        We'll build a fair rotation from your crew and settings — balancing weekdays and weekends
        separately, weighting Fridays, and explaining every choice.
      </p>

      {isMultiLane && (
        <p className="mt-ws-5 rounded-ws-sm border border-ws-line bg-ws-steel-2 p-ws-3 text-ws-sm text-ws-text-muted">
          Have previous schedules? Uploading them to seed fairness arrives in the next step (Phase 8),
          so your first rotation accounts for who's already stood watch.
        </p>
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
