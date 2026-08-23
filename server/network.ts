import { ApiError } from './errors.js'

export async function upstreamFetch(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; code: string; message: string },
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
  } catch {
    throw new ApiError(502, options.code, options.message)
  }
}
