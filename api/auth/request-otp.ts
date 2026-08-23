import { config } from '../../server/config.js'
import { pepperedHash } from '../../server/crypto.js'
import { tenantBySlug } from '../../server/domain.js'
import { tooManyRequests } from '../../server/errors.js'
import { api, body, ipAddress, method, ok } from '../../server/http.js'
import { authRequest, db, rpc } from '../../server/supabase.js'
import { phoneE164, record, stringField, tenantSlug } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const input = record(body(request))
  const slug = tenantSlug(stringField(input, 'tenantSlug', { max: 80 }))
  const phone = phoneE164(stringField(input, 'phone', { max: 20 }))
  const tenant = await tenantBySlug(slug)
  const ip = ipAddress(request)
  const phoneHash = pepperedHash(phone, config.tokenHashPepper)
  const ipHash = pepperedHash(ip, config.tokenHashPepper)
  const available = await rpc<boolean>('otp_rate_limit_available', {
    p_tenant_id: tenant.id,
    p_phone_hash: phoneHash,
    p_ip_hash: ipHash,
  })
  if (!available) tooManyRequests('Too many codes requested. Try again in one hour.', 3600)
  await db('otp_requests', {
    method: 'POST',
    body: { tenant_id: tenant.id, phone_hash: phoneHash, ip_hash: ipHash },
  })
  await authRequest('otp', {
    phone,
    create_user: true,
    data: { tenant_slug: slug },
  })
  ok(response, { ok: true, retryAfterSeconds: 60 }, 202)
})
