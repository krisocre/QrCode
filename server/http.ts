import { randomUUID } from 'node:crypto'
import { ApiError, isApiError } from './errors.js'
import type { ApiHandler, ApiRequest, ApiResponse } from './types.js'

const MAX_BODY_BYTES = 32_768
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/

function setCommonHeaders(response: ApiResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
}

export function api(handler: ApiHandler): ApiHandler {
  return async (request, response) => {
    const presentedRequestId = header(request, 'x-request-id')?.trim()
    const requestId = presentedRequestId && REQUEST_ID_PATTERN.test(presentedRequestId)
      ? presentedRequestId
      : randomUUID()
    setCommonHeaders(response)
    response.setHeader('X-Request-Id', requestId)
    try {
      await handler(request, response)
    } catch (error) {
      const known = isApiError(error)
        ? error
        : new ApiError(500, 'internal_error', 'The server could not complete this request.')
      if (!known || known.status >= 500) console.error(`[${requestId}]`, error)
      if (known.status === 429 && typeof known.details === 'object' && known.details && 'retryAfterSeconds' in known.details) {
        response.setHeader('Retry-After', String((known.details as { retryAfterSeconds: number }).retryAfterSeconds))
      }
      if (known.status === 405 && typeof known.details === 'object' && known.details && 'allowed' in known.details) {
        const allowed = (known.details as { allowed?: unknown }).allowed
        if (Array.isArray(allowed) && allowed.every((value) => typeof value === 'string')) {
          response.setHeader('Allow', allowed.join(', '))
        }
      }
      response.status(known.status).json({
        error: { code: known.code, message: known.message, ...(known.details === undefined ? {} : { details: known.details }) },
        requestId,
      })
    }
  }
}

export function method(request: ApiRequest, allowed: readonly string[]): string {
  const actual = (request.method ?? 'GET').toUpperCase()
  if (!allowed.includes(actual)) {
    throw new ApiError(405, 'method_not_allowed', `Use ${allowed.join(' or ')} for this endpoint.`, { allowed })
  }
  return actual
}

export function header(request: ApiRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()] ?? request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function query(request: ApiRequest, key: string): string | undefined {
  const value = request.query[key]
  return Array.isArray(value) ? value[0] : value
}

export function body<T = Record<string, unknown>>(request: ApiRequest): T {
  const raw = request.body
  if (raw == null) return {} as T
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large', 'Request body is too large.')
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.')
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'invalid_json', 'Request body must be a JSON object.')
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_BODY_BYTES) {
    throw new ApiError(413, 'body_too_large', 'Request body is too large.')
  }
  return raw as T
}

export function ipAddress(request: ApiRequest): string {
  const forwarded = header(request, 'x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.socket?.remoteAddress || 'unknown'
}

export function ok(response: ApiResponse, value: unknown, status = 200): void {
  response.status(status).json(value)
}
