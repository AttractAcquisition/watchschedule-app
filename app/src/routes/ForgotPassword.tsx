import { Link } from 'react-router-dom'
import { AuthCard } from '../components/auth/AuthCard'
import { RecoveryRequestForm } from '../components/auth/RecoveryRequestForm'

export default function ForgotPassword() {
  return <AuthCard title="Reset your password">
    <p className="mb-ws-4 text-ws-sm text-ws-text-muted">Enter your login email and we’ll send a link to set a new password.</p>
    <RecoveryRequestForm />
    <Link to="/login" className="mt-ws-4 block text-ws-sm text-ws-gold">Back to sign in</Link>
  </AuthCard>
}
