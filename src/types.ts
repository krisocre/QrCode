export type Role = 'customer' | 'staff' | 'owner'
export type ProgramType = 'stamps' | 'points'

export interface Tenant {
  id: string
  slug: string
  name: string
  stampGoal: number
  programType: ProgramType
  pointsPerDollar: number
}

export interface Profile {
  id: string
  tenantId: string
  role: Role
  firstName: string
  lastName: string
  phone: string
  stamps: number
  points: number
  staffCode?: string
  accessPin?: string
  createdAt?: number
}

export interface Reward {
  id: string
  tenantId: string
  name: string
  description: string
  stampCost: number
  pointCost: number
  promotion?: string
}

export type TransactionKind = 'visit' | 'points' | 'redeem' | 'adjustment' | 'undo'

export interface LoyaltyTransaction {
  id: string
  tenantId: string
  customerId: string
  staffId: string
  kind: TransactionKind
  stampsChanged: number
  pointsChanged: number
  rewardId?: string
  source: 'scan' | 'manual' | 'owner' | 'undo'
  createdAt: number
  reversesId?: string
}

export interface PendingRedemption {
  token: string
  customerId: string
  rewardId: string
  expiresAt: number
}

export interface LoyaltyDatabase {
  version: number
  tenant: Tenant
  profiles: Profile[]
  rewards: Reward[]
  transactions: LoyaltyTransaction[]
  pendingRedemptions: PendingRedemption[]
}

export interface ScannedPayload {
  customerId: string
  rewardId?: string
  redemptionToken?: string
}
