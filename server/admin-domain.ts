import { randomUUID } from 'node:crypto'
import { issueDeviceToken } from './auth.js'
import { config } from './config.js'
import { pepperedHash, randomHex } from './crypto.js'
import { badRequest, notFound } from './errors.js'
import { tenantById, membershipById, searchCustomers } from './domain.js'
import { profileView, rewardView, tenantView, transactionView } from './presenters.js'
import { db, rpc } from './supabase.js'
import type { Actor, MembershipRow, ProfileRow, RewardRow, TenantRow, TransactionRow } from './types.js'

interface DeviceRow {
  id: string
  tenant_id: string
  label: string
  status: string
  last_seen_at: string | null
  created_at: string
}

interface StaffMutation {
  id?: string
  firstName: string
  lastName: string
  staffCode: string
  pin: string
}

function profileFrom(membership: MembershipRow): ProfileRow | undefined {
  return Array.isArray(membership.profile) ? membership.profile[0] : membership.profile
}

function deviceView(device: DeviceRow) {
  return {
    id: device.id,
    label: device.label,
    status: device.status,
    lastSeenAt: device.last_seen_at,
    createdAt: device.created_at,
  }
}

async function memberships(tenantId: string, role?: string): Promise<MembershipRow[]> {
  return db<MembershipRow[]>('tenant_memberships', {
    query: {
      select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at,profile:profiles(id,first_name,last_name,phone_e164,created_at)',
      tenant_id: `eq.${tenantId}`,
      ...(role ? { role: `eq.${role}` } : {}),
      order: 'created_at.desc',
      limit: 500,
    },
  })
}

export async function adminOverview(actor: Actor) {
  const [tenant, allMemberships, rewards, transactions, devices] = await Promise.all([
    tenantById(actor.tenantId),
    memberships(actor.tenantId),
    db<RewardRow[]>('rewards', { query: { select: '*', tenant_id: `eq.${actor.tenantId}`, order: 'created_at.desc', limit: 200 } }),
    db<TransactionRow[]>('loyalty_transactions', { query: { select: '*', tenant_id: `eq.${actor.tenantId}`, order: 'created_at.desc', limit: 100 } }),
    db<DeviceRow[]>('store_devices', { query: { select: 'id,tenant_id,label,status,last_seen_at,created_at', tenant_id: `eq.${actor.tenantId}`, order: 'created_at.desc', limit: 100 } }),
  ])
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const profiles = allMemberships.map((membership) => profileView(membership, profileFrom(membership)))
  return {
    tenant: tenantView(tenant),
    owner: profiles.find((profile) => profile.id === actor.id) ?? null,
    metrics: {
      customers: allMemberships.filter((membership) => membership.role === 'customer' && membership.status === 'active').length,
      activeStaff: allMemberships.filter((membership) => membership.role === 'staff' && membership.status === 'active').length,
      activeRewards: rewards.filter((reward) => reward.active).length,
      transactionsToday: transactions.filter((transaction) => Date.parse(transaction.created_at) >= startOfDay.getTime()).length,
    },
    profiles,
    rewards: rewards.map(rewardView),
    transactions: transactions.map(transactionView),
    devices: devices.map(deviceView),
  }
}

export async function adminStaff(tenantId: string) {
  const rows = await memberships(tenantId, 'staff')
  return rows.map((membership) => profileView(membership, profileFrom(membership)))
}

export async function saveStaff(actor: Actor, input: StaffMutation) {
  const result = await rpc<MembershipRow | MembershipRow[]>('admin_save_staff', {
    p_actor_id: actor.id,
    p_membership_id: input.id ?? null,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_staff_code: input.staffCode,
    p_pin: input.pin,
  })
  const row = Array.isArray(result) ? result[0] : result
  if (!row?.id) throw new Error('Staff update did not return an account.')
  const membership = await membershipById(row.id, actor.tenantId)
  const devices = await db<DeviceRow[]>('store_devices', {
    query: { select: 'id,tenant_id,label,status,last_seen_at,created_at', tenant_id: `eq.${actor.tenantId}`, status: 'eq.active', limit: 100 },
  })
  await Promise.all(devices.map((device) => rpc('admin_set_device_staff_access', {
    p_actor_id: actor.id,
    p_device_id: device.id,
    p_staff_membership_id: membership.id,
    p_enabled: true,
  })))
  return profileView(membership, profileFrom(membership))
}

export async function revokeStaff(actor: Actor, membershipId: string): Promise<void> {
  if (membershipId === actor.id) badRequest('You cannot revoke your current account.')
  await rpc('admin_set_staff_status', { p_actor_id: actor.id, p_membership_id: membershipId, p_status: 'closed' })
}

export async function adminRewards(tenantId: string) {
  const rewards = await db<RewardRow[]>('rewards', { query: { select: '*', tenant_id: `eq.${tenantId}`, order: 'created_at.desc', limit: 200 } })
  return rewards.map(rewardView)
}

