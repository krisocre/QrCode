import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/production',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4184',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'cross-env VITE_APP_MODE=production VITE_DEMO_MODE=false VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA VITE_DEFAULT_TENANT_SLUG=juniper npm run build && npm run preview -- --host 127.0.0.1 --port 4184',
    url: 'http://127.0.0.1:4184',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
