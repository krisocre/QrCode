export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

export function badRequest(message: string, details?: unknown): never {
  throw new ApiError(400, 'invalid_request', message, details)
}

export function unauthorized(message = 'Authentication is required.'): never {
  throw new ApiError(401, 'unauthorized', message)
}

export function forbidden(message = 'You do not have access to this action.'): never {
  throw new ApiError(403, 'forbidden', message)
}

export function notFound(message = 'The requested resource was not found.'): never {
  throw new ApiError(404, 'not_found', message)
}

export function conflict(code: string, message: string, details?: unknown): never {
  throw new ApiError(409, code, message, details)
}

export function tooManyRequests(message: string, retryAfterSeconds?: number): never {
  throw new ApiError(429, 'rate_limited', message, retryAfterSeconds ? { retryAfterSeconds } : undefined)
}
