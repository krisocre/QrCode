import { issueStaffSession, verifyEnrolledDeviceToken } from '../../auth.js'
import { config } from '../../config.js'
import { pepperedHash } from '../../crypto.js'
import { tenantBySlug } from '../../domain.js'
import { forbidden } from '../../errors.js'
import { api, body, ipAddress, method, ok } from '../../http.js'
import { rpc } from '../../supabase.js'
import { record, stringField, tenantSlug } from '../../validation.js'

interface UnlockResult {
  membership_id: string
  tenant_id: string
  role: 'staff' | 'owner'
  first_name: string
  last_name: string
  staff_code: string | null
}

export default api(async (request, response) => {
  method(request, ['POST'])
  const input = record(body(request))
  const slug = tenantSlug(stringField(input, 'tenantSlug', { max: 80 }))
  const pin = stringField(input, 'pin', { min: 4, max: 4, pattern: /^\d{4}$/ })!
  const deviceToken = stringField(input, 'deviceToken', { min: 40, max: 4096 })!
  const tenant = await tenantBySlug(slug)
  const device = await verifyEnrolledDeviceToken(deviceToken, tenant.id)
  const result = await rpc<UnlockResult | UnlockResult[]>('authenticate_staff_pin', {
    p_tenant_slug: slug,
    p_pin: pin,
    p_device_id: device.sub,
    p_ip_hash: pepperedHash(ipAddress(request), config.tokenHashPepper),
  })
  const member = Array.isArray(result) ? result[0] : result
  if (!member || member.tenant_id !== tenant.id) forbidden('PIN was not accepted for this device.')
  const session = await issueStaffSession({
    membershipId: member.membership_id,
    tenantId: member.tenant_id,
    role: member.role,
    firstName: member.first_name,
    lastName: member.last_name,
    staffCode: member.staff_code,
    deviceId: device.sub,
  })
  ok(response, {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    staff: {
      id: member.membership_id,
      role: member.role,
      firstName: member.first_name,
      lastName: member.last_name,
      staffCode: member.staff_code,
    },
  })
})
