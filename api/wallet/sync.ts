import { requireAnyActor } from '../../server/auth.js'
import { requireCron } from '../../server/cron.js'
import { api, body, method, ok, query } from '../../server/http.js'
import { record, stringField, uuid } from '../../server/validation.js'
import { processWalletSyncJobs } from '../../server/wallet-sync.js'
import { syncWalletPass } from '../../server/wallet-service.js'

export const config = { maxDuration: 60 }

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'POST'])
  if (actual === 'GET') {
    requireCron(request)
    const requested = Number(query(request, 'limit') ?? 20)
    const limit = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 50)) : 20
    return ok(response, await processWalletSyncJobs(limit))
  }
  const actor = await requireAnyActor(request)
  const input = record(body(request))
  const requestedId = stringField(input, 'customerId', { max: 40, optional: true })
  const customerId = actor.role === 'customer'
    ? actor.id
    : uuid(requestedId, 'customerId')
  const result = await syncWalletPass(customerId, actor.tenantId)
  if (actor.role === 'customer') return ok(response, result)
  const { saveUrl: _saveUrl, ...syncStatus } = result
  ok(response, syncStatus)
})
