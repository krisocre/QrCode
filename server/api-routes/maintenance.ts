import { requireCron } from '../cron.js'
import { api, method, ok } from '../http.js'
import { rpc } from '../supabase.js'

export const config = { maxDuration: 30 }

export default api(async (request, response) => {
  method(request, ['GET'])
  requireCron(request)
  const result = await rpc<Record<string, number>>('run_loyalty_maintenance', {})
  ok(response, { ok: true, ...result })
})
