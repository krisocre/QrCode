import { adjustCustomer, listCustomers } from '../../server/admin-domain.js'
import { requireSupabaseActor } from '../../server/auth.js'
import { badRequest } from '../../server/errors.js'
import { api, body, header, method, ok, query } from '../../server/http.js'
import { integerField, record, safeSearch, stringField, uuid } from '../../server/validation.js'

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'PATCH'])
  const actor = await requireSupabaseActor(request, ['owner'])
  if (actual === 'GET') {
    const raw = query(request, 'q')?.trim()
    return ok(response, { customers: await listCustomers(actor.tenantId, raw ? safeSearch(raw) : undefined) })
  }
  const input = record(body(request))
  const customerId = uuid(stringField(input, 'customerId', { max: 40 }), 'customerId')
  const stampsDelta = integerField(input, 'stampsDelta', { min: -50, max: 50, optional: true }) ?? 0
  const pointsDelta = integerField(input, 'pointsDelta', { min: -1_000_000, max: 1_000_000, optional: true }) ?? 0
  if (!stampsDelta && !pointsDelta) badRequest('Enter a non-zero balance adjustment.')
  const reason = stringField(input, 'reason', { min: 3, max: 240 })!
  const key = header(request, 'idempotency-key')?.trim()
  if (!key || key.length < 8 || key.length > 200 || !/^[A-Za-z0-9:._-]+$/.test(key)) badRequest('Send a valid Idempotency-Key header.')
  ok(response, await adjustCustomer(actor, { customerId, stampsDelta, pointsDelta, reason, idempotencyKey: key }), 201)
})
