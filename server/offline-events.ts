import { verifyDeviceEventSignature } from './crypto.js'
import { badRequest, forbidden } from './errors.js'
import { db } from './supabase.js'
import type { Actor } from './types.js'

export interface OfflineVisitEvent {
  occurredAt: string
  deviceEventId: string
  deviceSignature: string
}

export function canonicalOfflineVisit(input: {
  actor: Actor
  customerId: string
  event: OfflineVisitEvent
}): string {
  return [
    'luxe-offline-visit-v1',
    input.actor.deviceId,
    input.actor.tenantId,
    input.actor.id,
    input.customerId,
    'visit',
    '1',
    input.event.occurredAt,
    input.event.deviceEventId,
  ].join('\n')
}

export function offlineVisitIdempotencyKey(deviceId: string, deviceEventId: string): string {
  return `offline:${deviceId}:${deviceEventId}`
}

export async function verifyOfflineVisit(actor: Actor, customerId: string, event: OfflineVisitEvent): Promise<void> {
  if (!actor.deviceId) forbidden('Offline visits require an enrolled store device.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.deviceEventId)) {
    badRequest('deviceEventId must be a valid identifier.')
  }
  if (!/^[A-Za-z0-9_-]{64,160}$/.test(event.deviceSignature)) badRequest('deviceSignature has an invalid format.')
  const occurred = Date.parse(event.occurredAt)
  if (!Number.isFinite(occurred)) badRequest('occurredAt must be a valid ISO date.')
  const age = Date.now() - occurred
  if (age < -5 * 60_000 || age > 24 * 60 * 60_000) badRequest('Offline visits must be submitted within 24 hours.')
  const devices = await db<Array<{ public_key_jwk: JsonWebKey | null }>>('store_devices', {
    query: {
      select: 'public_key_jwk',
      id: `eq.${actor.deviceId}`,
      tenant_id: `eq.${actor.tenantId}`,
      status: 'eq.active',
      limit: 1,
    },
  })
  const key = devices[0]?.public_key_jwk
  if (!key) forbidden('This device is not enabled for signed offline visits.')
  if (!verifyDeviceEventSignature(key, canonicalOfflineVisit({ actor, customerId, event }), event.deviceSignature)) {
    forbidden('The offline visit signature is invalid.')
  }
}
