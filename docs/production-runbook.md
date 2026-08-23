# Luxe Loyalty production runbook

This runbook takes the repository from a local build to a controlled Google Wallet pilot and production launch. It assumes the customer experience is wallet-first, while `/staff` and `/admin` remain mobile web applications.

## 1. Production release gates

Do not publish the wall QR code until every item below is complete:

- [ ] The exposed Supabase secret has been rotated and the old key is disabled.
- [ ] `.env.example` contains placeholders only and `.env` / `.env.local` are ignored by Git.
- [ ] Staging and production use separate Supabase projects or, at minimum, separate tenants and credentials.
- [ ] All database migrations pass on a clean staging database in their documented order.
- [ ] Customer phone OTP, staff authentication, tenant isolation, and admin authorization have passed integration tests.
- [ ] `ALLOW_UNVERIFIED_PHONE_LOGIN` is absent or `false`.
- [ ] A real Android phone can add, restore, display, scan, update, and redeem a test Wallet pass.
- [ ] Duplicate scans, repeated API requests, and repeated redemption attempts do not create duplicate ledger entries.
- [ ] Offline behavior matches [the offline policy](./offline-policy.md).
- [ ] Backup retention and a restore drill have been verified.
- [ ] Error, SMS delivery, database, and Wallet synchronization alerts reach an operator.
- [ ] Google Wallet publishing access is approved and passes no longer show test-only labeling.

## 2. Rotate and contain secrets

A real Supabase secret was previously present in `.env.example`. It was not tracked at the time it was found, but it must still be treated as disclosed.

1. In Supabase, create a replacement secret key, update any legitimate consumers, and disable the old key.
2. Search the complete Git history before the first production deployment:

   ```powershell
   git log -p --all -- .env .env.example
   git grep -n -I -E "sb_secret_[A-Za-z0-9_-]{20,}|TWILIO_AUTH_TOKEN=[0-9a-fA-F]{32}|-----BEGIN (RSA |EC )?PRIVATE KEY-----" $(git rev-list --all)
   ```

3. If a secret was ever committed, rotate it first. History rewriting is secondary and requires coordination with anyone who cloned the repository.
4. Enable MFA for Supabase, Twilio, Google Cloud, Google Pay & Wallet Console, Git hosting, and Vercel accounts.
5. Never paste production credentials into issues, chat, logs, screenshots, or client-side `VITE_*` variables.

Generate each application secret independently. This PowerShell expression creates a 48-byte random Base64 value:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Use different values for `STAFF_SESSION_SECRET`, `QR_SIGNING_SECRET`, and `CRON_SECRET`. Rotating `STAFF_SESSION_SECRET` signs all staff out. Rotating `QR_SIGNING_SECRET` must be coordinated with barcode token validity and any queued synchronization work.

## 3. Environment configuration

Use [.env.example](../.env.example) as the variable contract. For local development, place real values in ignored `.env.local`. In Vercel, add variables through Project Settings rather than uploading an env file.

### Required in the Vite browser build

| Variable | Purpose | Secret |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Project origin such as `https://project-ref.supabase.co`; never append `/rest/v1/` | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase browser key constrained by RLS | No |
| `VITE_APP_MODE` | Set to `production` in Preview and Production | No |
| `VITE_DEMO_MODE` | Must be `false` in Preview and Production | No |
| `VITE_DEFAULT_TENANT_SLUG` | Tenant used by `/`, `/staff`, and `/admin` when no query parameter is present | No |

