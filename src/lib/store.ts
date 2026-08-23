import type {
  LoyaltyDatabase,
  LoyaltyTransaction,
  PendingRedemption,
  Profile,
  ProgramType,
  Reward,
  ScannedPayload,
  Tenant,
} from '../types'

const STORAGE_KEY = 'juniper-loyalty-database-v2'
const CHANNEL_NAME = 'juniper-loyalty-sync-v2'
const DEVICE_KEY = 'juniper-device-id-v1'
const DEMO_NOW = Date.now()
const BARCODE_SECRET = 'local-preview-rotating-token-v2'

interface OtpRequest {
  tenantId: string
  phone: string
  deviceId: string
  createdAt: number
}

interface StoredLoyaltyDatabase {
  version: number
  tenants: Tenant[]
  profiles: Profile[]
  rewards: Reward[]
  transactions: LoyaltyTransaction[]
  pendingRedemptions: PendingRedemption[]
  otpRequests: OtpRequest[]
}

const seed: StoredLoyaltyDatabase = {
  version: 3,
  tenants: [
    { id: 'tenant-juniper', slug: 'juniper', name: 'Luxe Hair Studio', stampGoal: 8, programType: 'stamps', pointsPerDollar: 1 },
    { id: 'tenant-northline', slug: 'northline', name: 'Northline Goods', stampGoal: 8, programType: 'points', pointsPerDollar: 2 },
  ],
  profiles: [
    { id: 'customer-jamie', tenantId: 'tenant-juniper', role: 'customer', firstName: 'Jamie', lastName: 'Chen', phone: '+14165550182', stamps: 6, points: 350, createdAt: DEMO_NOW - 410 * 86_400_000 },
    { id: 'customer-amira', tenantId: 'tenant-juniper', role: 'customer', firstName: 'Amira', lastName: 'Patel', phone: '+14165550149', stamps: 4, points: 180, createdAt: DEMO_NOW - 280 * 86_400_000 },
    { id: 'customer-theo', tenantId: 'tenant-juniper', role: 'customer', firstName: 'Theo', lastName: 'Martin', phone: '+16475550107', stamps: 9, points: 510, createdAt: DEMO_NOW - 190 * 86_400_000 },
    { id: 'staff-maya', tenantId: 'tenant-juniper', role: 'staff', firstName: 'Maya', lastName: 'R.', phone: '', stamps: 0, points: 0, staffCode: 'MR', accessPin: '4826' },
    { id: 'owner-juniper', tenantId: 'tenant-juniper', role: 'owner', firstName: 'Alex', lastName: 'Morgan', phone: '', stamps: 0, points: 0, staffCode: 'AM', accessPin: '7391' },
    { id: 'customer-nora', tenantId: 'tenant-northline', role: 'customer', firstName: 'Nora', lastName: 'Singh', phone: '+14165550191', stamps: 0, points: 740, createdAt: DEMO_NOW - 220 * 86_400_000 },
    { id: 'staff-northline', tenantId: 'tenant-northline', role: 'staff', firstName: 'Eli', lastName: 'W.', phone: '', stamps: 0, points: 0, staffCode: 'EW', accessPin: '1357' },
    { id: 'owner-northline', tenantId: 'tenant-northline', role: 'owner', firstName: 'Sam', lastName: 'Lee', phone: '', stamps: 0, points: 0, staffCode: 'SL', accessPin: '8642' },
  ],
  rewards: [
    { id: 'reward-condition', tenantId: 'tenant-juniper', name: 'Free Glossing & Tonal Refresh', description: 'A polished tonal refresh with your next salon visit.', stampCost: 8, pointCost: 800, promotion: 'Colour services' },
    { id: 'reward-product', tenantId: 'tenant-juniper', name: 'Complimentary Scalp Treatment', description: 'A calming treatment added to your salon service.', stampCost: 5, pointCost: 500, promotion: 'Any service' },
    { id: 'reward-blowout', tenantId: 'tenant-juniper', name: 'Scalp Massage Add-on', description: 'Ten relaxing minutes added at the wash station.', stampCost: 10, pointCost: 1000 },
    { id: 'reward-northline-10', tenantId: 'tenant-northline', name: '$10 Store Credit', description: 'Use toward any full-price purchase.', stampCost: 5, pointCost: 500 },
  ],
  transactions: [
    { id: 'tx-seed-1', tenantId: 'tenant-juniper', customerId: 'customer-jamie', staffId: 'staff-maya', kind: 'visit', stampsChanged: 1, pointsChanged: 0, source: 'scan', createdAt: DEMO_NOW - 6 * 86_400_000 },
    { id: 'tx-seed-2', tenantId: 'tenant-juniper', customerId: 'customer-jamie', staffId: 'staff-maya', kind: 'visit', stampsChanged: 1, pointsChanged: 0, source: 'scan', createdAt: DEMO_NOW - 19 * 86_400_000 },
    { id: 'tx-seed-3', tenantId: 'tenant-juniper', customerId: 'customer-amira', staffId: 'staff-maya', kind: 'points', stampsChanged: 0, pointsChanged: 20, source: 'manual', createdAt: DEMO_NOW - 34 * 60_000 },
    { id: 'tx-northline-1', tenantId: 'tenant-northline', customerId: 'customer-nora', staffId: 'staff-northline', kind: 'points', stampsChanged: 0, pointsChanged: 80, source: 'scan', createdAt: DEMO_NOW - 4 * 86_400_000 },
  ],
  pendingRedemptions: [],
  otpRequests: [],
}

