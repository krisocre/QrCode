import { requireSupabaseUser } from '../../auth.js'
import { customerBundle, tenantBySlug } from '../../domain.js'
import { forbidden } from '../../errors.js'
import { api, body, header, method, ok } from '../../http.js'
import { rpc } from '../../supabase.js'
import type { MembershipRow } from '../../types.js'
import { booleanField, record, stringField, tenantSlug, uuid } from '../../validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const user = await requireSupabaseUser(request)
  const input = record(body(request))
  const slug = tenantSlug(stringField(input, 'tenantSlug', { max: 80 }))
  const firstName = stringField(input, 'firstName', { max: 80 })!
  const lastName = stringField(input, 'lastName', { max: 80, optional: true }) ?? ''
  if (!booleanField(input, 'consentAccepted')) forbidden('Accept the loyalty program terms to continue.')
  if (!user.phone) forbidden('A verified phone number is required to enroll.')
  const tenant = await tenantBySlug(slug)
  const requestedTenantId = uuid(header(request, 'x-tenant-id'), 'X-Tenant-Id')
  if (tenant.id !== requestedTenantId) forbidden('This enrollment request belongs to a different business.')
  const memberships = await rpc<MembershipRow[]>('enroll_customer', {
    p_profile_id: user.id,
    p_tenant_slug: slug,
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone_e164: user.phone,
    p_consent_version: '2026-08-22',
  })
  if (!memberships[0]) throw new Error('Enrollment did not create an account.')
  ok(response, await customerBundle({
    id: memberships[0].id,
    tenantId: tenant.id,
    role: 'customer',
    firstName,
    lastName,
    authType: 'supabase',
  }), 201)
})
