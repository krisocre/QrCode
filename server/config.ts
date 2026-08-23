import { ApiError } from './errors.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new ApiError(503, 'configuration_missing', `Server configuration ${name} is missing.`)
  return value
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

function secret(name: string, fallback?: string): string {
  const value = optional(name) ?? (fallback ? optional(fallback) : undefined)
  if (!value) throw new ApiError(503, 'configuration_missing', `Server configuration ${name} is missing.`)
  if (value.length < 32) throw new ApiError(503, 'configuration_invalid', `${name} must be at least 32 characters.`)
  return value
}

function baseUrl(value: string): string {
  return value.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '')
}

export const config = {
  get supabaseUrl() {
    return baseUrl(required('VITE_SUPABASE_URL'))
  },
  get supabasePublishableKey() {
    return optional('VITE_SUPABASE_PUBLISHABLE_KEY') ?? required('VITE_SUPABASE_ANON_KEY')
  },
  get supabaseSecretKey() {
    return optional('SUPABASE_SECRET_KEY') ?? required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get sessionSigningSecret() {
    return secret('STAFF_SESSION_SECRET')
  },
  get qrSigningSecret() {
    return secret('QR_SIGNING_SECRET')
  },
  get tokenHashPepper() {
    return this.qrSigningSecret
  },
  get appUrl() {
    return new URL(required('APP_URL')).origin
  },
  get googleWalletIssuerId() {
    return required('GOOGLE_WALLET_ISSUER_ID')
  },
  get googleWalletServiceAccountEmail() {
    return required('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL')
  },
  get googleWalletPrivateKey() {
    return required('GOOGLE_WALLET_PRIVATE_KEY').replace(/\\n/g, '\n')
  },
  get googleWalletClassSuffix() {
    return optional('GOOGLE_WALLET_CLASS_SUFFIX') ?? 'loyalty'
  },
  get googleWalletOrigins() {
    const configured = optional('GOOGLE_WALLET_ORIGINS')
    return configured ? configured.split(',').map((origin) => origin.trim()).filter(Boolean) : [new URL(this.appUrl).origin]
  },
  get cronSecret() {
    return secret('CRON_SECRET')
  },
}
