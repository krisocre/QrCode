import type { ProgramType, TransactionKind } from '../types'

export interface ProductionTenant {
  id: string
  slug: string
  name: string
  programType: ProgramType
  stampGoal: number
  pointsPerDollar: number
  brandColor?: string
  heroImageUrl?: string
  address?: string
  phone?: string
  generalInfo?: string
  timezone?: string
  openingHours?: Record<string, string>
}

export interface ProductionReward {
  id: string
  name: string
  description: string
  stampCost: number
  pointCost: number
  promotion?: string
  active?: boolean
}

export interface PublicTenantResponse {
  tenant: ProductionTenant
  rewards: ProductionReward[]
}

export interface ProductionProfile {
  id: string
  tenantId: string
  role: 'customer' | 'staff' | 'owner'
  firstName: string
  lastName: string
  phone: string
  stamps: number
  points: number
  createdAt: string
  staffCode?: string
  wallet?: {
    provider: 'google'
    objectId: string
    status: string
    lastSyncedAt?: string
  } | null
}

export interface ProductionTransaction {
  id: string
  customerId: string
  staffId: string
  kind: TransactionKind
  source: 'scan' | 'manual' | 'owner' | 'undo'
  stampsChanged: number
  pointsChanged: number
  rewardId?: string
  reversesId?: string
  createdAt: string
  customer?: Pick<ProductionProfile, 'id' | 'firstName' | 'lastName'>
  staff?: Pick<ProductionProfile, 'id' | 'firstName' | 'lastName' | 'staffCode'>
  reward?: Pick<ProductionReward, 'id' | 'name'>
}

export interface CustomerProfileResponse {
  profile: ProductionProfile
  tenant: ProductionTenant
  rewards: ProductionReward[]
  transactions: ProductionTransaction[]
}

export interface StaffSession {
  sessionToken: string
  expiresAt: string
  staff: ProductionProfile
}

export interface StaffCustomerResponse {
  customer: ProductionProfile
  rewards: ProductionReward[]
  transactions: ProductionTransaction[]
  scanToken?: string
  scanKind?: 'identifier' | 'redemption'
  rewardId?: string
}
