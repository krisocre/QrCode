import { api, header, method, ok } from '../../http.js'
import { logoutSupabaseUser } from '../../supabase.js'
import { unauthorized } from '../../errors.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const authorization = header(request, 'authorization')
  if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim()) unauthorized()
  await logoutSupabaseUser(authorization.slice(7).trim())
  ok(response, { ok: true })
})
