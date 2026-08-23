import { enrollDevice, listDevices, revokeDevice } from '../../admin-domain.js'
import { requireSupabaseActor } from '../../auth.js'
import { api, body, method, ok, query } from '../../http.js'
import { publicP256Jwk, record, stringField, uuid } from '../../validation.js'

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'POST', 'DELETE'])
  const actor = await requireSupabaseActor(request, ['owner'])
  if (actual === 'GET') return ok(response, { devices: await listDevices(actor.tenantId) })
  if (actual === 'DELETE') {
    await revokeDevice(actor, uuid(query(request, 'id'), 'id'))
    return ok(response, { ok: true })
  }
  const input = record(body(request))
  const label = stringField(input, 'label', { max: 100 })!
  const publicKeyJwk = publicP256Jwk(input.publicKeyJwk)
  ok(response, await enrollDevice(actor, label, publicKeyJwk), 201)
})
