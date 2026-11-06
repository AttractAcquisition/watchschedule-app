// Audited production policy: minimum_password_length=6, no character classes.
// Supabase remains authoritative for future policy and leaked-password checks.
export const PASSWORD_MIN_LENGTH = 6
export const PASSWORD_HELP = 'Use at least 6 characters. A long, unique password is recommended.'
export const usernamePattern = /^[a-z0-9][a-z0-9_-]{2,31}$/
export const USERNAME_HELP = 'Use 3–32 lowercase letters, numbers, hyphens, or underscores, starting with a letter or number.'
export function passwordError(password: string, confirmation: string) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  if (password !== confirmation) return 'The new passwords do not match.'
  return null
}
export const cleanEmail = (email: string) => email.trim()
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email))
export function accountError(error: unknown, action: 'password' | 'recovery' | 'email' | 'profile') {
  const e = (error ?? {}) as { code?: string; status?: number; name?: string }
  if (e.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(e.code ?? '')) return 'Too many requests. Please wait a few minutes before trying again.'
  if (e.code === 'weak_password') return 'Supabase rejected this password. Use a longer, unique password that meets the account password policy.'
  if (e.code === 'same_password') return 'Choose a password different from your current password.'
  if (e.code === 'reauthentication_not_valid') return 'That verification code is invalid or expired. Request a new code and try again.'
  if (e.code === 'reauthentication_needed') return 'Verify your identity with an email code before changing your password.'
  if (['session_not_found', 'session_expired', 'refresh_token_not_found'].includes(e.code ?? '') || e.status === 401) return 'Your session has expired. Sign in again or request a fresh password reset link.'
  if (e.code === 'email_exists' || e.code === 'user_already_exists') return 'That email address is unavailable. Use another address.'
  if (e.code === '23505') return 'That username is unavailable. Please choose another one.'
  if (e.code === '23514') return USERNAME_HELP
  if (e.name === 'AuthRetryableFetchError' || error instanceof TypeError) return 'Could not reach the server. Check your connection and try again.'
  return action === 'recovery' ? 'Could not send the reset email. Please try again shortly.'
    : action === 'email' ? 'Could not request the email change. Please try again.'
    : action === 'profile' ? 'Could not save your profile. Please try again.'
    : 'Could not update your password. Please try again or request a fresh reset link.'
}
