import type { ReactNode } from 'react'
import { Anchor } from 'lucide-react'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return <main className="flex min-h-full items-center justify-center bg-ws-navy-deep p-ws-5">
    <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 shadow-ws-lg">
      <div className="flex items-center gap-ws-2"><Anchor className="h-5 w-5 text-ws-gold" aria-hidden /><span className="font-display font-semibold text-ws-offwhite">WatchSchedule</span></div>
      <h1 className="mb-ws-4 mt-ws-4 font-display text-ws-lg text-ws-offwhite">{title}</h1>
      {children}
    </div>
  </main>
}
