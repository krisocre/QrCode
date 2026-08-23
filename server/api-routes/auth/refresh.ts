import { api, body, method, ok } from '../../http.js'
import { authRequest } from '../../supabase.js'
import { record, stringField } from '../../validation.js'

interface RefreshResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  token_type: string
  user: { id: string; phone?: string; email?: string }
}

export default api(async (request, response) => {
  method(request, ['POST'])
  const input = record(body(request))
  const refreshToken = stringField(input, 'refreshToken', { min: 20, max: 4096 })!
  const session = await authRequest<RefreshResponse>('token?grant_type=refresh_token', { refresh_token: refreshToken })
  ok(response, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at,
    tokenType: session.token_type,
    user: session.user,
  })
})
