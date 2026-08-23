# Luxe Hair Studio Loyalty

A multi-tenant, wallet-first loyalty system for hair salons. Customers enroll by phone and add a rotating loyalty pass to Google Wallet. Cashiers scan that pass from a mobile camera, and owners manage rewards, staff, devices, customers, and program settings from `/admin`.

## Applications

- Customer enrollment and membership: `/`
- Cashier scanner and transaction log: `/staff`
- Phone-friendly owner portal: `/admin`
- Tenant selection: `?tenant=luxe-hair-studio`

Admin controls are never rendered in the customer app. The owner-dashboard link always leads to the protected `/admin` route.

## Architecture

- React 18 and Vite PWA frontend
- One catch-all Vercel Function at `api/[...path].ts`
- Supabase Auth, Postgres, RLS, Realtime, and atomic loyalty RPCs
- Supabase phone authentication with an optional, temporary no-SMS pilot mode
- Google Wallet LoyaltyClass/LoyaltyObject issuance with 60-second rotating QR values
- Signed, earn-only offline recovery for a visit validated before a connection drop
- Server-side idempotency, 30-second duplicate blocking, 60-second undo, immutable ledger/audit rows, and Wallet sync outbox

## Local demo

The normal Vite development server defaults to isolated demo data and needs no provider keys:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. Demo credentials remain local-only and production builds fail closed unless explicitly configured.

## Production setup

1. Copy the variable names from `.env.example` into ignored `.env.local` and provide the real environment values.
2. Apply `database/migrations/*.sql` in lexical order to a clean Supabase project.
3. Review and adapt `database/seed.example.sql`; never apply the example unchanged in production.
4. Sign in once with the owner's real phone, then bootstrap that Auth UUID as documented in `database/README.md`.
5. For a real customer launch, configure Supabase Phone Auth with Twilio and set appropriate OTP and rate-limit policies. For a limited setup pilot only, set `ALLOW_UNVERIFIED_PHONE_LOGIN=true`; it intentionally skips ownership verification and must not remain enabled for public use.
6. Create the Google Wallet issuer/service account and grant it issuer access.
7. Deploy to Vercel. Hobby-compatible deployments run database maintenance daily; Wallet updates happen directly when a customer adds their pass or staff confirms a transaction.
8. Complete every gate in `docs/launch-checklist.md` on real Android and counter devices.

Use `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` for new Supabase keys. The legacy `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` names remain accepted during migration.

Full provider, migration, security, pilot, backup, monitoring, and rollback instructions are in `docs/production-runbook.md`.

## Verification

```powershell
npm run typecheck
npm run test:unit
npm run test:e2e
npm run test:e2e:production
npm run build
npm audit
```

Production configuration and live provider behavior must still be validated against a staging project because automated tests use mocked network boundaries.
