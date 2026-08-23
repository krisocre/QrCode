import { requireCustomerActor } from '../../server/auth.js'
import { api, body, method, ok } from '../../server/http.js'
import { syncWalletPass } from '../../server/wallet-service.js'
import { enumField, record } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const actor = await requireCustomerActor(request)
  const input = record(body(request))
  enumField(input, 'action', ['issue', 'restore'] as const)
  ok(response, await syncWalletPass(actor.id, actor.tenantId))
})
