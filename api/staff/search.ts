import { requireStaffActor } from '../../server/auth.js'
import { searchCustomers } from '../../server/domain.js'
import { api, method, ok, query } from '../../server/http.js'
import { safeSearch } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const actor = await requireStaffActor(request)
  ok(response, { customers: await searchCustomers(actor.tenantId, safeSearch(query(request, 'q'))) })
})