function cloneSeed(): StoredLoyaltyDatabase {
  return JSON.parse(JSON.stringify(seed)) as StoredLoyaltyDatabase
}

function readStored(): StoredLoyaltyDatabase {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEY)
    if (!storedValue) return cloneSeed()
    const parsed = JSON.parse(storedValue) as StoredLoyaltyDatabase
    return parsed.version === 3 && Array.isArray(parsed.tenants) ? parsed : cloneSeed()
  } catch {
    return cloneSeed()
  }
}

function activeTenantFrom(database: StoredLoyaltyDatabase): Tenant {
  const requested = new URLSearchParams(window.location.search).get('tenant')?.toLowerCase()
  if (requested) {
    return database.tenants.find((tenant) => tenant.slug === requested || tenant.id === requested) ?? {
      id: `tenant-unavailable:${requested}`,
      slug: requested,
      name: 'Business unavailable',
      stampGoal: 10,
      programType: 'stamps',
      pointsPerDollar: 1,
    }
  }
  return database.tenants.find((tenant) => tenant.slug === 'juniper') ?? database.tenants[0]
}

function scopedView(database: StoredLoyaltyDatabase): LoyaltyDatabase {
  const tenant = activeTenantFrom(database)
  return {
    version: database.version,
    tenant,
    profiles: database.profiles.filter((profile) => profile.tenantId === tenant.id),
    rewards: database.rewards.filter((reward) => reward.tenantId === tenant.id),
    transactions: database.transactions.filter((transaction) => transaction.tenantId === tenant.id),
    pendingRedemptions: database.pendingRedemptions.filter((redemption) => {
      const customer = database.profiles.find((profile) => profile.id === redemption.customerId)
      return customer?.tenantId === tenant.id
    }),
  }
}

function hashToken(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

function barcodeSignature(tenantId: string, customerId: string, timeSlot: number): string {
  return hashToken(`${BARCODE_SECRET}:${tenantId}:${customerId}:${timeSlot}`)
}

function rewardCost(tenant: Tenant, reward: Reward): number {
  return tenant.programType === 'stamps' ? reward.stampCost : reward.pointCost
}

function currentBalance(tenant: Tenant, profile: Profile): number {
  return tenant.programType === 'stamps' ? profile.stamps : profile.points
}

let stored = readStored()
let snapshot = scopedView(stored)
const subscribers = new Set<() => void>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

function publish(next: StoredLoyaltyDatabase): void {
  stored = next
  snapshot = scopedView(next)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  subscribers.forEach((callback) => callback())
  channel?.postMessage({ type: 'changed', tenantId: snapshot.tenant.id })
}

function refreshFromStorage(): void {
  stored = readStored()
  snapshot = scopedView(stored)
  subscribers.forEach((callback) => callback())
}

channel?.addEventListener('message', refreshFromStorage)
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) refreshFromStorage()
})

function actor(profileId: string, role: 'staff' | 'owner'): Profile {
  const profile = snapshot.profiles.find((item) => item.id === profileId && item.role === role)
  if (!profile) throw new Error(`${role === 'owner' ? 'Owner' : 'Staff'} authorization is required.`)
  return profile
}

function ensureTenantAvailable(): void {
  if (!stored.tenants.some((tenant) => tenant.id === snapshot.tenant.id)) throw new Error('This business link is invalid or no longer active.')
}

function customerForTenant(profileId: string): Profile {
  const customer = snapshot.profiles.find((profile) => profile.id === profileId && profile.role === 'customer')
  if (!customer) throw new Error('Customer account was not found for this business.')
  return customer
}

