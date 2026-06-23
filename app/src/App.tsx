// App root: BrowserRouter + AuthProvider + the guarded route map (frontend.md
// §3). Each protected group is wrapped in <RequireZone> so a hard refresh
// re-resolves the gate and keeps the user on the right screen — never flashing
// to /login while the session loads. RLS is the real gate; this is UX routing.
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, RequireZone, GateRedirect } from './auth/AuthGate'
import Login from './routes/Login'
import PaymentRequired from './routes/PaymentRequired'
import PaymentProcessing from './routes/PaymentProcessing'
import Onboarding from './routes/Onboarding/Onboarding'
import AppShell from './components/layout/AppShell'
import Dashboard from './routes/Dashboard/Dashboard'
import Settings from './routes/Settings/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public auth screen; redirects onward if already authed. */}
          <Route path="/login" element={<Login />} />

          {/* Authed + unpaid flow states. */}
          <Route element={<RequireZone zone="payment" />}>
            <Route path="/payment-required" element={<PaymentRequired />} />
            <Route path="/payment-processing" element={<PaymentProcessing />} />
          </Route>

          {/* Authed + paid + not onboarded. */}
          <Route element={<RequireZone zone="onboarding" />}>
            <Route path="/onboarding" element={<Onboarding />} />
          </Route>

          {/* Authed + paid + onboarded — the app (top-bar nav: Dashboard, Settings). */}
          <Route element={<RequireZone zone="app" />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Anything else: resolve the gate and redirect. */}
          <Route path="*" element={<GateRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
