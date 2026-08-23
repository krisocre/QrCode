import { timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { forbidden } from './errors.js'
import { header } from './http.js'
import type { ApiRequest } from './types.js'

export function requireCron(request: ApiRequest): void {
  const presented = header(request, 'authorization') ?? ''
  const expected = `Bearer ${config.cronSecret}`
  const presentedBytes = Buffer.from(presented)
  const expectedBytes = Buffer.from(expected)
  if (presentedBytes.length !== expectedBytes.length || !timingSafeEqual(presentedBytes, expectedBytes)) {
    forbidden('This maintenance worker is not authorized.')
  }
}
