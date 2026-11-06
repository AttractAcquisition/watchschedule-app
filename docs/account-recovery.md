# Account recovery and identity — 6 November 2026

## Implementation and root cause

The repository uses React 18, Vite 5, strict TypeScript, React Router 6, and custom Tailwind components based on `ws-*` design tokens, rather than shadcn. The lockfile resolves `@supabase/supabase-js` and `@supabase/auth-js` to **2.108.2** (the package constraint is `^2.45.4`).

The Supabase client had `detectSessionInUrl` enabled and the default implicit SPA flow. Its React effect listener treated every auth event as an ordinary session update. There was no forgot-password link, recovery route, or `PASSWORD_RECOVERY` handling. A recovery link established a session, then the root catch-all directed that session to the dashboard. The existing Account password modal only supported a direct `updateUser` call and had generic errors.

The client now explicitly uses `flowType: 'implicit'`. The SDK alone consumes the callback and verifies its session; application code does not manually exchange codes, set sessions from fragments, or call `verifyOtp`. [Supabase's password guide](https://supabase.com/docs/guides/auth/passwords) describes the implicit browser flow, and its [auth event reference](https://supabase.com/docs/reference/javascript/auth-onauthstatechange) identifies `PASSWORD_RECOVERY` as the event that should open the password form.

One external auth store registers its synchronous listener immediately after client creation, before React mounts. Initialization waits for the SDK's delayed recovery event before releasing normal route guards. `RecoveryBoundary` wraps the ordinary routes and sends verified recovery sessions (including root callbacks) to `/reset-password`. Bad callbacks receive fixed explanatory text; raw provider error descriptions and credentials are never rendered or logged. Callback parameters are removed after SDK processing. Referrers are disabled in the entry document.

A callback introduced through fragment-only navigation reloads the document so the SDK can initialize against that URL once; application code still does not parse or exchange credentials itself. Ordinary non-auth anchors do not reload.

Recovery refresh persistence uses only a same-tab marker containing user and session IDs, recorded after `PASSWORD_RECOVERY`, matched to the active SDK session. No password or callback token is stored by application code. A query flag alone never authorizes the form. A new normal session or sign-out clears recovery state.

## User flows and session policy

- `/login` links to `/forgot-password`. The shared request form trims and validates email, calls `resetPasswordForEmail` with an explicit `/reset-password` redirect, disables duplicate submissions, and uses an account-neutral response. Rate limits and transport failures receive safe actionable messages.
- `/reset-password` is public and waits for auth initialization, independently of billing/onboarding profile readiness. A verified recovery session gets the shared new-password form. Missing, malformed, expired, and used links get guidance and another email request. An ordinary session gets an explicit link to Account settings rather than being treated as recovery.
- Password validation reflects the audited live policy, requires matching confirmation, and provides labelled visibility controls. `updateUser({ password })` is the only password writer. Policy errors, same-password rejection, session expiry, and reauthentication errors are handled. If Supabase requires a nonce, the form calls `reauthenticate()` and submits the user's code as `nonce`; it performs no fake current-password check. This follows the [password security guide](https://supabase.com/docs/guides/auth/password-security) and [reauthentication API](https://supabase.com/docs/reference/javascript/auth-reauthenticate).
- After a confirmed recovery update, the form clears its fields and recovery marker, signs out with `scope: 'local'`, and offers sign-in. Sign-out failures have a retry action. The UI does not claim other sessions were revoked. A normal Settings password update leaves the current browser signed in.
- Settings → Account → Password uses that same password form, plus a separate clearly labelled action to send a reset email to the authenticated user's current email.
- Settings email changes call `updateUser({ email }, { emailRedirectTo })`. Current Auth email and `new_email` are displayed separately. `/account-confirmation` can refresh authoritative user state and explains pending dual confirmation. It does not turn a proposed address into a confirmed address. The [supported email-change API](https://supabase.com/docs/reference/javascript/auth-updateuser) preserves server verification requirements.

## Identity model and data audit

Auth's `user.email` is the login address. `profiles.full_name` and `profiles.username` are the established name and username sources. No account field derives a person's name from an email address or from billing details. The current user is fetched from Auth on initialization and window focus; profile saves update/invalidate the current user's query cache. Opening profile edit reads the latest profile rather than a stale initial form value.

Username rules remain `^[a-z0-9][a-z0-9_-]{2,31}$`, enforced by the existing database check and case-insensitive unique index. Account/onboarding share the validation. The invalid onboarding example `alex.morgan` was replaced by `alex_morgan`. Unique conflicts are distinguished from network and other persistence errors. Updates filter on the authenticated UUID and require a returned row before reporting success. Account links select the Account tab through `?tab=account`.

The affected account's Auth email and email identity already agreed with the owner's expected current login address. Its profile email and `user_metadata.email` were stale. Migration `20261106020000_profile_auth_email.sql` reconciles profile email copies from Auth and adds a server-side sync on actual Auth email changes. A profile trigger rejects divergent client-written email copies. The stale metadata email was corrected through the supported Auth admin API, preserving all other metadata; no identity records were edited. Name and username were null and remain unset/editable.

The audit also found that profile RLS restricted the row but did not prevent a client from changing its own `vessel_id`. Some SECURITY DEFINER account RPCs derive the target vessel from that field. Migration `20261106030000_profile_membership_guard.sql` therefore makes account UUID and vessel membership immutable to authenticated client edits, while keeping ordinary profile edits available. No existing membership is changed.

Before/after checks confirmed the affected user's UUID and vessel ownership were preserved, its subscription remained active/Solo, and all **17 schedules** remained. No real user's password was changed, no user was deleted/recreated, and no subscription or ownership field was updated.

## Live configuration

Verified target: `gvpyknochnntoqsetomk` only. Production Site URL was already `https://app.watchschedule.com` and remains so.

**Completed:** `supabase/config.toml` declares exact root, reset, and confirmation URLs for production and development. The former `/**` wildcards were replaced. The live config push changed only `auth.additional_redirect_urls`; undeclared cloud settings were left unchanged. Production/local URL construction is centralized in `app/src/lib/appUrl.ts`; Vite development uses its actual local origin.

| Audited setting | Live value |
|---|---|
| Minimum password length | 6 |
| Required password character classes | None |
| Secure password-change reauthentication | Disabled; supported by UI if required later |
| Secure email change / dual confirmation | Enabled |
| Sign-up email confirmation | Disabled; unchanged by this work |
| Email resend interval | 60 seconds |
| Email OTP length | 8 |
| Custom SMTP | Disabled; built-in sender is in use |
| Recovery email subject | `Reset your password` |

Declared redirect URLs (already applied):

```text
https://app.watchschedule.com/
https://app.watchschedule.com/reset-password
https://app.watchschedule.com/account-confirmation
http://localhost:5173/
http://localhost:5173/reset-password
http://localhost:5173/account-confirmation
http://127.0.0.1:5173/
http://127.0.0.1:5173/reset-password
http://127.0.0.1:5173/account-confirmation
```

Other local ports must be deliberately added as exact entries. Do not add a broad production wildcard.

**Manual configuration/verification still needed:**

1. In the Supabase Dashboard for this project, open Authentication → Email → Reset Password (the email template editor). Verify that the action link uses `{{ .ConfirmationURL }}`, which preserves Supabase's verification endpoint and requested redirect. Do not replace it with `{{ .SiteURL }}` or a bare app URL. The CLI exposed the subject but did not expose/compare the live HTML body, so that body remains unverified. A ready-to-paste safe template is in `supabase/templates/recovery.html`; adding that file does not itself install the dashboard template. See the [email template documentation](https://supabase.com/docs/guides/auth/auth-email-templates).
2. For reliable delivery to general production users, configure a verified custom SMTP provider in Authentication → Email → SMTP Settings: provider host, port, username/password, sender address, and sender name. Keep credentials in Supabase, never the frontend or repository. Verify the provider's sender/domain and disable link tracking/rewriting for auth emails. Supabase's built-in sender has recipient/rate restrictions; see [custom SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp). The existing mailbox's actual delivery and click-through must be checked by its owner; no email was sent to unrelated users during automated tests.

No RLS weakening, verification disabling, service-role frontend exposure, or password-storage table was introduced. The migration is applied and the final database dry run has no pending migrations. Profile RLS and gate-column protection remain in place.

## Hosting

GitHub Pages uses `app/public/404.html` to carry the requested route/query/fragment back to the root, and the inline restore script in `app/index.html` restores it before the app module initializes. Recovery stays outside the protected route groups. Browser checks exercise these actual two scripts rather than relying solely on Vite's automatic SPA fallback. Do not move the 404 file outside `public/` or strip its fragment handling.

## Verification and account-holder check

Focused frontend tests cover auth initialization/routing, callback cleanup, same-session recovery refresh, expired callbacks with existing sessions, password validation/visibility/duplicate prevention, nonce reauthentication, backend password errors, neutral recovery requests, authoritative email, pending changes, profile cache refresh and username conflicts. Run `npm test` in `app/`; CI runs it before the production build. TypeScript/build use `npm run typecheck` and `npm run build`. No lint script was configured in this repository.

SQL regression tests in `supabase/tests/account_profile.sql` cover confirmed email sync, client email/membership tampering, own-user name/username writes, foreign-user isolation, username format/uniqueness and protected subscription fields. They run inside an explicit transaction and are rolled back. Both new migrations were preflighted in rolled-back transactions before production application.

Automated browser tests use disposable Auth users, fresh generated recovery links, and synthetic profile values. They never use conversation tokens or change the owner's password. Recovery email request delivery is intercepted in these tests; actual mailbox delivery remains an owner check. Test users/vessels are removed afterward. Successful email-change confirmation through both real inboxes and delivery of a reauthentication code are not established by mocked form tests.

Completed results: **27 frontend tests passed**, TypeScript and Vite production build passed, and the final SQL regression suite passed against the live schema with rollback. Chromium with the real SDK/live Auth backend passed normal sign-in, Account deep linking, authoritative email, name/username save+refresh, Settings password change verified by new-password login, current-email recovery request with correct redirect (delivery intercepted), fresh recovery with an existing session, actual Pages 404/restore scripts, recovery refresh, callback credential cleanup, successful reset plus local sign-out/new-password login, used-link guidance, legacy root recovery routing, missing/malformed direct links (including fragment-only navigation), and name/username persistence after a new login. All disposable test users and vessel data were removed. No test email was sent to an unrelated mailbox.

Owner checklist after deployment:

1. Open `/login` in a private window → Forgot password? → enter the current login email. Use only the newest fresh email; confirm it opens `/reset-password`, not the dashboard.
2. Set and confirm a new password. Confirm success, then sign in with it and verify the same vessel, subscription and schedules. Repeat requesting a link while already signed in if desired; never reuse a previously consumed link.
3. In Settings → Account, verify the current login email, edit the unknown name/username to the intended values, save, refresh, and sign out/in to confirm persistence. Check the Password panel's immediate-change and email-link actions separately.
4. If intentionally changing login email, confirm both email messages and use Refresh account to verify that the proposed email remains pending until Auth reports it as current. Confirm billing contact remains a separate concern.

## Changed file map

- `app/src/auth/authState.ts`, `useSession.ts`, `AuthGate.tsx`: single early auth listener, recovery lifecycle, authoritative refresh and routing priority.
- `app/src/lib/supabase.ts`, `appUrl.ts`: explicit implicit SDK flow and centralized callback origins.
- `app/src/auth/accountValidation.ts`: shared audited password/username/email rules and safe error messages.
- `app/src/components/auth/*`: shared card, recovery request and new-password forms.
- `app/src/routes/Login.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `AccountConfirmation.tsx`, `App.tsx`: public routes and account entrypoints.
- `app/src/routes/Settings/AccountProfileForm.tsx`, `Settings.tsx`: shared Password flow, Auth email changes, correct profile persistence and account deep links.
- `app/src/routes/Onboarding/StepCrew.tsx`: shared username validation and valid example.
- `TopBar.tsx`, `Onboarding.tsx`, `PaymentRequired.tsx`: explicit click wrappers for the scoped sign-out API.
- `app/index.html`, `.env.example`: callback referrer protection and local-origin guidance.
- `app/src/**/*.test.*`, `app/src/test/setup.ts`, `app/vitest.config.ts`, package manifests and deployment workflow: focused regression tests and CI checks.
- `supabase/config.toml`, `supabase/templates/recovery.html`, the profile-email migration and `supabase/tests/account_profile.sql`: exact redirect configuration, dashboard template reference, email consistency and database regression coverage.
- `docs/frontend.md`, `backend.md`, `master.md`, this document: source-of-truth updates and operational evidence.
