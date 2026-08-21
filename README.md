# Luxe Hair Studio Loyalty

A multi-tenant, offline-ready loyalty PWA with customer, cashier, and owner interfaces.

## Run locally

```powershell
npm install
npm run dev
```

- Customer wallet: `http://localhost:5173/`
- Staff portal: `http://localhost:5173/staff`
- Owner portal: `http://localhost:5173/admin`
- Returning customer: `(416) 555-0182`
- Demo OTP: `2468`
- Demo staff PIN: `4826`
- Demo owner PIN: `7391`

Tenant selection comes from `?tenant=<slug>`. The default tenant is `juniper`; the seeded `northline` tenant demonstrates isolated point-based data at `/admin?tenant=northline` with owner PIN `8642`.

The demo stores tenant-scoped profiles, rewards, rotating barcodes, redemptions, OTP request counters, and immutable transactions locally. `BroadcastChannel` pushes committed updates to open customer, staff, and owner tabs. Customer sessions are encrypted with AES-GCM before persistence.

Set `VITE_TURNSTILE_SITE_KEY` to render Cloudflare Turnstile during phone onboarding. Without it, a clearly marked local human-check control keeps the evaluation flow usable. The production OTP endpoint must validate the Turnstile token and enforce the included phone/IP rate-limit schema before sending SMS.

## Production boundary

The browser adapter in `src/lib/store.ts` enforces tenant-qualified reads, role authorization, three OTP requests per phone/device per hour, rotating 60-second identifiers, 30-second scan debounce, five-minute redemption expiry, and 60-second undo. It is suitable for product evaluation and offline demonstrations, not as the source of truth for multiple physical devices.

For deployment, replace that adapter with authenticated API calls backed by `database/schema.sql`. Execute balance mutations in one server-side database transaction and broadcast tenant-filtered committed rows over a realtime channel. SMS OTP delivery, barcode signing, Turnstile verification, and staff/owner identity verification belong in that server boundary; visible demo credentials are intentionally non-production.

## Checks

```powershell
npm run build
npm run test:e2e
```