export const loyaltyStore = {
  subscribe(callback: () => void) {
    subscribers.add(callback)
    return () => subscribers.delete(callback)
  },
  getSnapshot(): LoyaltyDatabase {
    return snapshot
  },
  verifyStaffPin(pin: string): Profile | undefined {
    return snapshot.profiles.find((profile) => profile.role === 'staff' && profile.accessPin === pin)
  },
  verifyOwnerPin(pin: string): Profile | undefined {
    return snapshot.profiles.find((profile) => profile.role === 'owner' && profile.accessPin === pin)
  },
  findCustomerByPhone(phone: string): Profile | undefined {
    return snapshot.profiles.find((profile) => profile.role === 'customer' && profile.phone === phone)
  },
  requestOtp(phone: string): void {
    ensureTenantAvailable()
    let deviceId = localStorage.getItem(DEVICE_KEY)
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, deviceId)
    }
    const hourAgo = Date.now() - 3_600_000
    const recent = stored.otpRequests.filter((request) => request.createdAt > hourAgo)
    const count = recent.filter((request) =>
      request.tenantId === snapshot.tenant.id && (request.phone === phone || request.deviceId === deviceId),
    ).length
    if (count >= 3) throw new Error('Too many codes requested. Try again in one hour.')
    publish({
      ...stored,
      otpRequests: [...recent, { tenantId: snapshot.tenant.id, phone, deviceId, createdAt: Date.now() }],
    })
  },
  registerCustomer(phone: string): Profile {
    ensureTenantAvailable()
    const existing = snapshot.profiles.find((profile) => profile.role === 'customer' && profile.phone === phone)
    if (existing) return existing
    const profile: Profile = {
      id: crypto.randomUUID(),
      tenantId: snapshot.tenant.id,
      role: 'customer',
      firstName: 'Guest',
      lastName: '',
      phone,
      stamps: 0,
      points: 0,
      createdAt: Date.now(),
    }
    publish({ ...stored, profiles: [...stored.profiles, profile] })
    return profile
  },
  customerPayload(customerId: string, timestamp = Date.now()): string {
    customerForTenant(customerId)
    const timeSlot = Math.floor(timestamp / 60_000)
    return `JUNIPER:CUSTOMER:${snapshot.tenant.id}:${customerId}:${timeSlot}:${barcodeSignature(snapshot.tenant.id, customerId, timeSlot)}`
  },
  barcodeRefreshSeconds(timestamp = Date.now()): number {
    return 60 - Math.floor((timestamp % 60_000) / 1000)
  },
  parsePayload(raw: string): ScannedPayload | null {
    const parts = raw.split(':')
    if (parts[0] !== 'JUNIPER' || parts[2] !== snapshot.tenant.id) return null
    if (parts[1] === 'CUSTOMER' && parts[3] && parts[4] && parts[5]) {
      const slot = Number(parts[4])
      const currentSlot = Math.floor(Date.now() / 60_000)
      const validTime = Number.isInteger(slot) && Math.abs(currentSlot - slot) <= 1
      const validSignature = parts[5] === barcodeSignature(snapshot.tenant.id, parts[3], slot)
      return validTime && validSignature ? { customerId: parts[3] } : null
    }
    if (parts[1] === 'REDEEM' && parts[3] && parts[4] && parts[5]) {
      const pending = snapshot.pendingRedemptions.find((item) => item.token === parts[5])
      if (!pending || pending.expiresAt <= Date.now()) return null
      return { customerId: parts[3], rewardId: parts[4], redemptionToken: parts[5] }
    }
    return null
  },
  createRedemption(customerId: string, rewardId: string): PendingRedemption {
    const customer = customerForTenant(customerId)
    const reward = snapshot.rewards.find((item) => item.id === rewardId)
    if (!reward || currentBalance(snapshot.tenant, customer) < rewardCost(snapshot.tenant, reward)) {
      throw new Error('This reward is not available yet.')
    }
    const token = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const redemption: PendingRedemption = { token, customerId, rewardId, expiresAt: Date.now() + 5 * 60_000 }
    publish({
      ...stored,
      pendingRedemptions: [...stored.pendingRedemptions.filter((item) => item.expiresAt > Date.now()), redemption],
    })
    return redemption
  },
  redemptionPayload(redemption: PendingRedemption): string {
    customerForTenant(redemption.customerId)
    return `JUNIPER:REDEEM:${snapshot.tenant.id}:${redemption.customerId}:${redemption.rewardId}:${redemption.token}`
  },
  confirmTransaction(input: {
    staffId: string
    customerId: string
    kind: 'visit' | 'points' | 'redeem'
    source: 'scan' | 'manual'
    points?: number
    rewardId?: string
    redemptionToken?: string
  }): LoyaltyTransaction {
    const staff = actor(input.staffId, 'staff')
    const customer = customerForTenant(input.customerId)
    const now = Date.now()
    if (input.source === 'scan') {
      const recent = snapshot.transactions.find((transaction) =>
        transaction.customerId === customer.id && transaction.source === 'scan' && transaction.kind !== 'undo' && now - transaction.createdAt < 30_000,
      )
      if (recent) throw new Error('Already scanned. Try again in a few seconds.')
    }

    let stampsChanged = input.kind === 'visit' && snapshot.tenant.programType === 'stamps' ? 1 : 0
    let pointsChanged = input.kind === 'visit' && snapshot.tenant.programType === 'points' ? 1 : 0
    if (input.kind === 'points') pointsChanged = Math.max(0, Math.round(input.points ?? 0))
    let pendingRedemptions = stored.pendingRedemptions.filter((item) => item.expiresAt > now)

    if (input.kind === 'redeem') {
      const reward = snapshot.rewards.find((item) => item.id === input.rewardId)
      if (!reward) throw new Error('Reward was not found for this business.')
      const cost = rewardCost(snapshot.tenant, reward)
      if (currentBalance(snapshot.tenant, customer) < cost) throw new Error('Customer does not have enough rewards balance.')
      if (input.redemptionToken) {
        const pending = snapshot.pendingRedemptions.find((item) => item.token === input.redemptionToken && item.customerId === customer.id && item.rewardId === reward.id)
        if (!pending) throw new Error('This redemption code is invalid or expired.')
        pendingRedemptions = pendingRedemptions.filter((item) => item.token !== input.redemptionToken)
      }
      if (snapshot.tenant.programType === 'stamps') stampsChanged = -cost
      else pointsChanged = -cost
    }

    if (input.kind === 'points' && pointsChanged <= 0) throw new Error('Enter a points amount greater than zero.')
    const transaction: LoyaltyTransaction = {
      id: crypto.randomUUID(),
      tenantId: snapshot.tenant.id,
      customerId: customer.id,
      staffId: staff.id,
      kind: input.kind,
      stampsChanged,
      pointsChanged,
      rewardId: input.rewardId,
      source: input.source,
      createdAt: now,
    }
    publish({
      ...stored,
      profiles: stored.profiles.map((profile) => profile.id === customer.id
        ? { ...profile, stamps: profile.stamps + stampsChanged, points: profile.points + pointsChanged }
        : profile),
      transactions: [transaction, ...stored.transactions],
      pendingRedemptions,
    })
    return transaction
  },
  undoTransaction(transactionId: string, staffId: string): LoyaltyTransaction {
    actor(staffId, 'staff')
    const original = snapshot.transactions.find((transaction) => transaction.id === transactionId)
    if (!original || original.kind === 'undo') throw new Error('Transaction was not found for this business.')
    if (Date.now() - original.createdAt > 60_000) throw new Error('The 60-second undo window has closed.')
    if (snapshot.transactions.some((transaction) => transaction.reversesId === original.id)) throw new Error('This transaction was already undone.')
    const customer = customerForTenant(original.customerId)
    const undo: LoyaltyTransaction = {
      id: crypto.randomUUID(),
      tenantId: snapshot.tenant.id,
      customerId: original.customerId,
      staffId,
      kind: 'undo',
      stampsChanged: -original.stampsChanged,
      pointsChanged: -original.pointsChanged,
      rewardId: original.rewardId,
      source: 'undo',
      createdAt: Date.now(),
      reversesId: original.id,
    }
    publish({
      ...stored,
      profiles: stored.profiles.map((profile) => profile.id === customer.id
        ? { ...profile, stamps: profile.stamps + undo.stampsChanged, points: profile.points + undo.pointsChanged }
        : profile),
      transactions: [undo, ...stored.transactions],
    })
    return undo
  },
  updateProgram(ownerId: string, update: { programType?: ProgramType; stampGoal?: number; pointsPerDollar?: number }): void {
    actor(ownerId, 'owner')
    publish({
      ...stored,
      tenants: stored.tenants.map((tenant) => tenant.id === snapshot.tenant.id ? {
        ...tenant,
        programType: update.programType ?? tenant.programType,
        stampGoal: Math.min(50, Math.max(1, Math.round(update.stampGoal ?? tenant.stampGoal))),
        pointsPerDollar: Math.min(100, Math.max(1, update.pointsPerDollar ?? tenant.pointsPerDollar)),
      } : tenant),
    })
  },
  saveReward(ownerId: string, input: Omit<Reward, 'tenantId'>): Reward {
    actor(ownerId, 'owner')
    const reward: Reward = {
      ...input,
      id: input.id || crypto.randomUUID(),
      tenantId: snapshot.tenant.id,
      stampCost: Math.max(1, Math.round(input.stampCost)),
      pointCost: Math.max(1, Math.round(input.pointCost)),
    }
    const exists = snapshot.rewards.some((item) => item.id === reward.id)
    publish({
      ...stored,
      rewards: exists
        ? stored.rewards.map((item) => item.id === reward.id && item.tenantId === snapshot.tenant.id ? reward : item)
        : [...stored.rewards, reward],
    })
    return reward
  },
  deleteReward(ownerId: string, rewardId: string): void {
    actor(ownerId, 'owner')
    if (!snapshot.rewards.some((reward) => reward.id === rewardId)) throw new Error('Reward was not found for this business.')
    publish({ ...stored, rewards: stored.rewards.filter((reward) => reward.id !== rewardId) })
  },
  addStaff(ownerId: string, input: { firstName: string; lastName: string; pin: string }): Profile {
    actor(ownerId, 'owner')
    if (!/^\d{4}$/.test(input.pin)) throw new Error('Staff PIN must be exactly 4 digits.')
    if (snapshot.profiles.some((profile) => profile.role === 'staff' && profile.accessPin === input.pin)) throw new Error('That PIN is already in use.')
    const profile: Profile = {
      id: crypto.randomUUID(),
      tenantId: snapshot.tenant.id,
      role: 'staff',
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: '',
      stamps: 0,
      points: 0,
      staffCode: `${input.firstName[0] ?? ''}${input.lastName[0] ?? ''}`.toUpperCase(),
      accessPin: input.pin,
      createdAt: Date.now(),
    }
    if (!profile.firstName) throw new Error("Enter the staff member's first name.")
    publish({ ...stored, profiles: [...stored.profiles, profile] })
    return profile
  },
  updateStaff(ownerId: string, staffId: string, input: { firstName: string; lastName: string; pin: string }): void {
    actor(ownerId, 'owner')
    const staff = snapshot.profiles.find((profile) => profile.id === staffId && profile.role === 'staff')
    if (!staff) throw new Error('Staff member was not found for this business.')
    if (!/^\d{4}$/.test(input.pin)) throw new Error('Staff PIN must be exactly 4 digits.')
    if (snapshot.profiles.some((profile) => profile.role === 'staff' && profile.id !== staffId && profile.accessPin === input.pin)) throw new Error('That PIN is already in use.')
    if (!input.firstName.trim()) throw new Error("Enter the staff member's first name.")
    publish({
      ...stored,
      profiles: stored.profiles.map((profile) => profile.id === staffId ? {
        ...profile,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        accessPin: input.pin,
        staffCode: `${input.firstName[0] ?? ''}${input.lastName[0] ?? ''}`.toUpperCase(),
      } : profile),
    })
  },
  removeStaff(ownerId: string, staffId: string): void {
    actor(ownerId, 'owner')
    if (!snapshot.profiles.some((profile) => profile.id === staffId && profile.role === 'staff')) throw new Error('Staff member was not found for this business.')
    publish({ ...stored, profiles: stored.profiles.filter((profile) => profile.id !== staffId) })
  },
  adjustCustomer(ownerId: string, customerId: string, amount: number, balanceType: ProgramType): LoyaltyTransaction {
    const owner = actor(ownerId, 'owner')
    const customer = customerForTenant(customerId)
    const rounded = Math.round(amount)
    if (!rounded) throw new Error('Enter a non-zero adjustment.')
    const stampsChanged = balanceType === 'stamps' ? rounded : 0
    const pointsChanged = balanceType === 'points' ? rounded : 0
    if (customer.stamps + stampsChanged < 0 || customer.points + pointsChanged < 0) throw new Error('Adjustment cannot make the balance negative.')
    const transaction: LoyaltyTransaction = {
      id: crypto.randomUUID(),
      tenantId: snapshot.tenant.id,
      customerId,
      staffId: owner.id,
      kind: 'adjustment',
      stampsChanged,
      pointsChanged,
      source: 'owner',
      createdAt: Date.now(),
    }
    publish({
      ...stored,
      profiles: stored.profiles.map((profile) => profile.id === customerId
        ? { ...profile, stamps: profile.stamps + stampsChanged, points: profile.points + pointsChanged }
        : profile),
      transactions: [transaction, ...stored.transactions],
    })
    return transaction
  },
}
