import { verifyScanToken, customerSummary, tenantById } from './domain.js'
import { badRequest, forbidden } from './errors.js'
import { header } from './http.js'
import { offlineVisitIdempotencyKey, verifyOfflineVisit, type OfflineVisitEvent } from './offline-events.js'
import { transactionView } from './presenters.js'
import { rpc } from './supabase.js'
import type { Actor, ApiRequest, TransactionKind, TransactionRow, TransactionSource } from './types.js'

export interface ConfirmInput {
  customerId: string
  kind: TransactionKind
  source: TransactionSource
  points?: number
  rewardId?: string
  scanToken?: string
  occurredAt?: string
  deviceEventId?: string
  deviceSignature?: string
}

function idempotencyKey(request: ApiRequest): string {
  const key = header(request, 'idempotency-key')?.trim()
  if (!key || key.length < 8 || key.length > 200 || !/^[A-Za-z0-9:._-]+$/.test(key)) {
    badRequest('Send a valid Idempotency-Key header with this request.')
  }
  return key
}

function rowFrom(value: TransactionRow | TransactionRow[]): TransactionRow {
  const row = Array.isArray(value) ? value[0] : value
  if (!row) throw new Error('Transaction did not return a result.')
  return row
}

export async function confirmTransaction(request: ApiRequest, actor: Actor, input: ConfirmInput) {
  const key = idempotencyKey(request)
  const offlineFields = [input.occurredAt, input.deviceEventId, input.deviceSignature]
  const hasOffline = offlineFields.some(Boolean)
  if (hasOffline && !offlineFields.every(Boolean)) badRequest('occurredAt, deviceEventId, and deviceSignature are required together.')
  if (input.kind !== 'points' && input.points !== undefined) badRequest('points is valid only for a custom-points transaction.')
  if (input.kind !== 'redeem' && input.rewardId !== undefined) badRequest('rewardId is valid only for a reward redemption.')
  if (!hasOffline && input.source === 'manual' && input.scanToken) badRequest('scanToken is valid only for a scanned transaction.')

  let scan: ReturnType<typeof verifyScanToken> | undefined
  if (hasOffline) {
    if (input.kind !== 'visit' || input.points || input.rewardId || input.scanToken) forbidden('Only a single visit can be submitted from the offline queue.')
    const event: OfflineVisitEvent = {
      occurredAt: input.occurredAt!,
      deviceEventId: input.deviceEventId!,
      deviceSignature: input.deviceSignature!,
    }
    if (key !== offlineVisitIdempotencyKey(actor.deviceId!, event.deviceEventId)) badRequest('Offline idempotency key does not match this device event.')
    await verifyOfflineVisit(actor, input.customerId, event)
  } else if (input.source === 'scan') {
    if (!input.scanToken) badRequest('A fresh scan token is required for scanned transactions.')
    scan = verifyScanToken(input.scanToken, actor, input.customerId)
    if (scan.redemption_id && input.kind !== 'redeem') {
      badRequest('This customer code is valid only for its selected reward redemption.')
    }
  }

  if (input.kind === 'points' && (!input.points || input.points < 1 || input.points > 100_000)) {
    badRequest('Points must be between 1 and 100,000.')
  }
  if (input.kind === 'redeem') {
    const rewardId = scan?.reward_id ?? input.rewardId
    if (!rewardId) badRequest('Select a reward to redeem.')
    input.rewardId = rewardId
  }

  const tenant = await tenantById(actor.tenantId)
  const stampsDelta = input.kind === 'visit' && tenant.program_type === 'stamps' ? 1 : 0
  const pointsDelta = input.kind === 'visit' && tenant.program_type === 'points' ? 1 : input.kind === 'points' ? input.points! : 0
  const result = await rpc<TransactionRow | TransactionRow[]>('confirm_loyalty_transaction', {
    p_actor_id: actor.id,
    p_customer_id: input.customerId,
    p_kind: input.kind,
    p_source: hasOffline ? 'offline' : input.source,
    p_idempotency_key: key,
    p_stamps_delta: stampsDelta,
    p_points_delta: pointsDelta,
    p_reward_id: input.rewardId ?? null,
    p_redemption_id: scan?.redemption_id ?? null,
    p_barcode_id: scan?.barcode_id ?? null,
    p_device_id: actor.deviceId ?? null,
    p_metadata: {
      ...(scan?.jti ? { scanTokenId: scan.jti } : {}),
      ...(hasOffline ? { offline: true, signatureVerified: true, deviceEventId: input.deviceEventId } : {}),
    },
    p_occurred_at: hasOffline ? input.occurredAt : new Date().toISOString(),
  })
  const transaction = rowFrom(result)
  return { transaction: transactionView(transaction), ...await customerSummary(input.customerId, actor.tenantId) }
}

export async function undoTransaction(request: ApiRequest, actor: Actor, transactionId: string, reason?: string) {
  const result = await rpc<TransactionRow | TransactionRow[]>('undo_loyalty_transaction', {
    p_actor_id: actor.id,
    p_transaction_id: transactionId,
    p_idempotency_key: idempotencyKey(request),
    p_reason: reason ?? null,
    p_device_id: actor.deviceId ?? null,
  })
  const transaction = rowFrom(result)
  return { transaction: transactionView(transaction), ...await customerSummary(transaction.customer_id, actor.tenantId) }
}
