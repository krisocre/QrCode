import { config } from './config.js'
import { pepperedHash, randomHex, signHs256, verifyHs256, verifyWalletTotp } from './crypto.js'
import { badRequest, forbidden, notFound, unauthorized } from './errors.js'
import { db, rpc } from './supabase.js'
import { profileView, rewardView, tenantView, transactionView, walletPassView } from './presenters.js'
import { walletContextForScan } from './wallet-service.js'
import type {
  Actor,
  MembershipRow,
  ProfileRow,
  RewardRow,
  TenantRow,
  TransactionRow,
  WalletPassRow,
} from './types.js'

interface ScanClaims {
  iss: 'luxe-loyalty-api'
  aud: 'luxe-scan'
  kind: 'scan'
  sub: string
  tenant_id: string
  actor_id: string
  device_id?: string
  barcode_id?: string
  redemption_id?: string
  reward_id?: string
  iat: number
  exp: number
  jti: string
}

export async function tenantBySlug(slug: string): Promise<TenantRow> {
  const tenants = await db<TenantRow[]>('tenants', {
    query: { select: '*', slug: `eq.${slug}`, is_active: 'eq.true', limit: 1 },
  })
  if (!tenants[0]) notFound('This loyalty program is unavailable.')
  return tenants[0]
}

export async function tenantById(id: string): Promise<TenantRow> {
  const tenants = await db<TenantRow[]>('tenants', {
    query: { select: '*', id: `eq.${id}`, is_active: 'eq.true', limit: 1 },
  })
  if (!tenants[0]) notFound('This loyalty program is unavailable.')
  return tenants[0]
}

export async function publicTenant(slug: string) {
  const tenant = await tenantBySlug(slug)
  const rewards = await db<RewardRow[]>('rewards', {
    query: { select: '*', tenant_id: `eq.${tenant.id}`, active: 'eq.true', order: 'stamp_cost.asc' },
  })
  return { tenant: tenantView(tenant), rewards: rewards.map(rewardView) }
}

export async function membershipById(id: string, tenantId: string): Promise<MembershipRow> {
  const memberships = await db<MembershipRow[]>('tenant_memberships', {
    query: {
      select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at,profile:profiles(id,first_name,last_name,phone_e164,created_at)',
      id: `eq.${id}`,
      tenant_id: `eq.${tenantId}`,
      limit: 1,
    },
  })
  if (!memberships[0]) notFound('Account was not found.')
  return memberships[0]
}

function relatedProfile(membership: MembershipRow): ProfileRow | undefined {
  return Array.isArray(membership.profile) ? membership.profile[0] : membership.profile
}

export async function customerBundle(actor: Actor) {
  const [tenant, membership, rewards, transactions, passes] = await Promise.all([
    tenantById(actor.tenantId),
    membershipById(actor.id, actor.tenantId),
    db<RewardRow[]>('rewards', { query: { select: '*', tenant_id: `eq.${actor.tenantId}`, active: 'eq.true', order: 'stamp_cost.asc' } }),
    db<TransactionRow[]>('loyalty_transactions', {
      query: { select: '*', tenant_id: `eq.${actor.tenantId}`, customer_id: `eq.${actor.id}`, order: 'created_at.desc', limit: 50 },
    }),
    db<WalletPassRow[]>('wallet_passes', {
      query: { select: '*', tenant_id: `eq.${actor.tenantId}`, membership_id: `eq.${actor.id}`, provider: 'eq.google', limit: 1 },
    }),
  ])
  const wallet = walletPassView(passes[0])
  return {
    tenant: tenantView(tenant),
    profile: { ...profileView(membership), wallet },
    rewards: rewards.map(rewardView),
    transactions: transactions.map(transactionView),
    walletPass: wallet,
  }
}

export async function updateCustomerProfile(actor: Actor, update: { firstName?: string; lastName?: string }) {
  const membership = await membershipById(actor.id, actor.tenantId)
  const changes: Record<string, string> = {}
  if (update.firstName !== undefined) changes.first_name = update.firstName
  if (update.lastName !== undefined) changes.last_name = update.lastName
  if (Object.keys(changes).length) {
    await Promise.all([
      db('profiles', { method: 'PATCH', query: { id: `eq.${membership.profile_id}` }, body: changes }),
      db('tenant_memberships', { method: 'PATCH', query: { id: `eq.${membership.id}`, tenant_id: `eq.${actor.tenantId}` }, body: changes }),
    ])
  }
  return customerBundle(actor)
}

export async function customerSummary(customerId: string, tenantId: string) {
  const membership = await membershipById(customerId, tenantId)
  if (membership.role !== 'customer' || membership.status !== 'active') notFound('Customer was not found.')
  const [transactions, rewards] = await Promise.all([
    db<TransactionRow[]>('loyalty_transactions', {
      query: { select: '*', tenant_id: `eq.${tenantId}`, customer_id: `eq.${customerId}`, order: 'created_at.desc', limit: 10 },
    }),
    db<RewardRow[]>('rewards', {
      query: { select: '*', tenant_id: `eq.${tenantId}`, active: 'eq.true', order: 'sort_order.asc,name.asc' },
    }),
  ])
  const history = transactions.map(transactionView)
  return { customer: profileView(membership), visitHistory: history, transactions: history, rewards: rewards.map(rewardView) }
}

