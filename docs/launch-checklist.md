# Production launch checklist

Use this checklist with the detailed [production runbook](./production-runbook.md). Record the deployment URL, Git commit, migration version, operator, and date in the release ticket before starting.

## Before the launch window

- [ ] Previous exposed Supabase secret is disabled; repository and history scans contain no live credentials.
- [ ] Production provider accounts have MFA and at least two authorized business administrators.
- [ ] Vercel Production variables match `.env.example`; no server secret has a `VITE_` prefix, `VITE_APP_MODE=production`, and `VITE_DEMO_MODE=false`.
- [ ] The Vercel project is Pro/Enterprise so the committed one-minute Wallet retry schedule can deploy.
- [ ] Supabase Auth Site URL, redirect allowlist, phone provider, and rate limits are production values.
- [ ] Twilio sender, geographic permissions, spending alert, and delivery alert are active.
- [ ] `ALLOW_UNVERIFIED_PHONE_LOGIN` is absent or `false`; a public launch must require verified phone ownership.
- [ ] Google issuer has publishing access; production service account has minimum required Wallet access.
- [ ] Salon name, logo, address, hours, phone, privacy URL, loyalty rules, and reward costs are approved.
- [ ] Current production backup is recoverable and the latest restore drill succeeded.
- [ ] Preview passed typecheck, build, automated tests, tenant-isolation tests, and physical-device pilot.
- [ ] On-call primary and backup operators receive test alerts.

## Deploy

- [ ] Freeze schema, reward-rule, and provider-setting changes for the launch window.
- [ ] Record the current known-good Vercel deployment for rollback.
- [ ] Apply pending database migrations in filename order and stop on any error.
- [ ] Run post-migration RLS, RPC, and tenant-isolation smoke tests.
- [ ] Deploy the exact tested Git commit to Vercel Production.
- [ ] Verify the Cron Jobs page lists Wallet sync every minute and maintenance daily at 04:17 UTC; inspect one successful invocation of each.
- [ ] Verify `/`, `/staff`, and `/admin` deep links return the SPA.
- [ ] Verify `GET /api/health` returns HTTP 200 with `status: ready`, and authenticated API responses use `Cache-Control: private, no-store`.
- [ ] Verify `sw.js`, the manifest, CSP, camera permissions, and content-hashed asset caching headers.
- [ ] Complete one production customer OTP and account recovery.
- [ ] Create and save one production Google Wallet pass on a physical Android phone.
- [ ] Enroll a counter through the two-QR owner approval flow, confirm its private key remains local, then revoke a test device and verify its session stops working.
- [ ] Complete one visit, one duplicate-scan rejection, one reward redemption, one replay rejection, and one eligible undo.
- [ ] Confirm the database ledger, audit record, displayed customer balance, and Wallet object agree after each action.

## Open enrollment

- [ ] Print and scan-test the permanent wall QR from multiple camera apps.
- [ ] Confirm it uses the canonical HTTPS origin and intended tenant slug.
- [ ] Remove or cover every demo/staging QR before displaying the production QR.
- [ ] Give staff the lost-phone, offline, mistaken-transaction, and escalation procedures.
- [ ] Watch API errors, database health, Auth, SMS delivery, duplicate prevention, redemptions, and Wallet sync continuously through the first business day.

## Stop-launch conditions

Stop enrollment and return to the last known-good deployment when any of these occurs:

- Cross-tenant access or unauthorized point mutation.
- Duplicate ledger entries from one scan or idempotency key.
- A reward can be redeemed more than once.
- A server secret appears in browser assets, responses, logs, or source control.
- Wallet and database balances fail to converge after the documented retry window.
- OTP or staff authentication cannot be rate limited or revoked.
- There is no confirmed recoverable production backup.

Do not attempt a destructive database rollback during an active incident. Preserve evidence, keep the ledger authoritative, and use the rollback/incident procedure in the production runbook.
