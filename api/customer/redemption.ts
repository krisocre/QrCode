import { requireCustomerActor } from '../../server/auth.js'
import { createRedemption } from '../../server/domain.js'
import { api, body, method, ok } from '../../server/http.js'
import { record, stringField, uuid } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const actor = await requireCustomerActor(request)
  const input = record(body(request))
  const rewardId = uuid(stringField(input, 'rewardId', { max: 40 }), 'rewardId')
  ok(response, await createRedemption(actor, rewardId), 201)
})
