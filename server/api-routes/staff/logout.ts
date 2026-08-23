import { revokeCurrentStaffSession } from '../../auth.js'
import { api, method, ok } from '../../http.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  await revokeCurrentStaffSession(request)
  ok(response, { ok: true })
})
