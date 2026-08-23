# Offline behavior and transaction policy

The installed web app provides an offline application shell, not an offline source of truth. Supabase remains authoritative for identity, balances, rewards, roles, transactions, and audit records. The Google Wallet pass is a display and scanning surface; it is not the ledger.

## Implemented cache behavior

- The service worker is active only in production builds.
- It precaches the root HTML shell, the hashed JavaScript/CSS files referenced by that shell, the manifest, logo, and salon imagery.
- Previously visited SPA routes may open with the cached shell while offline.
- Same-origin static assets use cache-first delivery with background refresh.
- Navigations use network first and fall back only to cached HTML.
- `/api/*`, Supabase, Turnstile, Google Wallet, and other cross-origin requests are never cached by the service worker.
- JavaScript, CSS, image, font, and manifest requests never fall back to HTML. A missing offline asset fails explicitly instead of producing a blank page through a MIME mismatch.
- Runtime caching is capped so old content-hashed assets and visited routes cannot grow storage indefinitely across deployments.
- Service-worker upgrades remove only caches owned by this application.

Opening the shell does not mean an operation is available. The interface must show a clear connectivity state and disable server-dependent controls when their request cannot be completed.

## Allowed while offline

- Open a previously loaded application shell and static salon information.
- Display information already held by the running page without claiming it is current.
- Keep an already validated customer action sheet open if the connection drops after the online scan.
- Save one signed standard visit from that already validated sheet. It is shown as saved for sync, not as a committed balance update.
- Display the Google Wallet pass using Wallet's native behavior. The pass balance may be stale until Wallet receives an update.

## Always online

The following operations require a successful, authenticated server transaction:

- Customer enrollment, OTP verification, account recovery, or phone-number changes.
- Staff/admin login, device enrollment, role changes, or PIN changes.
- New barcode validation, customer search, and balance lookup.
- Reward redemption, balance reduction, refunds, manual adjustments, and undo.
- Reward configuration, staff management, tenant settings, and reports.
- Google Wallet pass creation, restoration, update, suspension, or revocation.

The offline visit state is deliberately labeled as saved and provisional. A normal success state is shown only after the API returns the committed ledger result.

## Signed earn-only queue

The staff app implements a narrow recovery queue for the case where a customer was validated online and the connection drops before the cashier confirms the standard visit. It does not maintain an offline customer directory and cannot validate a newly presented rotating Wallet code without the server.

Each queued visit includes:

- the tenant, staff membership, customer membership, device, exact occurrence time, and a random event ID;
- an ECDSA P-256/SHA-256 signature made by a non-extractable private key stored in that counter browser;
- an idempotency key bound to the enrolled device and event ID;
- a 24-hour server acceptance limit and the same authoritative balance, role, tenant, and duplicate checks used by online visits;
- a maximum of 50 locally retained events and a visible saved/syncing state.

Only a single positive standard visit can enter the queue. Custom points, redemptions, undo, customer creation, manual adjustments, staff actions, and configuration changes remain online-only. Failed synchronization remains visible to staff and stops ordered processing; it is never silently converted into a success.

Closing and reopening the browser preserves queued visits, which resume syncing after the staff session is restored online. Clearing site data, reinstalling the PWA, losing the device, or removing its enrollment deletes the local private key and can remove pending work. The cashier must understand that queued earnings are provisional until synchronized.

## Offline verification

Test against an HTTPS Preview or Production deployment because the service worker is disabled during normal Vite development:

1. Load `/`, `/staff`, and `/admin` online and wait for the service worker to become active.
2. Reload once online so the active worker observes and caches the current assets.
3. Disable the network and reload each previously visited route.
4. Confirm the shell and static assets render without a blank screen.
5. Confirm JavaScript responses have a JavaScript content type and never contain `<!doctype html>`.
6. Confirm `/api/*` requests fail rather than returning cached data.
7. Drop the connection after a valid scan, save one standard visit, and confirm it is labeled as waiting for sync.
8. Confirm redemption, custom points, undo, adjustment, and admin controls cannot report success offline.
9. Restore the network and confirm the signed visit commits exactly once and the queue clears.
10. Deploy a new asset-hashed build and confirm the new worker activates and old application caches are removed.

Run these checks on the actual Android and staff devices used at the salon, including a throttled and intermittently disconnected network.
