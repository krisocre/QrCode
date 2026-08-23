import { api, header, method, ok } from '../../server/http.js'
import { logoutSupabaseUser } from '../../server/supabase.js'
import { unauthorized } from '../../server/errors.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const authorization = header(request, 'authorization')
  if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim()) unauthorized()
  await logoutSupabaseUser(authorization.slice(7).trim())
  ok(response, { ok: true })
})
