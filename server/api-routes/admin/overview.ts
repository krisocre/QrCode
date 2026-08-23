import { adminOverview } from '../../admin-domain.js'
import { requireSupabaseActor } from '../../auth.js'
import { api, method, ok } from '../../http.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const actor = await requireSupabaseActor(request, ['owner'])
  ok(response, await adminOverview(actor))
})
