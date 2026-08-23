import { adminRewards, disableReward, saveReward } from '../../server/admin-domain.js'
import { requireSupabaseActor } from '../../server/auth.js'
import { badRequest } from '../../server/errors.js'
import { api, body, method, ok, query } from '../../server/http.js'
import { integerField, record, stringField, uuid } from '../../server/validation.js'

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'POST', 'PATCH', 'DELETE'])
  const actor = await requireSupabaseActor(request, ['owner'])
  if (actual === 'GET') return ok(response, { rewards: await adminRewards(actor.tenantId) })
  if (actual === 'DELETE') {
    await disableReward(actor, uuid(query(request, 'id'), 'id'))
    return ok(response, { ok: true })
  }
  const input = record(body(request))
  const idValue = actual === 'PATCH' ? stringField(input, 'id', { max: 40 }) : undefined
  const activeValue = input.active
  if (activeValue !== undefined && typeof activeValue !== 'boolean') badRequest('active must be true or false.')
  const reward = await saveReward(actor, {
    id: idValue ? uuid(idValue, 'id') : undefined,
    code: stringField(input, 'code', { min: 2, max: 40, optional: true, pattern: /^[A-Za-z0-9][A-Za-z0-9_-]+$/ })?.toUpperCase(),
    name: stringField(input, 'name', { max: 120 })!,
    description: stringField(input, 'description', { max: 500, optional: true }) ?? '',
    stampCost: integerField(input, 'stampCost', { min: 1, max: 50 })!,
    pointCost: integerField(input, 'pointCost', { min: 1, max: 1_000_000 })!,
    promotion: stringField(input, 'promotion', { max: 120, optional: true }),
    terms: stringField(input, 'terms', { max: 1000, optional: true }),
    active: activeValue as boolean | undefined,
  })
  ok(response, { reward }, actual === 'POST' ? 201 : 200)
})
