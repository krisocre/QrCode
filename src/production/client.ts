import { apiRequest, authenticatedRequest, createIdempotencyKey } from '../lib/api-client'
import { setSupabaseSession } from '../lib/supabase'
import type {
  CustomerProfileResponse,
  ProductionProfile,
  ProductionReward,
  ProductionTenant,
  ProductionTransaction,
  PublicTenantResponse,
  StaffCustomerResponse,
  StaffSession,
} from './types'

type UnknownRecord = Record<string, unknown>
let activeTenantId = ''

function tenantHeaders(): HeadersInit | undefined {
  return activeTenantId ? { 'X-Tenant-Id': activeTenantId } : undefined
}

function tenantRequest<T>(path: string, options: Parameters<typeof authenticatedRequest<T>>[1] = {}): Promise<T> {
  return authenticatedRequest<T>(path, { ...options, headers: { ...tenantHeaders(), ...options.headers } })
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeTenant(value: unknown): ProductionTenant {
  const item = record(value)
  return {
    id: text(item.id),
    slug: text(item.slug),
    name: text(item.name, 'Luxe Hair Studio'),
    programType: (item.programType ?? item.program_type) === 'points' ? 'points' : 'stamps',
    stampGoal: numberValue(item.stampGoal ?? item.stamp_goal, 8),
    pointsPerDollar: numberValue(item.pointsPerDollar ?? item.points_per_dollar, 1),
    brandColor: text(item.brandColor ?? item.brand_color, '#C23F73'),
    heroImageUrl: text(item.heroImageUrl ?? item.hero_image_url),
    address: text(item.address),
    phone: text(item.phone),
    generalInfo: text(item.generalInfo ?? item.general_info),
    timezone: text(item.timezone, 'America/Toronto'),
    openingHours: record(item.openingHours ?? item.opening_hours) as Record<string, string>,
  }
}

export function normalizeReward(value: unknown): ProductionReward {
  const item = record(value)
  return {
    id: text(item.id),
    name: text(item.name),
    description: text(item.description),
    stampCost: numberValue(item.stampCost ?? item.stamp_cost, 1),
    pointCost: numberValue(item.pointCost ?? item.point_cost, 1),
    promotion: text(item.promotion ?? item.promotion_rule),
    active: item.active !== false,
  }
}

export function normalizeProfile(value: unknown): ProductionProfile {
  const item = record(value)
  const wallet = item.wallet ? record(item.wallet) : null
  return {
    id: text(item.id),
    tenantId: text(item.tenantId ?? item.tenant_id),
    role: (['customer', 'staff', 'owner'].includes(text(item.role)) ? text(item.role) : 'customer') as ProductionProfile['role'],
    firstName: text(item.firstName ?? item.first_name, 'Member'),
    lastName: text(item.lastName ?? item.last_name),
    phone: text(item.phone ?? item.phone_e164),
    stamps: numberValue(item.stamps),
    points: numberValue(item.points),
    createdAt: text(item.createdAt ?? item.created_at ?? item.memberSince ?? item.member_since, new Date().toISOString()),
    staffCode: text(item.staffCode ?? item.staff_code) || undefined,
    wallet: wallet ? {
      provider: 'google',
      objectId: text(wallet.objectId ?? wallet.object_id),
      status: text(wallet.status, 'active'),
      lastSyncedAt: text(wallet.lastSyncedAt ?? wallet.last_synced_at) || undefined,
    } : null,
  }
}

export function normalizeTransaction(value: unknown): ProductionTransaction {
  const item = record(value)
  return {
    id: text(item.id),
    customerId: text(item.customerId ?? item.customer_id),
    staffId: text(item.staffId ?? item.staff_id),
    kind: text(item.kind, 'visit') as ProductionTransaction['kind'],
    source: text(item.source, 'scan') as ProductionTransaction['source'],
    stampsChanged: numberValue(item.stampsChanged ?? item.stamps_changed),
    pointsChanged: numberValue(item.pointsChanged ?? item.points_changed),
    rewardId: text(item.rewardId ?? item.reward_id) || undefined,
    reversesId: text(item.reversesId ?? item.reverses_id) || undefined,
    createdAt: text(item.createdAt ?? item.created_at, new Date().toISOString()),
    customer: item.customer ? normalizeProfile(item.customer) : undefined,
    staff: item.staff ? normalizeProfile(item.staff) : undefined,
    reward: item.reward ? normalizeReward(item.reward) : undefined,
  }
}

function normalizeCustomerResponse(value: unknown): CustomerProfileResponse {
  const payload = record(value)
  const profile = normalizeProfile(payload.profile)
  const walletValue = payload.walletPass ?? payload.wallet_pass
  const wallet = walletValue ? record(walletValue) : null
  if (!profile.wallet && wallet) {
    profile.wallet = {
      provider: 'google',
      objectId: text(wallet.objectId ?? wallet.object_id),
      status: text(wallet.status, 'active'),
      lastSyncedAt: text(wallet.lastSyncedAt ?? wallet.last_synced_at) || undefined,
    }
  }
  return {
    profile,
    tenant: normalizeTenant(payload.tenant),
    rewards: Array.isArray(payload.rewards) ? payload.rewards.map(normalizeReward) : [],
    transactions: Array.isArray(payload.transactions) ? payload.transactions.map(normalizeTransaction) : [],
  }
}

function normalizeStaffCustomer(value: unknown): StaffCustomerResponse {
  const payload = record(value)
  const scanKind = text(payload.scanKind ?? payload.scan_kind)
  return {
    customer: normalizeProfile(payload.customer),
    rewards: Array.isArray(payload.rewards) ? payload.rewards.map(normalizeReward) : [],
    transactions: Array.isArray(payload.transactions) ? payload.transactions.map(normalizeTransaction) : [],
    scanToken: text(payload.scanToken ?? payload.scan_token) || undefined,
    scanKind: scanKind === 'redemption' || scanKind === 'identifier' ? scanKind : undefined,
    rewardId: text(payload.rewardId ?? payload.reward_id) || undefined,
  }
}

export const productionApi = {
  async publicTenant(slug: string): Promise<PublicTenantResponse> {
    const payload = await apiRequest<UnknownRecord>(`/api/public/tenant?slug=${encodeURIComponent(slug)}`)
    activeTenantId = text(record(payload.tenant).id)
    return {
      tenant: normalizeTenant(payload.tenant),
      rewards: Array.isArray(payload.rewards) ? payload.rewards.map(normalizeReward) : [],
    }
  },

  requestOtp(input: { tenantSlug: string; phone: string }) {
    return apiRequest<{ ok: boolean; retryAfterSeconds?: number }>('/api/auth/request-otp', { method: 'POST', body: input })
  },

  async verifyOtp(input: { tenantSlug: string; phone: string; code: string }) {
    const result = await apiRequest<{ accessToken: string; refreshToken: string; expiresIn: number }>('/api/auth/verify-otp', { method: 'POST', body: input })
    await setSupabaseSession(result.accessToken, result.refreshToken)
    return result
  },

  async phoneLogin(input: { tenantSlug: string; phone: string }) {
    const result = await apiRequest<{ accessToken: string; refreshToken: string; expiresIn: number }>('/api/auth/phone-login', { method: 'POST', body: input })
    await setSupabaseSession(result.accessToken, result.refreshToken)
    return result
  },

  async customerProfile(): Promise<CustomerProfileResponse> {
    return normalizeCustomerResponse(await tenantRequest('/api/customer/profile'))
  },

  async enrollCustomer(input: { tenantSlug: string; firstName: string; lastName: string; consentAccepted: boolean }): Promise<CustomerProfileResponse> {
    return normalizeCustomerResponse(await tenantRequest('/api/customer/enroll', { method: 'POST', body: input }))
  },

  async updateCustomer(input: { firstName: string; lastName: string }): Promise<CustomerProfileResponse> {
    return normalizeCustomerResponse(await tenantRequest('/api/customer/profile', { method: 'PATCH', body: input }))
  },

  wallet(action: 'issue' | 'restore') {
    return tenantRequest<{ saveUrl: string; objectId: string }>('/api/customer/wallet', { method: 'POST', body: { action } })
  },

  redemption(rewardId: string) {
    return tenantRequest<{ barcodeValue: string; expiresAt: string }>('/api/customer/redemption', { method: 'POST', body: { rewardId } })
  },

  unlockStaff(input: { tenantSlug: string; pin: string; deviceToken: string }): Promise<StaffSession> {
    return apiRequest('/api/staff/unlock', { method: 'POST', body: input })
  },

  async staffSearch(sessionToken: string, query: string): Promise<ProductionProfile[]> {
    const payload = await apiRequest<UnknownRecord>(`/api/staff/search?q=${encodeURIComponent(query)}`, { accessToken: sessionToken })
    const customers = Array.isArray(payload.customers) ? payload.customers : []
    return customers.map(normalizeProfile)
  },

  async staffScan(sessionToken: string, barcode: string): Promise<StaffCustomerResponse> {
    return normalizeStaffCustomer(await apiRequest('/api/staff/scan', { method: 'POST', accessToken: sessionToken, body: { barcode } }))
  },

  async staffCustomer(sessionToken: string, customerId: string): Promise<StaffCustomerResponse> {
    return normalizeStaffCustomer(await apiRequest(`/api/staff/customer?id=${encodeURIComponent(customerId)}`, { accessToken: sessionToken }))
  },

  async staffAudit(sessionToken: string): Promise<ProductionTransaction[]> {
    const payload = record(await apiRequest('/api/staff/audit', { accessToken: sessionToken }))
    return (Array.isArray(payload.transactions) ? payload.transactions : []).map(normalizeTransaction)
  },

  staffLogout(sessionToken: string) {
    return apiRequest<{ ok: boolean }>('/api/staff/logout', { method: 'POST', accessToken: sessionToken })
  },

  staffConfirm(sessionToken: string, input: UnknownRecord, idempotencyKey = createIdempotencyKey('transaction')) {
    return apiRequest<UnknownRecord>('/api/staff/transactions/confirm', {
      method: 'POST',
      accessToken: sessionToken,
      idempotencyKey,
      body: input,
    })
  },

  staffUndo(sessionToken: string, transactionId: string) {
    return apiRequest<UnknownRecord>('/api/staff/transactions/undo', {
      method: 'POST',
      accessToken: sessionToken,
      idempotencyKey: createIdempotencyKey('undo'),
      body: { transactionId },
    })
  },

  staffWalletSync(sessionToken: string, customerId: string) {
    return apiRequest<UnknownRecord>('/api/wallet/sync', {
      method: 'POST',
      accessToken: sessionToken,
      body: { customerId },
    })
  },

  ownerWalletSync(customerId: string) {
    return tenantRequest<UnknownRecord>('/api/wallet/sync', { method: 'POST', body: { customerId } })
  },

  adminOverview() {
    return tenantRequest<UnknownRecord>('/api/admin/overview')
  },

  adminResource<T = UnknownRecord>(resource: 'staff' | 'rewards' | 'customers' | 'program' | 'device-enrollments', method: string, body?: unknown) {
    const input = record(body)
    const deleteQuery = method === 'DELETE' && input.id ? `?id=${encodeURIComponent(text(input.id))}` : ''
    return tenantRequest<T>(`/api/admin/${resource}${deleteQuery}`, {
      method,
      body: method === 'DELETE' ? undefined : body,
      idempotencyKey: resource === 'customers' && method === 'PATCH' ? createIdempotencyKey('adjustment') : undefined,
    })
  },
}
