import { tenantBySlug } from '../../domain.js'
import { forbidden } from '../../errors.js'
import { api, body, method, ok } from '../../http.js'
import { authRequest } from '../../supabase.js'
import { phoneE164, record, stringField, tenantSlug } from '../../validation.js'

interface VerifyResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  token_type: string
  user: { id: string; phone?: string; user_metadata?: Record<string, unknown> }
}

export default api(async (request, response) => {
  method(request, ['POST'])
  const input = record(body(request))
  const slug = tenantSlug(stringField(input, 'tenantSlug', { max: 80 }))
  const phone = phoneE164(stringField(input, 'phone', { max: 20 }))
  const code = stringField(input, 'code', { min: 6, max: 8, pattern: /^\d{6,8}$/ })!
  await tenantBySlug(slug)
  const session = await authRequest<VerifyResponse>('verify', { type: 'sms', phone, token: code })
  if (session.user.phone && session.user.phone !== phone) forbidden('The verification code does not match this phone number.')
  ok(response, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at,
    tokenType: session.token_type,
    user: { id: session.user.id, phone: session.user.phone ?? phone },
  })
})
