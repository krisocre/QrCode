import { requireStaffActor } from '../../auth.js'
import { resolveScan } from '../../domain.js'
import { api, body, method, ok } from '../../http.js'
import { record, stringField } from '../../validation.js'

export default api(async (request, response) => {
  method(request, ['POST'])
  const actor = await requireStaffActor(request)
  const input = record(body(request))
  const barcode = stringField(input, 'barcode', { min: 10, max: 512 })!
  ok(response, await resolveScan(actor, barcode))
})
