// ScheduleChat — the Claude chatbot panel (frontend.md §4.5, branding.md §5).
// A docked panel toggled from a gold button. User messages right-aligned in
// steel-3 bubbles; assistant messages left-aligned, borderless on steel-2 with a
// gold tick. Cited data (the assistant wraps it in backticks) is rendered in
// mono/gold. Calls schedule-chat (key stays server-side); the function answers
// only within this vessel's data. Tokens only.
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, MessageSquare, Send, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ChatMarkdown } from './ChatMarkdown'

interface Turn { role: 'user' | 'assistant'; content: string }

export function ScheduleChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, open])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const q = input.trim()
    if (!q || sending) return
    setError(null)
    const history = messages
    setMessages((m) => [...m, { role: 'user', content: q }])
    setInput('')
    setSending(true)
    try {
      const { data, error } = await supabase.functions.invoke<{ reply: string }>('schedule-chat', { body: { message: q, history } })
      if (error) throw error
      setMessages((m) => [...m, { role: 'assistant', content: data?.reply ?? '…' }])
    } catch {
      setError("Couldn't reach the assistant just now. Please try again.")
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-ws-6 right-ws-6 z-40 flex items-center gap-ws-2 rounded-ws-full bg-ws-gold px-ws-4 py-ws-3 font-ui font-semibold text-ws-text-on-gold shadow-ws-glow-gold transition-all hover:bg-ws-gold-bright"
      >
        <MessageSquare className="h-5 w-5" strokeWidth={1.5} aria-hidden /> Ask about your schedule
      </button>
    )
  }

  return (
    <div className="fixed bottom-ws-5 right-ws-5 z-40 flex h-[32rem] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-ws-lg border border-ws-line bg-ws-steel-2 shadow-ws-lg">
      <header className="flex items-center justify-between border-b border-ws-line px-ws-4 py-ws-3">
        <div className="flex items-center gap-ws-2">
          <Check className="h-4 w-4 text-ws-gold" strokeWidth={2} aria-hidden />
          <span className="font-display text-ws-md font-semibold text-ws-offwhite">Schedule assistant</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-ws-sm text-ws-text-muted hover:bg-ws-steel-3 hover:text-ws-text">
          <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      </header>

      <div className="flex-1 space-y-ws-3 overflow-y-auto p-ws-4">
        {messages.length === 0 && (
          <p className="text-ws-sm text-ws-text-muted">
            Ask about the rota — e.g. <span className="text-ws-text">"Why is this crew member on Friday?"</span> or{' '}
            <span className="text-ws-text">"Who has the most weekends?"</span>
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-ws-md bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-sm text-ws-text">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-ws-2">
              <Check className="mt-ws-1 h-4 w-4 shrink-0 text-ws-gold" strokeWidth={2} aria-hidden />
              <div className="max-w-[85%] text-ws-sm leading-ws-normal text-ws-text"><ChatMarkdown text={m.content} /></div>
            </div>
          )
        )}
        {sending && (
          <div className="flex items-center gap-ws-2 text-ws-sm text-ws-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking…
          </div>
        )}
        {error && <p role="alert" className="text-ws-sm text-ws-alert">{error}</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex items-center gap-ws-2 border-t border-ws-line p-ws-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the schedule…"
          className="flex-1 rounded-ws-sm border border-ws-line bg-ws-steel-3 px-ws-3 py-ws-2 text-ws-sm text-ws-text placeholder:text-ws-text-faint focus:border-ws-gold focus:outline-none"
        />
        <button type="submit" disabled={sending || !input.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ws-sm bg-ws-gold text-ws-text-on-gold transition-all hover:bg-ws-gold-bright disabled:bg-ws-steel-3 disabled:text-ws-text-faint">
          <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      </form>
    </div>
  )
}