export async function searchCustomers(tenantId: string, search: string) {
  const compactPhone = search.replace(/\D/g, '')
  const phoneSearch = compactPhone.length >= 4 ? compactPhone : 'no-match'
  const rows = await db<Array<{
    customer_id: string
    tenant_id: string
    member_number: string
    first_name: string
    last_name: string
    phone_e164: string | null
    stamps_balance: number
    points_balance: number
    joined_at: string
  }>>('staff_customer_directory', {
    query: {
      select: 'customer_id,tenant_id,member_number,first_name,last_name,phone_e164,stamps_balance,points_balance,joined_at',
      tenant_id: `eq.${tenantId}`,
      or: `(first_name.ilike.*${search}*,last_name.ilike.*${search}*,phone_e164.ilike.*${phoneSearch}*)`,
      order: 'last_activity_at.desc.nullslast,joined_at.desc',
      limit: 30,
    },
  })
  return rows.map((row) => ({
    id: row.customer_id,
    tenantId: row.tenant_id,
    role: 'customer' as const,
    memberNumber: row.member_number,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone_e164,
    stamps: row.stamps_balance,
    points: row.points_balance,
    staffCode: null,
    status: 'active' as const,
    memberSince: row.joined_at,
  }))
}

function scanToken(input: Omit<ScanClaims, 'iss' | 'aud' | 'kind' | 'iat' | 'exp' | 'jti'>): string {
  const now = Math.floor(Date.now() / 1000)
  return signHs256({
    ...input,
    iss: 'luxe-loyalty-api',
    aud: 'luxe-scan',
    kind: 'scan',
    iat: now,
    exp: now + 45,
    jti: randomHex(16),
  }, config.qrSigningSecret)
}

export function verifyScanToken(token: string, actor: Actor, customerId: string): ScanClaims {
  const claims = verifyHs256<ScanClaims>(token, config.qrSigningSecret, {
    issuer: 'luxe-loyalty-api',
    audience: 'luxe-scan',
  })
  if (claims.kind !== 'scan' || claims.sub !== customerId || claims.tenant_id !== actor.tenantId || claims.actor_id !== actor.id) {
    unauthorized('This scan is no longer valid for the current transaction.')
  }
  if (claims.device_id && claims.device_id !== actor.deviceId) unauthorized('This scan belongs to a different store device.')
  return claims
}

export async function resolveScan(actor: Actor, raw: string) {
  const walletMatch = /^LUXE1:([A-Za-z0-9_-]{10,80}):(\d{9,12}):(\d{6,10})$/.exec(raw)
  if (walletMatch) {
    const context = await walletContextForScan(walletMatch[1])
    if (context.tenantId !== actor.tenantId) forbidden('This pass belongs to a different business.')
    if (!verifyWalletTotp(context.secretHex, Number(walletMatch[2]), walletMatch[3], {
      periodSeconds: context.periodSeconds,
      digits: context.digits,
      skewPeriods: context.skewPeriods,
    })) {
      badRequest('This Wallet barcode is expired. Ask the customer to reopen it.')
    }
    return {
      ...await customerSummary(context.membership.id, actor.tenantId),
      scanToken: scanToken({
        sub: context.membership.id,
        tenant_id: actor.tenantId,
        actor_id: actor.id,
        device_id: actor.deviceId,
        barcode_id: context.barcodeId,
      }),
      scanKind: 'identifier',
    }
  }

  const redemptionMatch = /^LUXER1:([A-Za-z0-9_-]{24,160})$/.exec(raw)
  if (redemptionMatch) {
    const hash = pepperedHash(redemptionMatch[1], config.tokenHashPepper)
    const result = await rpc<Array<{
      id: string
      tenant_id: string
      customer_id: string
      reward_id: string
      status: string
      expires_at: string
    }>>('resolve_redemption_token', {
      p_token_hash: `\\x${hash}`,
    })
    const redemption = result[0]
    if (!redemption || redemption.status !== 'issued' || Date.parse(redemption.expires_at) <= Date.now()) badRequest('This redemption code is invalid or expired.')
    if (redemption.tenant_id !== actor.tenantId) forbidden('This redemption belongs to a different business.')
    return {
      ...await customerSummary(redemption.customer_id, actor.tenantId),
      scanToken: scanToken({
        sub: redemption.customer_id,
        tenant_id: actor.tenantId,
        actor_id: actor.id,
        device_id: actor.deviceId,
        redemption_id: redemption.id,
        reward_id: redemption.reward_id,
      }),
      scanKind: 'redemption',
      rewardId: redemption.reward_id,
    }
  }
  badRequest('This is not a valid Luxe loyalty barcode.')
}

export async function createRedemption(actor: Actor, rewardId: string) {
  const [membership, rewards, tenant] = await Promise.all([
    membershipById(actor.id, actor.tenantId),
    db<RewardRow[]>('rewards', { query: { select: '*', id: `eq.${rewardId}`, tenant_id: `eq.${actor.tenantId}`, active: 'eq.true', limit: 1 } }),
    tenantById(actor.tenantId),
  ])
  const reward = rewards[0]
  if (!reward) notFound('Reward was not found.')
  const cost = tenant.program_type === 'stamps' ? reward.stamp_cost : reward.point_cost
  const balance = tenant.program_type === 'stamps' ? membership.stamps_balance : membership.points_balance
  if (balance < cost) forbidden('This reward is not available yet.')
  const rawToken = randomHex(24)
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const rows = await rpc<Array<{ id: string }>>('create_reward_redemption', {
    p_customer_id: actor.id,
    p_reward_id: reward.id,
    p_token_hash: `\\x${pepperedHash(rawToken, config.tokenHashPepper)}`,
    p_expires_at: expiresAt,
  })
  return { id: rows[0]?.id, reward: rewardView(reward), barcodeValue: `LUXER1:${rawToken}`, expiresAt }
}
