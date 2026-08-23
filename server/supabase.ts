import { config } from './config.js'
import { ApiError } from './errors.js'
import { upstreamFetch } from './network.js'
import type { SupabaseUser } from './types.js'

interface RequestOptions {
  method?: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  accessToken?: string
  prefer?: string
  single?: boolean
}

function queryString(query: RequestOptions['query']): string {
  const values = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) values.set(key, String(value))
  }
  const encoded = values.toString()
  return encoded ? `?${encoded}` : ''
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = config.supabaseSecretKey
  return {
    apikey: key,
    ...(key.split('.').length === 3 ? { Authorization: `Bearer ${key}` } : {}),
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function decode(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function providerMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Record<string, unknown>
  return String(value.message ?? value.msg ?? value.error_description ?? value.error ?? fallback)
}

function databaseError(payload: unknown, providerStatus: number): ApiError {
  const item = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const code = typeof item.code === 'string' ? item.code : ''
  const message = providerMessage(payload, 'The database rejected this request.')
  if (code === '23505') return new ApiError(409, 'already_exists', 'That value is already in use.')
  if (code === '23503') return new ApiError(409, 'resource_in_use', 'This item is still used by another record.')
  if (code === '42501') return new ApiError(403, 'forbidden', 'You do not have access to this action.')
  if (code === 'P0002') return new ApiError(404, 'not_found', 'The requested record was not found.')
  if (code === '53300') return new ApiError(429, 'rate_limited', 'Too many attempts. Try again later.')
  if (code === '22003' && /balance|reward/i.test(message)) return new ApiError(409, 'insufficient_balance', 'The customer does not have enough balance for this action.')
  if (code === 'P0001' && /duplicate scan/i.test(message)) return new ApiError(409, 'duplicate_scan', 'This customer was already scanned. Wait a few seconds and try again.')
  if (code === '22023' && /undo|eligible/i.test(message)) return new ApiError(409, 'undo_window_closed', 'This transaction can no longer be undone.')
  if (providerStatus >= 500) return new ApiError(502, 'database_unavailable', 'The database is temporarily unavailable.')
  return new ApiError(400, 'database_request_rejected', 'The database could not accept this request.')
}

export async function db<T>(resource: string, options: RequestOptions = {}): Promise<T> {
  const headers = serviceHeaders({
    ...(options.prefer ? { Prefer: options.prefer } : {}),
    ...(options.single ? { Accept: 'application/vnd.pgrst.object+json' } : {}),
  })
  const response = await upstreamFetch(`${config.supabaseUrl}/rest/v1/${resource}${queryString(options.query)}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }, { code: 'database_unavailable', message: 'The database is temporarily unavailable.' })
  const payload = await decode(response)
  if (!response.ok) {
    if (response.status === 404 || response.status === 406) throw new ApiError(404, 'not_found', 'The requested record was not found.')
    throw databaseError(payload, response.status)
  }
  return payload as T
}

export async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  return db<T>(`rpc/${name}`, { method: 'POST', body: params, prefer: 'return=representation' })
}

export async function authRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await upstreamFetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { code: 'authentication_unavailable', message: 'Phone authentication is temporarily unavailable.' })
  const payload = await decode(response)
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status === 400 || response.status === 422 ? 400 : 502
    throw new ApiError(status, response.status === 429 ? 'rate_limited' : 'authentication_failed',
      response.status === 429 ? 'Too many authentication attempts. Try again later.' : providerMessage(payload, 'Authentication failed.'))
  }
  return payload as T
}

export async function getSupabaseUser(accessToken: string): Promise<SupabaseUser> {
  const response = await upstreamFetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
  }, { code: 'authentication_unavailable', message: 'Authentication is temporarily unavailable.' })
  const payload = await decode(response)
  if (!response.ok) throw new ApiError(401, 'invalid_access_token', 'Your sign-in has expired. Sign in again.')
  return payload as SupabaseUser
}

export async function logoutSupabaseUser(accessToken: string): Promise<void> {
  const response = await upstreamFetch(`${config.supabaseUrl}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
  }, { code: 'authentication_unavailable', message: 'Authentication is temporarily unavailable.' })
  if (!response.ok && response.status !== 401) throw new ApiError(502, 'logout_failed', 'The server could not complete sign-out.')
}
