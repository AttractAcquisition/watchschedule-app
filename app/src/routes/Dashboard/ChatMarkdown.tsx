// ChatMarkdown (B2 item 4) — renders the assistant's markdown reply. react-markdown
// builds a React element tree; it does NOT render raw HTML (no rehype-raw, no
// dangerouslySetInnerHTML), and its default urlTransform strips dangerous link
// protocols (javascript:, data:, vbscript:) — so there is no HTML-injection / XSS
// path. We only map block/inline elements to branding tokens. Inline `code` (the
// cited schedule data — dates / initials / scores) stays mono/gold, matching the
// previous backtick behaviour. Kept in its own module so it is unit-testable in
// isolation (renders without pulling the Supabase client).
import ReactMarkdown from 'react-markdown'

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-ws-2 text-ws-sm leading-ws-normal text-ws-text">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="text-ws-sm leading-ws-normal text-ws-text">{children}</p>,
          h1: ({ children }) => <h3 className="font-display text-ws-md font-semibold text-ws-offwhite">{children}</h3>,
          h2: ({ children }) => <h3 className="font-display text-ws-base font-semibold text-ws-offwhite">{children}</h3>,
          h3: ({ children }) => <h4 className="font-display text-ws-sm font-semibold text-ws-offwhite">{children}</h4>,
          ul: ({ children }) => <ul className="ml-ws-4 list-disc space-y-ws-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-ws-4 list-decimal space-y-ws-1">{children}</ol>,
          li: ({ children }) => <li className="text-ws-sm text-ws-text">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-ws-offwhite">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ws-gold underline hover:text-ws-gold-bright">{children}</a>,
          code: ({ children }) => <code className="font-mono text-ws-gold">{children}</code>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-ws-sm bg-ws-steel-3 p-ws-2 font-mono text-ws-xs text-ws-text">{children}</pre>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
