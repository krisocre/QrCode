import { api, method, ok } from '../server/http.js'

export default api((request, response) => {
  method(request, ['GET'])
  const required = [
    'VITE_SUPABASE_URL',
    'APP_URL',
    'QR_SIGNING_SECRET',
    'STAFF_SESSION_SECRET',
    'CRON_SECRET',
    'GOOGLE_WALLET_ISSUER_ID',
    'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_WALLET_PRIVATE_KEY',
  ]
  const configured = required.filter((name) => Boolean(process.env[name]?.trim()))
  const supabaseBrowserKey = Boolean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim())
  const supabaseServerKey = Boolean(process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
  const configuredCount = configured.length + Number(supabaseBrowserKey) + Number(supabaseServerKey)
  const requiredCount = required.length + 2
  ok(response, {
    status: configuredCount === requiredCount ? 'ready' : 'configuration_required',
    configured: configuredCount,
    required: requiredCount,
    time: new Date().toISOString(),
  }, configuredCount === requiredCount ? 200 : 503)
})
