import { requireStaffActor } from '../../auth.js'
import { searchCustomers } from '../../domain.js'
import { api, method, ok, query } from '../../http.js'
import { safeSearch } from '../../validation.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const actor = await requireStaffActor(request)
  ok(response, { customers: await searchCustomers(actor.tenantId, safeSearch(query(request, 'q'))) })
})
