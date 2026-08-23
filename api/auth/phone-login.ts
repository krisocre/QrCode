import { config } from '../../server/config.js'
import { randomHex } from '../../server/crypto.js'
import { tenantBySlug } from '../../server/domain.js'
import { ApiError } from '../../server/errors.js'
import { api, body, ipAddress, method, ok } from '../../server/http.js'
import { reservePhoneAuthenticationAttempt } from '../../server/phone-auth.js'
import { authAdminRequest, authRequest, db } from '../../server/supabase.js'
import { phoneE164, record, stringField, tenantSlug } from '../../server/validation.js'

interface PasswordSession {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  token_type: string
  user: { id: string; phone?: string | null }
}

interface AdminUser {
  id: string
}

async function userForPhone(phone: string, tenantSlugValue: string, password: string): Promise<void> {
  const profiles = await db<Array<{ id: string }>>('profiles', {
    query: { select: 'id', phone_e164: `eq.${phone}`, limit: 1 },
  })
  const existing = profiles[0]
  if (existing) {
    await authAdminRequest(`users/${encodeURIComponent(existing.id)}`, {
      method: 'PUT',
      body: { password, phone_confirm: true },
    })
    return
  }

  const user = await authAdminRequest<AdminUser>('users', {
    body: {
      phone,
      phone_confirm: true,
      password,
      user_metadata: { tenant_slug: tenantSlugValue },
    },
  })
  await db('profiles', {
    method: 'POST',
    body: { id: user.id, first_name: 'Member', last_name: '', phone_e164: phone },
  })
}

export default api(async (request, response) => {
  method(request, ['POST'])
  if (!config.allowUnverifiedPhoneLogin) {
    throw new ApiError(409, 'unverified_phone_login_disabled', 'Phone-only sign-in is not enabled.')
  }
  const input = record(body(request))
  const slug = tenantSlug(stringField(input, 'tenantSlug', { max: 80 }))
  const phone = phoneE164(stringField(input, 'phone', { max: 20 }))
  const tenant = await tenantBySlug(slug)
  await reservePhoneAuthenticationAttempt({ tenantId: tenant.id, phone, ip: ipAddress(request) })
  const password = randomHex(32)
  await userForPhone(phone, slug, password)

  // The random password never leaves the server; the browser receives only a normal Supabase session.
  const session = await authRequest<PasswordSession>('token?grant_type=password', { phone, password })
  ok(response, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at,
    tokenType: session.token_type,
    user: { id: session.user.id, phone: session.user.phone ?? phone },
  })
})