### Required in Vercel Functions

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Canonical HTTPS origin without a trailing slash |
| `SUPABASE_SECRET_KEY` | Privileged server access; never import it into frontend code |
| `STAFF_SESSION_SECRET` | Signs short-lived staff sessions |
| `QR_SIGNING_SECRET` | Signs and hashes QR and redemption tokens |
| `CRON_SECRET` | Authenticates internal Wallet synchronization jobs |
| `GOOGLE_WALLET_ISSUER_ID` | Numeric issuer ID from Google Pay & Wallet Console |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` | Service-account email granted issuer access |
| `GOOGLE_WALLET_PRIVATE_KEY` | PEM key; Vercel may store it multiline or with escaped `\n` characters |
| `ALLOW_UNVERIFIED_PHONE_LOGIN` | Temporary setup-pilot switch only; set `true` only while intentionally allowing number-only sign-in |

The Google Wallet class suffix and allowed origins have safe defaults derived from the issuer and `APP_URL`; set their optional variables only when the deployment needs an override. Google save/delete callbacks are deliberately not accepted because they require Google Tink message verification and are not needed for pass issuance or balance updates.

Twilio credentials live in Supabase Auth provider settings. The application applies database-backed request throttling by phone hash and IP hash before asking Supabase Auth to send an OTP.

### Temporary number-only setup mode

To proceed before Twilio is configured, keep Supabase Phone Auth enabled, set `ALLOW_UNVERIFIED_PHONE_LOGIN=true` in the Vercel environment, and redeploy. The same phone number screen remains in place, but the application creates or reuses a Supabase user and opens a normal session without sending SMS. The phone/IP throttle still limits sign-in attempts to three per hour.

This is deliberately not ownership verification. Anyone who knows a member's phone number can open that member's loyalty account, and anyone who knows an owner's number can attempt to enter `/admin` as that owner. Use it only for a private setup pilot with non-sensitive test accounts, then set the variable to `false` or remove it before public use. Staff device enrollment and staff PIN checks remain enforced.

For a test user on Android, open `/?tenant=<tenant-slug>&test-wallet=1` on the deployed HTTPS origin. Complete the normal number and name setup; the app creates that member's pass and opens the Google Wallet save screen automatically. This does not require a staff or owner approval.

Set production secrets only in Vercel's Production environment. Use separate credentials and a separate Supabase project in Preview. Development values belong in `.env.local`. After changing a Vercel environment variable, redeploy so the build and functions receive the new value.

Production builds fail closed when backend configuration is absent. Never enable `VITE_DEMO_MODE` on Preview or Production; it exposes fixture accounts and demo PINs. Demo mode is limited to local Vite development with synthetic data.

Reference: [Vercel environment variables](https://vercel.com/docs/environment-variables), [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

## 4. Supabase and Twilio

### Supabase project

1. Create staging and production projects in a region close to the salon and Vercel Function region.
2. Copy the project URL and publishable key into the matching deployment environment.
3. Keep the secret key in server environments only. It bypasses Row Level Security and must never reach the browser.
4. In Authentication URL Configuration, set the production Site URL to `APP_URL`. Add only controlled staging/preview redirect URLs.
5. Enable phone authentication. Use six-digit OTPs, a short expiry, and rate limits appropriate for checkout traffic.
6. Review Auth rate limits before the pilot and request increases only from observed demand.

### Twilio

1. Create a Messaging Service with an approved SMS sender for every country the salon will support.
2. In Supabase Authentication provider settings, enter the Twilio Account SID, Auth Token, and Messaging Service SID.
3. Restrict Twilio geographic permissions to supported destinations.
4. Configure spending and delivery-failure alerts.
5. Test success, invalid number, delayed message, expired code, resend throttling, and carrier rejection cases on real Canadian numbers.
6. Confirm the final consent and message wording meets the salon's legal and carrier requirements.

Reference: [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login).

## 5. Database provisioning

The ordered files under `database/migrations` are authoritative. Apply these files in order and stop on the first error:

1. `202608220001_foundation.sql`
2. `202608220002_security.sql`
3. `202608220003_core_rpcs.sql`
4. `202608220004_operations_rpcs.sql`
5. `202608220005_realtime_and_maintenance.sql`
6. `202608220006_remove_turnstile.sql`

From PowerShell with `psql` installed and `SUPABASE_DB_URL` set locally:

```powershell
$migrationFiles = Get-ChildItem -LiteralPath database/migrations -Filter *.sql | Sort-Object Name
foreach ($migrationFile in $migrationFiles) {
  & psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f $migrationFile.FullName
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($migrationFile.Name)" }
}
```

Never apply `database/seed.example.sql` unchanged. For production, copy it into a reviewed tenant-bootstrap script, replace every `REPLACE` value, confirm the final loyalty rules and public URLs, and execute it once after the migrations. The example deliberately omits owner credentials and Wallet secrets. Follow `database/README.md` for owner/bootstrap instructions and post-migration verification.

Before each production migration:

1. Confirm a recent recoverable backup.
2. Record the current application deployment and migration version.
3. Apply migrations before deploying code that requires them.
4. Run tenant-isolation and transaction-RPC smoke tests.
5. Prefer a forward corrective migration if something fails; do not destructively reverse a production schema without a tested recovery plan.

### Counter device enrollment

1. Open `/staff?tenant=<slug>` on the new counter device. It creates a non-extractable P-256 private key in that browser and displays a setup QR.
2. Scan the setup QR with the owner's phone and complete the protected `/admin` phone verification.
3. In the Staff section, name and approve the linked counter request. The server stores only its public key and returns a device enrollment link as a QR.
4. Scan that second QR with the counter device. Its enrollment secret is carried in a URL fragment, removed immediately by the app, and never sent in the HTTP request URL.
5. Enter an assigned staff PIN and complete one online scan plus one signed offline recovery test.

Clearing site data removes the device's private key and any queued visits. Revoke that device from `/admin`, then repeat enrollment. Never transfer a counter enrollment by copying browser storage or reusing another device's private key.

## 6. Google Wallet issuer setup

1. Create a dedicated Google Cloud project for production and enable the Google Wallet API.
2. Register the business in Google Pay & Wallet Console and record the numeric issuer ID.
3. Create a dedicated service account used only for Wallet issuance and updates.
4. Grant that service account the minimum issuer access required in the Wallet Console.
5. Create a JSON key once, extract `client_email` and `private_key` into Vercel, then securely delete local copies of the JSON file. Do not commit it.
6. Add named pilot Google accounts as test users while the issuer is in Demo Mode.
7. Create the loyalty class through the application/API, then inspect logo, brand color, hero image, labels, salon details, links, and barcode behavior on physical Android devices.
8. Verify that member object IDs are opaque and contain no phone number or other personal information.
9. Exercise create, save, restore, update, suspend, and redemption paths.
10. Request Google publishing access only after the complete physical front-desk flow passes.

Reference: [Google Wallet issuer onboarding](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding) and [web pass issuance](https://developers.google.com/wallet/retail/loyalty-cards/web).

## 7. Vercel project setup

1. Connect the Git repository to a new Vercel project.
2. Select Vite, `npm run build`, and `dist`. The committed `vercel.json` contains these defaults.
3. Pin a supported Node.js version in Vercel project settings and use the same major version locally and in CI.
4. Choose a Function region near the production Supabase project.
5. Configure Development, Preview, and Production variables as described above.
6. Deploy Preview first. Confirm `/api/health` resolves to a Function and returns `status: ready`, while `/`, `/staff`, `/admin`, and other client routes resolve to the SPA.
7. Attach the production domain and follow Vercel's displayed DNS records. Set the same origin in Supabase Auth and Google Wallet configuration.
8. Redeploy Production after all variables are present.

The committed Wallet worker calls `GET /api/wallet/sync` every minute and processes at most 20 claimed jobs per invocation. It therefore requires a Vercel Pro or Enterprise project. Vercel Hobby permits only daily cron schedules and will reject this production cadence during deployment. The staff app also requests an immediate pass refresh after a committed checkout; the outbox worker is the durable retry path when that request or Google Wallet is temporarily unavailable.

Vercel also calls `GET /api/maintenance` daily at 04:17 UTC to expire temporary records and clean bounded operational tables. Both endpoints require `Authorization: Bearer <CRON_SECRET>`; Vercel adds this header automatically when the project has a `CRON_SECRET` environment variable. Cron jobs run only for Production deployments, use UTC, may be delivered more than once, and are not retried by Vercel after a failed invocation. The database claim and maintenance routines are concurrency-safe, while failed Wallet jobs remain in the outbox for a later invocation.

After the first production deployment, open Vercel Project Settings > Cron Jobs and verify both schedules exist. Inspect the first successful invocation of each endpoint without logging its authorization header. If an Instant Rollback is used, check the Cron Jobs page separately because rolling back an application deployment does not roll back active cron configuration.

Reference: [Vercel Cron usage and plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [secured Cron invocations](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The deployment config deliberately sends `/api/*` through Vercel Functions, applies a SPA fallback only to non-API paths, disables caching for API responses, and assigns immutable caching only to Vite's content-hashed `/assets/*` files.

The committed Content Security Policy permits standard `*.supabase.co` projects. Before adding a custom Supabase domain, analytics, error-reporting transport, or any other browser origin, integrate it explicitly, add only its required origin to the appropriate CSP directive, and retest authentication and scanner flows.

## 8. Build and automated checks

Run from a clean checkout with the production Node.js major version:

```powershell
npm ci
npm run typecheck
npm run build
npm run test:unit
npm run test:e2e
npm run test:e2e:production
npm audit --omit=dev
```

The production browser suite builds the app and runs against `vite preview`, so its service-worker and offline-shell checks exercise compiled assets. It also fails if demo screen chunks or known demo credential markers appear anywhere in `dist/assets`. The demo suite runs separately against Vite development mode.

Required security/integration checks include:

- Anonymous, customer, staff, and owner access against every API route.
- Cross-tenant reads and writes using two real tenants.
- Atomic visit, point, redemption, and undo operations.
- Concurrent duplicate requests using the same idempotency key.
- Same-member scan debounce within the configured interval.
- Redemption token expiry, replay, screenshot, and clock-skew scenarios.
- Staff session expiry, logout, revocation, PIN throttling, and lost-device recovery.
- Customer OTP expiry, resend throttling, account restoration, and phone-number change.
- Wallet update failure followed by safe retry without replaying the loyalty transaction.
- Browser console free of CSP, mixed-content, service-worker, and uncaught runtime errors.

## 9. Preview and physical-device pilot

Run a staff-only dry run, then a limited customer pilot. Use at least two Android versions, two staff devices, and one deliberately weak connection.

For each pilot member:

1. Scan the wall enrollment QR.
2. Complete phone OTP.
3. Add the loyalty pass to Google Wallet.
4. Close the browser and restore the pass from the profile page.
5. Scan at the staff portal, confirm a visit, and watch the Wallet balance update.
6. Earn and redeem a reward once; verify the second redemption fails.
7. Trigger duplicate scans and repeated confirm taps; verify one ledger entry.
8. Undo an eligible transaction and verify the ledger, balance, audit record, and Wallet object converge.
9. Test the documented offline behavior.

Record every discrepancy with member, tenant, transaction, request/idempotency, and Wallet object IDs. Never place full phone numbers, OTPs, session cookies, QR tokens, or private keys in issue reports.

## 10. Backups, monitoring, and alerts

### Backups

- Verify the exact Supabase backup retention included in the production plan.
- Enable point-in-time recovery when the required recovery objective exceeds scheduled backup coverage.
- Keep a regular encrypted logical backup in a separate controlled location.
- Perform a restore into an isolated staging project before launch and at least quarterly.
- Document who can authorize a restore and how the production app is placed in maintenance mode during recovery.

### Monitoring

Use Vercel and Supabase logs without recording secrets or unnecessary personal data. No third-party browser error transport is currently integrated; adding one requires an explicit privacy review, SDK setup, environment contract, and matching CSP destination. Alert on:

- API 5xx rate above 2% for five minutes.
- Authentication or SMS delivery failures materially above the established pilot baseline.
- Wallet synchronization jobs older than five minutes or a growing retry queue.
- Redemption conflicts, duplicate prevention events, and anomalous manual adjustments.
- Database storage, connections, or CPU above 80% of the selected plan limit.
- Expiring Google service-account credentials or unexpected issuer/API authorization errors.

Assign one primary and one backup operator. Test alert delivery before launch.

## 11. Launch procedure

1. Freeze schema and loyalty-rule changes for the launch window.
2. Confirm the latest backup and successful restore drill.
3. Apply pending production migrations and complete smoke tests.
4. Deploy the production build and verify headers, SPA routes, API routes, Auth, and Wallet issuance.
5. Confirm `GET /api/health` returns HTTP 200 with `status: ready`; this reports configuration presence without returning secret values.
6. Confirm Google Wallet production approval and create a fresh production pass.
7. Verify one complete transaction and one redemption using store hardware.
8. Generate the permanent wall QR for the canonical HTTPS enrollment URL and tenant slug.
9. Replace pilot/demo QR material only after scanning the printed production code.
10. Keep an operator watching errors, SMS delivery, transactions, and Wallet sync for the first full business day.

## 12. Rollback and incident response

For an application regression, promote the last known-good Vercel deployment. Do not reverse database migrations unless a tested rollback explicitly proves it is safe; use a forward repair migration whenever possible.

For suspected credential disclosure:

1. Disable or rotate the affected provider credential immediately.
2. Rotate `STAFF_SESSION_SECRET` if staff sessions may be compromised.
3. Rotate QR and cron secrets only with a plan for currently valid tokens and jobs.
4. Review Vercel, Supabase, Twilio, and Google audit logs for the exposure window.
5. Reconcile affected transactions against the immutable ledger.
6. Record scope, timeline, corrective action, and any required customer notification with appropriate legal guidance.

For Wallet API degradation, keep the database transaction authoritative and retry only the Wallet object update. Never replay the earning or redemption transaction to repair a stale pass.

## 13. Apple Wallet readiness

Google Wallet is the initial platform, but business rules and database records must remain provider-neutral. Keep pass issuance behind create/update/revoke/restore operations and avoid Google object IDs as primary customer or transaction identifiers. A later Apple implementation will add Pass Type IDs, signing certificates, `.pkpass` generation, an update web service, and APNs without replacing the loyalty ledger.
