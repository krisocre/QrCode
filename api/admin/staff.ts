import { adminStaff, revokeStaff, saveStaff } from '../../server/admin-domain.js'
import { requireSupabaseActor } from '../../server/auth.js'
import { api, body, method, ok, query } from '../../server/http.js'
import { record, stringField, uuid } from '../../server/validation.js'

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'POST', 'PATCH', 'DELETE'])
  const actor = await requireSupabaseActor(request, ['owner'])
  if (actual === 'GET') return ok(response, { staff: await adminStaff(actor.tenantId) })
  if (actual === 'DELETE') {
    await revokeStaff(actor, uuid(query(request, 'id'), 'id'))
    return ok(response, { ok: true })
  }
  const input = record(body(request))
  const idValue = actual === 'PATCH' ? stringField(input, 'id', { max: 40 }) : undefined
  const staff = await saveStaff(actor, {
    id: idValue ? uuid(idValue, 'id') : undefined,
    firstName: stringField(input, 'firstName', { max: 80 })!,
    lastName: stringField(input, 'lastName', { max: 80, optional: true }) ?? '',
    staffCode: stringField(input, 'staffCode', { min: 2, max: 12, pattern: /^[A-Za-z0-9]+$/ })!.toUpperCase(),
    pin: actual === 'PATCH'
      ? (stringField(input, 'pin', { min: 4, max: 4, pattern: /^\d{4}$/, optional: true }) ?? '')
      : stringField(input, 'pin', { min: 4, max: 4, pattern: /^\d{4}$/ })!,
  })
  ok(response, { staff }, actual === 'POST' ? 201 : 200)
})
