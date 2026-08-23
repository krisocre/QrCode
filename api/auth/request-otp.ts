import { tenantBySlug } from '../../server/domain.js'
import { api, body, ipAddress, method, ok } from '../../server/http.js'
import { reservePhoneAuthenticationAttempt } from '../../server/phone-auth.js'
import { authRequest } from '../../server/supabase.js'
import { phoneE164, record, stringField, tenantSlug } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const input = record(body(request))
  const slug = tenantSlug(stringField(input, 'tenantSlug', { max: 80 }))
  const phone = phoneE164(stringField(input, 'phone', { max: 20 }))
  const tenant = await tenantBySlug(slug)
  await reservePhoneAuthenticationAttempt({ tenantId: tenant.id, phone, ip: ipAddress(request) })
  await authRequest('otp', {
    phone,
    create_user: true,
    data: { tenant_slug: slug },
  })
  ok(response, { ok: true, retryAfterSeconds: 60 }, 202)
})
