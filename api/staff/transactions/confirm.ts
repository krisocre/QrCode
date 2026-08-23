import { requireStaffActor } from '../../../server/auth.js'
import { api, body, method, ok } from '../../../server/http.js'
import { confirmTransaction } from '../../../server/transactions.js'
import { enumField, integerField, record, stringField, uuid } from '../../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const actor = await requireStaffActor(request)
  const input = record(body(request))
  const customerId = uuid(stringField(input, 'customerId', { max: 40 }), 'customerId')
  const kind = enumField(input, 'kind', ['visit', 'points', 'redeem'] as const)
  const source = enumField(input, 'source', ['scan', 'manual'] as const)
  const points = integerField(input, 'points', { min: 1, max: 100_000, optional: true })
  const rewardValue = stringField(input, 'rewardId', { max: 40, optional: true })
  const rewardId = rewardValue ? uuid(rewardValue, 'rewardId') : undefined
  const scanToken = stringField(input, 'scanToken', { max: 4096, optional: true })
  const occurredAt = stringField(input, 'occurredAt', { max: 40, optional: true })
  const deviceEventId = stringField(input, 'deviceEventId', { max: 40, optional: true })
  const deviceSignature = stringField(input, 'deviceSignature', { max: 256, optional: true })
  ok(response, await confirmTransaction(request, actor, {
    customerId, kind, source, points, rewardId, scanToken, occurredAt, deviceEventId, deviceSignature,
  }), 201)
})
