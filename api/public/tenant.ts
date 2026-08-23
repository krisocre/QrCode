import { api, method, ok, query } from '../../server/http.js'
import { publicTenant } from '../../server/domain.js'
import { tenantSlug } from '../../server/validation.js'

export default api(async (request, response) => {
  method(request, ['GET'])
  const result = await publicTenant(tenantSlug(query(request, 'slug')))
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  ok(response, result)
})
