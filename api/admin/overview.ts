import { adminOverview } from '../../server/admin-domain.js'
import { requireSupabaseActor } from '../../server/auth.js'
import { api, method, ok } from '../../server/http.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const actor = await requireSupabaseActor(request, ['owner'])
  ok(response, await adminOverview(actor))
})
