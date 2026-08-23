import { revokeCurrentStaffSession } from '../../server/auth.js'
import { api, method, ok } from '../../server/http.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  await revokeCurrentStaffSession(request)
  ok(response, { ok: true })
})
