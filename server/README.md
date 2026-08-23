# Production API contract

All endpoints accept and return JSON. Failures use:

```json
{ "error": { "code": "stable_code", "message": "Human-readable message" }, "requestId": "uuid" }
```

Customer and owner calls use a Supabase access token in `Authorization: Bearer <token>` and send
`X-Tenant-Id: <tenant UUID>`. Staff calls use the short-lived token returned by `/api/staff/unlock`.
Balance mutations must include a unique `Idempotency-Key` header.

## Routes

- `GET /api/health`
- `GET /api/public/tenant?slug=<slug>`
- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/customer/enroll`
- `GET|PATCH /api/customer/profile`
- `POST /api/customer/wallet`
- `POST /api/customer/redemption`
- `POST /api/staff/unlock`
- `POST /api/staff/logout`
- `GET /api/staff/search?q=<name-or-phone>`
- `GET /api/staff/customer?id=<membership UUID>`
- `POST /api/staff/scan`
- `GET /api/staff/audit`
- `POST /api/staff/transactions/confirm`
- `POST /api/staff/transactions/undo`
- `GET /api/admin/overview`
- `GET|POST|PATCH|DELETE /api/admin/staff`
- `GET|POST|PATCH|DELETE /api/admin/rewards`
- `GET|PATCH /api/admin/customers`
- `GET|PATCH /api/admin/program`
- `GET|POST|DELETE /api/admin/device-enrollments`
- `POST /api/wallet/sync` for an authenticated on-demand pass sync
- `GET /api/wallet/sync` for the `CRON_SECRET`-authenticated outbox worker
- `GET /api/maintenance` for the `CRON_SECRET`-authenticated cleanup worker

## Google Wallet

The service creates the Google `LoyaltyClass` and `LoyaltyObject` through authenticated REST calls.
The save JWT references only their opaque IDs; customer details and the rotating barcode secret are
not embedded in the link. Each rotating QR has this format:

```text
LUXE1:<opaque-object-suffix>:<totp-timestamp-seconds>:<8-digit-totp>
```

TOTP secrets are encrypted with AES-256-GCM before storage. Google-specific object construction
lives in `google-wallet.ts`, while `wallet-service.ts` keeps membership and synchronization logic
separate so an Apple provider can be added without changing the transaction ledger.

Google save/delete callbacks are deliberately not configured. Those callbacks use encrypted,
signed messages and require Google Tink verification. The system does not depend on callbacks for
issuance, scanning, balance updates, or recovery.

## Offline visit contract

Only a single positive visit can be queued offline. Redemptions, point adjustments, negative
changes, and manual owner changes require a live server response. Store devices generate a
non-exportable ECDSA P-256 key and sign SHA-256 over this exact newline-separated UTF-8 payload:

```text
luxe-offline-visit-v1
<device-id>
<tenant-id>
<staff-membership-id>
<customer-membership-id>
visit
1
<exact-ISO-occurred-at>
<device-event-uuid>
```

The signature is the raw IEEE-P1363 value encoded with base64url. Submission uses
`Idempotency-Key: offline:<device-id>:<device-event-uuid>` and must arrive within 24 hours.

## Server environment

Required values are `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `APP_URL`, `QR_SIGNING_SECRET`,
`STAFF_SESSION_SECRET`, `CRON_SECRET`, `GOOGLE_WALLET_ISSUER_ID`,
`GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_WALLET_PRIVATE_KEY`.

Twilio is configured as the SMS provider in Supabase Auth. The OTP endpoint adds
per-phone and per-IP database-backed request throttling before it calls Supabase.
