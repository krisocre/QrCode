import { requireCustomerActor } from '../../auth.js'
import { createRedemption } from '../../domain.js'
import { api, body, method, ok } from '../../http.js'
import { record, stringField, uuid } from '../../validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const actor = await requireCustomerActor(request)
  const input = record(body(request))
  const rewardId = uuid(stringField(input, 'rewardId', { max: 40 }), 'rewardId')
  ok(response, await createRedemption(actor, rewardId), 201)
})
