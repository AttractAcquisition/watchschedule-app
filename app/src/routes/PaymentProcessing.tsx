// /payment-processing — flow state. Stripe success_url returns here; the real
// Realtime wait for payment_status to flip is built in Phase 3. Placeholder.
export default function PaymentProcessing() {
  return (
    <main className="flex min-h-full items-center justify-center bg-ws-navy-deep p-ws-5">
      <div className="w-full max-w-md rounded-ws-lg border border-ws-line bg-ws-steel p-ws-6 text-center shadow-ws-lg">
        <p className="ws-eyebrow">— Confirming subscription</p>
        <h1 className="mt-ws-1 font-display text-ws-lg tracking-ws-tight text-ws-offwhite">
          Confirming your subscription…
        </h1>
        <p className="mt-ws-3 text-ws-base text-ws-text-muted">
          This page waits for Stripe in Phase 3.
        </p>
      </div>
    </main>
  )
}