export async function saveReward(actor: Actor, input: {
  id?: string
  code?: string
  name: string
  description: string
  stampCost: number
  pointCost: number
  promotion?: string
  terms?: string
  active?: boolean
}) {
  const existing = input.id ? await db<RewardRow[]>('rewards', {
    query: { select: '*', id: `eq.${input.id}`, tenant_id: `eq.${actor.tenantId}`, limit: 1 },
  }) : []
  if (input.id && !existing[0]) notFound('Reward was not found.')
  const generatedCode = input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
  const result = await rpc<RewardRow | RewardRow[]>('admin_save_reward', {
    p_actor_id: actor.id,
    p_reward_id: input.id ?? null,
    p_code: input.code ?? existing[0]?.code ?? `${generatedCode || 'REWARD'}_${randomHex(3).toUpperCase()}`,
    p_name: input.name,
    p_description: input.description,
    p_stamp_cost: input.stampCost,
    p_point_cost: input.pointCost,
    p_promotion_rule: input.promotion ?? null,
    p_terms: input.terms ?? null,
    p_wallet_offer_enabled: true,
    p_sort_order: existing[0]?.sort_order ?? 0,
  })
  let reward = Array.isArray(result) ? result[0] : result
  if (!reward) throw new Error('Reward update did not return a reward.')
  if (input.active !== undefined && input.active !== reward.active) {
    const activeResult = await rpc<RewardRow | RewardRow[]>('admin_set_reward_active', {
      p_actor_id: actor.id,
      p_reward_id: reward.id,
      p_active: input.active,
    })
    reward = Array.isArray(activeResult) ? activeResult[0] : activeResult
  }
  return rewardView(reward)
}

export async function disableReward(actor: Actor, rewardId: string): Promise<void> {
  await rpc('admin_set_reward_active', { p_actor_id: actor.id, p_reward_id: rewardId, p_active: false })
}

export async function listCustomers(tenantId: string, search?: string) {
  if (search) return searchCustomers(tenantId, search)
  const rows = await memberships(tenantId, 'customer')
  return rows.map((membership) => profileView(membership, profileFrom(membership)))
}

export async function adjustCustomer(actor: Actor, input: {
  customerId: string
  stampsDelta: number
  pointsDelta: number
  reason: string
  idempotencyKey: string
}) {
  const result = await rpc<TransactionRow | TransactionRow[]>('admin_adjust_customer', {
    p_actor_id: actor.id,
    p_customer_id: input.customerId,
    p_idempotency_key: input.idempotencyKey,
    p_stamps_delta: input.stampsDelta,
    p_points_delta: input.pointsDelta,
    p_reason: input.reason,
    p_device_id: actor.deviceId ?? null,
  })
  const transaction = Array.isArray(result) ? result[0] : result
  if (!transaction) throw new Error('Adjustment did not return a transaction.')
  const membership = await membershipById(input.customerId, actor.tenantId)
  return { transaction: transactionView(transaction), customer: profileView(membership, profileFrom(membership)) }
}

export async function updateProgram(actor: Actor, changes: {
  programType?: 'stamps' | 'points'
  stampGoal?: number
  pointsPerDollar?: number
  name?: string
  walletBrand?: Record<string, unknown>
  publicInfo?: Record<string, unknown>
}) {
  const current = await tenantById(actor.tenantId)
  const result = await rpc<TenantRow | TenantRow[]>('admin_update_program', {
    p_actor_id: actor.id,
    p_program_type: changes.programType ?? current.program_type,
    p_stamp_goal: changes.stampGoal ?? current.stamp_goal,
    p_points_per_dollar: changes.pointsPerDollar ?? Number(current.points_per_dollar),
    p_duplicate_window_seconds: current.duplicate_window_seconds ?? 30,
    p_undo_window_seconds: current.undo_window_seconds ?? 60,
    p_name: changes.name ?? null,
    p_wallet_brand: changes.walletBrand ?? null,
    p_public_info: changes.publicInfo ?? null,
  })
  const tenant = Array.isArray(result) ? result[0] : result
  if (!tenant) notFound('Loyalty program was not found.')
  return tenantView(tenant)
}

export async function listDevices(tenantId: string) {
  const rows = await db<DeviceRow[]>('store_devices', {
    query: { select: 'id,tenant_id,label,status,last_seen_at,created_at', tenant_id: `eq.${tenantId}`, order: 'created_at.desc', limit: 100 },
  })
  return rows.map(deviceView)
}

export async function enrollDevice(actor: Actor, label: string, publicKeyJwk: JsonWebKey) {
  if (publicKeyJwk.kty !== 'EC' || publicKeyJwk.crv !== 'P-256' || !publicKeyJwk.x || !publicKeyJwk.y) {
    badRequest('Device public key must be an ECDSA P-256 public JWK.')
  }
  const deviceId = randomUUID()
  const enrollmentToken = issueDeviceToken({ deviceId, tenantId: actor.tenantId })
  const result = await rpc<DeviceRow | DeviceRow[]>('admin_enroll_device', {
    p_actor_id: actor.id,
    p_device_id: deviceId,
    p_label: label,
    p_platform: 'web',
    p_device_token_hash: `\\x${pepperedHash(enrollmentToken, config.sessionSigningSecret)}`,
    p_public_key_jwk: publicKeyJwk,
  })
  const device = Array.isArray(result) ? result[0] : result
  if (!device) throw new Error('Device enrollment did not return a device.')
  const staff = await adminStaff(actor.tenantId)
  await Promise.all(staff.filter((member) => member.status === 'active').map((member) => rpc('admin_set_device_staff_access', {
    p_actor_id: actor.id,
    p_device_id: device.id,
    p_staff_membership_id: member.id,
    p_enabled: true,
  })))
  return { device: deviceView(device), enrollmentToken }
}

export async function revokeDevice(actor: Actor, deviceId: string): Promise<void> {
  const result = await rpc<DeviceRow | DeviceRow[]>('admin_revoke_device', {
    p_actor_id: actor.id,
    p_device_id: deviceId,
  })
  const device = Array.isArray(result) ? result[0] : result
  if (!device) notFound('Store device was not found.')
}
