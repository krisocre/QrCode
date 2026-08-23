# Production database

The files in `migrations/` are the authoritative Supabase/PostgreSQL schema.
Apply them once, in lexical order, to a fresh project. `schema.sql` is only a
pointer and must not be executed as a replacement for the migrations.

## Apply

For Supabase CLI projects, copy the SQL files unchanged into
`supabase/migrations/`, keep their filenames, and run:

```powershell
supabase db push
```

For a direct PostgreSQL connection, set a temporary `SUPABASE_DB_URL` in the shell
and stop on the first error:

```powershell
Get-ChildItem database/migrations/*.sql |
  Sort-Object Name |
  ForEach-Object { psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f $_.FullName }
```

Apply `database/seed.example.sql` only after reviewing every `REPLACE` value.
It contains no user, PIN, API key, Wallet credential, or service-account secret.

## Identity model

- `profiles.id` is a Supabase `auth.users.id` and represents a person who signs
  in through Supabase Auth.
- `tenant_memberships.id` is the ID used by all loyalty RPCs. A customer or
  owner always has an Auth profile. A PIN-only cashier may have a null
  `profile_id`; their server-issued staff session is stored separately.
- Never accept a tenant ID from a cashier action. The RPC derives it from the
  authenticated actor membership and verifies every composite tenant foreign
  key again inside PostgreSQL.

## Server-only boundaries

Only the Supabase `service_role` may execute mutation RPCs. Browser roles get
RLS-filtered reads and no direct table mutations. The API must authenticate its
customer, owner, or staff session before calling an RPC with the service role.

`wallet_barcode_credentials.secret_ciphertext` is AES-GCM ciphertext produced
by the API with `QR_SIGNING_SECRET`; it is never a raw TOTP seed. Google
Wallet uses an 8-digit, 60-second rotating value. The API verifies the presented
value, then passes the resolved credential ID into
`confirm_loyalty_transaction`.

Offline visits require all of the following:

- a registered device with an ECDSA P-256 public JWK;
- an API-verified device signature;
- `metadata.deviceEventId` and `metadata.signatureVerified = true`;
- an idempotency key shaped as `offline:<device-id>:<device-event-id>`;
- an `occurred_at` no older than 24 hours and no more than five minutes ahead.

Only positive visit earning can be queued offline. Points corrections,
redemptions, balance reductions, staff administration, and device enrollment
remain online-only.

## Bootstrap order

1. Apply all migrations.
2. Insert the tenant and reward catalog (the example seed is a starting point).
3. Let the owner create a real Supabase Auth account.
4. From trusted server code call `bootstrap_tenant_owner` once.
5. Enroll a store device with `admin_enroll_device`.
6. Create staff with `admin_save_staff`, then grant device access with
   `admin_set_device_staff_access`.
7. Add the Google `wallet_classes` row after receiving the Wallet issuer ID.

Device removal must call `admin_revoke_device`. It atomically revokes the
device, all staff assignments, and every active staff session on that device,
then records one immutable `device.revoked` audit event. Do not PATCH the device
table directly from an admin endpoint.

Owner program and salon display changes must call `admin_update_program`. Its
original six parameters remain valid; optional `p_name`, `p_wallet_brand`, and
`p_public_info` parameters update the display fields atomically with the loyalty
settings. The two JSON parameters are top-level merge patches, while SQL `null`
leaves that object unchanged. The RPC records the changed field names without
copying customer-facing contact or location values into the audit log.

## Scheduled work

Call `claim_wallet_sync_jobs` from the Wallet sync worker and finish every claim
with `finish_wallet_sync_job`. Claims use `FOR UPDATE SKIP LOCKED`, retry with
exponential backoff, and move to `dead_letter` after eight attempts.

Run `run_loyalty_maintenance()` daily from a trusted cron. It expires temporary
redemptions and removes old OTP, login-attempt, staff-session, and idempotency
records. It never deletes transaction-ledger or audit rows.
