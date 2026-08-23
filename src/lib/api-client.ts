import { customerAccessToken } from './supabase'

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
  requestId?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  readonly details?: unknown

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message || `Request failed with status ${status}.`)
    this.name = 'ApiError'
    this.status = status
    this.code = body.error?.code || 'request_failed'
    this.requestId = body.requestId
    this.details = body.error?.details
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  accessToken?: string | null
  idempotencyKey?: string
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.accessToken) headers.set('Authorization', `Bearer ${options.accessToken}`)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) throw new ApiError(response.status, (payload || {}) as ApiErrorBody)
  return payload as T
}

export async function authenticatedRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const accessToken = await customerAccessToken()
  if (!accessToken) throw new ApiError(401, { error: { code: 'session_required', message: 'Sign in to continue.' } })
  return apiRequest<T>(path, { ...options, accessToken })
}

export function createIdempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`
}
