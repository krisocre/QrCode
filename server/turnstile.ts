import { config } from './config.js'
import { ApiError, forbidden } from './errors.js'
import { upstreamFetch } from './network.js'

interface TurnstileResult {
  success: boolean
  hostname?: string
  action?: string
  'error-codes'?: string[]
}

export async function verifyTurnstile(token: string, remoteIp: string): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) throw new ApiError(503, 'configuration_missing', 'Server configuration TURNSTILE_SECRET_KEY is missing.')
  const response = await upstreamFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
  }, { code: 'human_check_unavailable', message: 'The security check is temporarily unavailable.' })
  const result = await response.json().catch(() => undefined) as TurnstileResult | undefined
  if (!response.ok) throw new ApiError(502, 'human_check_unavailable', 'The security check is temporarily unavailable.')
  if (!result?.success) forbidden('The security check expired or could not be verified. Try again.')
  const expectedHost = new URL(config.appUrl).hostname
  if (result.hostname !== expectedHost) {
    forbidden('The security check was issued for a different site.')
  }
  if (result.action !== 'otp_request') forbidden('The security check was issued for a different action.')
}
