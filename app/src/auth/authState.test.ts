import { describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { callbackIntent, cleanCallbackUrl, createAuthState } from './authState'

const session = (user = 'one', sid = 'session-one') => ({ user: { id: user }, access_token: `header.${btoa(JSON.stringify({ session_id: sid }))}.signature` }) as Session
function fixture(url = 'https://app.watchschedule.com/', next: Session | null = null, failure = false) {
  let listener: (event: AuthChangeEvent, session: Session | null) => void = () => {}
  const storage = window.sessionStorage
  storage.clear()
  const replace = vi.fn()
  const auth = {
    onAuthStateChange: vi.fn((callback: typeof listener) => { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    initialize: vi.fn(async () => ({ error: failure ? new Error('redacted') : null })),
    getSession: vi.fn(async () => ({ data: { session: next } })),
  }
  const browser = { url: () => new URL(url), replace, storage }
  return { auth, browser, emit: (event: AuthChangeEvent, value: Session | null) => listener(event, value) }
}
describe('recovery session initialization', () => {
  it('does not treat a query-string recovery flag or an ordinary session as recovery proof', async () => {
    const f = fixture('https://app.watchschedule.com/reset-password?type=recovery', session())
    const store = createAuthState(f.auth, f.browser)
    await store.ready
    expect(store.getSnapshot().recovery).toBe('invalid')
  })
  it('registers before initialization and holds normal routing for the delayed root recovery event', async () => {
    const f = fixture('https://app.watchschedule.com/#type=recovery&access_token=test', session())
    f.auth.initialize.mockImplementation(async () => {
      setTimeout(() => f.emit('PASSWORD_RECOVERY', session()), 0)
      return { error: null }
    })
    const store = createAuthState(f.auth, f.browser)
    expect(store.getSnapshot().loading).toBe(true)
    await store.ready
    expect(store.getSnapshot()).toMatchObject({ loading: false, recovery: 'ready' })
    expect(f.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(f.browser.replace).toHaveBeenCalledWith('/')
  })
  it('retains verified recovery on refresh only for the same user and session', async () => {
    const f = fixture('https://app.watchschedule.com/reset-password', session())
    const first = createAuthState(f.auth, f.browser)
    f.emit('PASSWORD_RECOVERY', session())
    await first.ready
    first.dispose()
    const second = createAuthState(f.auth, f.browser)
    await second.ready
    expect(second.getSnapshot().recovery).toBe('ready')
    f.emit('SIGNED_IN', session('one', 'ordinary-session'))
    expect(second.getSnapshot().recovery).toBe('none')
  })
  it('keeps expired callbacks invalid even if an existing session is present', async () => {
    const f = fixture('https://app.watchschedule.com/reset-password#error_code=otp_expired', session(), true)
    const store = createAuthState(f.auth, f.browser)
    await store.ready
    expect(store.getSnapshot().recovery).toBe('invalid')
    expect(f.browser.replace).toHaveBeenCalledWith('/reset-password')
  })
  it('clears recovery when signed out or explicitly completed', async () => {
    const f = fixture('https://app.watchschedule.com/reset-password', session())
    const store = createAuthState(f.auth, f.browser)
    f.emit('PASSWORD_RECOVERY', session()); await store.ready
    store.clearRecovery()
    expect(f.browser.storage.length).toBe(0)
    f.emit('SIGNED_OUT', null)
    expect(store.getSnapshot()).toMatchObject({ session: null, recovery: 'none' })
  })
  it('recognizes malformed callback attempts without storing sensitive content', () => {
    expect(callbackIntent(new URL('https://app.watchschedule.com/reset-password?code=test')).recovery).toBe(true)
    expect(cleanCallbackUrl(new URL('https://app.watchschedule.com/reset-password?code=test&token_hash=test&keep=yes#access_token=test&refresh_token=test'))).toBe('/reset-password?keep=yes')
  })
})
