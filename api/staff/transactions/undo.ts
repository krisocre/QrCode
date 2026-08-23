import { requireStaffActor } from '../../../server/auth.js'
import { api, body, method, ok } from '../../../server/http.js'
import { undoTransaction } from '../../../server/transactions.js'
import { record, stringField, uuid } from '../../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const actor = await requireStaffActor(request)
  const input = record(body(request))
  const transactionId = uuid(stringField(input, 'transactionId', { max: 40 }), 'transactionId')
  const reason = stringField(input, 'reason', { max: 240, optional: true })
  ok(response, await undoTransaction(request, actor, transactionId, reason), 201)
})
