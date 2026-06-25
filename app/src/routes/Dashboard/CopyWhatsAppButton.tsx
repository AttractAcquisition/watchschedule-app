// "Copy for WhatsApp" — the A1 action on the schedule surface (additions.md A1).
// Formats the current schedule to plain text and writes it to the clipboard with
// a success confirmation. If the clipboard API is unavailable/blocked, falls back
// to a selectable text area the captain can copy by hand. Tokens only; read-only.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { formatWhatsApp, writeClipboard } from './whatsappExport'
import type { DashboardData } from './useDashboardData'

export function CopyWhatsAppButton({ data }: { data: DashboardData }) {
  const { profile } = useAuth()
  const vesselId = profile?.vessel_id ?? undefined
  const { data: vessel } = useQuery({
    queryKey: ['vessel-name', vesselId],
    enabled: !!vesselId,
    queryFn: async () => (await supabase.from('vessels').select('name').eq('id', vesselId!).maybeSingle()).data,
    staleTime: 60_000,
  })

  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState<string | null>(null)

  async function onCopy() {
    const text = formatWhatsApp(data, vessel?.name ?? 'Vessel')
    if (await writeClipboard(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      // graceful fallback: show the block for manual copy
      setFallback(text)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        disabled={!data.schedule}
        className="flex min-h-[40px] items-center gap-ws-2 rounded-ws-sm border border-ws-line-strong px-ws-4 py-ws-2 text-ws-sm font-medium text-ws-text transition-all hover:border-ws-gold hover:bg-ws-steel-3 disabled:opacity-50"
      >
        {copied ? <Check className="h-4 w-4 text-ws-seagreen" strokeWidth={2} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
        {copied ? 'Copied!' : 'Copy for WhatsApp'}
      </button>

      {fallback !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ws-navy-deep/70 p-ws-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-ws-lg border border-ws-line bg-ws-steel-2 p-ws-6 shadow-ws-lg">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-ws-md font-semibold text-ws-offwhite">Copy the schedule</h3>
              <button type="button" onClick={() => setFallback(null)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <p className="mt-ws-2 text-ws-sm text-ws-text-muted">Your browser blocked clipboard access — select all and copy this into WhatsApp.</p>
            <textarea
              readOnly
              value={fallback}
              onFocus={(e) => e.currentTarget.select()}
              rows={12}
              className="mt-ws-4 w-full rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-3 font-mono text-ws-sm text-ws-text focus:border-ws-gold focus:outline-none"
            />
          </div>
        </div>
      )}
    </>
  )
}
