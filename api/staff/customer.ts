import { requireStaffActor } from '../../server/auth.js'
import { customerSummary } from '../../server/domain.js'
import { api, method, ok, query } from '../../server/http.js'
import { uuid } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const actor = await requireStaffActor(request)
  ok(response, await customerSummary(uuid(query(request, 'id'), 'id'), actor.tenantId))
})
