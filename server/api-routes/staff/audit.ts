import { requireStaffActor } from '../../auth.js'
import { api, method, ok, query } from '../../http.js'
import { auditFeed } from '../../staff-domain.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const actor = await requireStaffActor(request)
  const requested = Number(query(request, 'limit') ?? 100)
  const limit = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 200)) : 100
  ok(response, { transactions: await auditFeed(actor.tenantId, limit) })
})
