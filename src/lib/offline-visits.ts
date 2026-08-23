import { signDeviceEvent } from './device-identity'

const QUEUE_KEY = 'luxe-signed-offline-visits-v1'

export interface QueuedOfflineVisit {
  eventId: string
  tenantId: string
  deviceId: string
  actorId: string
  customerId: string
  customerName: string
  occurredAt: string
  deviceSignature: string
  source: 'scan' | 'manual'
}

function readQueue(): QueuedOfflineVisit[] {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    return Array.isArray(value) ? value as QueuedOfflineVisit[] : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedOfflineVisit[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-50)))
}

function tokenClaims(token: string): { sub?: string; tenant_id?: string } {
  try {
    const encoded = token.split('.')[1] ?? ''
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { sub?: string; tenant_id?: string }
  } catch {
    throw new Error('The counter device enrollment is invalid.')
  }
}

export async function queueOfflineVisit(input: {
  tenantId: string
  deviceToken: string
  actorId: string
  customerId: string
  customerName: string
  source: 'scan' | 'manual'
}): Promise<QueuedOfflineVisit> {
  const existing = readQueue().find((item) =>
    item.tenantId === input.tenantId
    && item.customerId === input.customerId
    && Date.now() - Date.parse(item.occurredAt) < 30_000,
  )
  if (existing) throw new Error('A visit for this customer is already waiting to sync.')
  const claims = tokenClaims(input.deviceToken)
  if (!claims.sub || claims.tenant_id !== input.tenantId) throw new Error('This counter is not enrolled for the selected salon.')
  const eventId = crypto.randomUUID()
  const occurredAt = new Date().toISOString()
  const canonical = [
    'luxe-offline-visit-v1',
    claims.sub,
    input.tenantId,
    input.actorId,
    input.customerId,
    'visit',
    '1',
    occurredAt,
    eventId,
  ].join('\n')
  const queued: QueuedOfflineVisit = {
    eventId,
    tenantId: input.tenantId,
    deviceId: claims.sub,
    actorId: input.actorId,
    customerId: input.customerId,
    customerName: input.customerName,
    occurredAt,
    deviceSignature: await signDeviceEvent(input.tenantId, canonical),
    source: input.source,
  }
  writeQueue([...readQueue(), queued])
  return queued
}

export function offlineVisitsFor(tenantId: string, actorId: string): QueuedOfflineVisit[] {
  return readQueue().filter((item) => item.tenantId === tenantId && item.actorId === actorId)
}

export function removeOfflineVisit(eventId: string): void {
  writeQueue(readQueue().filter((item) => item.eventId !== eventId))
}
