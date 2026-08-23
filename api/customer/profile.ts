import { requireCustomerActor, requireSupabaseUser } from '../../server/auth.js'
import { customerBundle, updateCustomerProfile } from '../../server/domain.js'
import { ApiError } from '../../server/errors.js'
import { api, body, header, method, ok } from '../../server/http.js'
import { db } from '../../server/supabase.js'
import type { Actor, MembershipRow } from '../../server/types.js'
import { record, stringField, uuid } from '../../server/validation.js'

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'PATCH'])
  if (actual === 'GET') {
    const user = await requireSupabaseUser(request)
    const tenantId = uuid(header(request, 'x-tenant-id'), 'X-Tenant-Id')
    const memberships = await db<MembershipRow[]>('tenant_memberships', {
      query: {
        select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at',
        tenant_id: `eq.${tenantId}`,
        profile_id: `eq.${user.id}`,
        role: 'eq.customer',
        status: 'eq.active',
        limit: 1,
      },
    })
    if (!memberships[0]) throw new ApiError(404, 'profile_not_found', 'No customer membership exists for this business yet.')
    const actor: Actor = {
      id: memberships[0].id,
      tenantId,
      role: 'customer',
      firstName: memberships[0].first_name,
      lastName: memberships[0].last_name,
      authType: 'supabase',
    }
    return ok(response, await customerBundle(actor))
  }
  const actor = await requireCustomerActor(request)
  const input = record(body(request))
  const firstName = stringField(input, 'firstName', { max: 80, optional: true })
  const lastName = stringField(input, 'lastName', { min: 0, max: 80, optional: true })
  ok(response, await updateCustomerProfile(actor, { firstName, lastName }))
})
