// Local development returns to the local origin; production uses the configured
// canonical origin, falling back to the current deployment.
export const appOrigin = import.meta.env.DEV ? window.location.origin
  : new URL(import.meta.env.VITE_APP_URL || window.location.origin).origin
export const authRedirectUrl = (path: '/reset-password' | '/account-confirmation') => new URL(path, appOrigin).toString()
