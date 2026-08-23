export interface ApiRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  query: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string | null }
}

export interface ApiResponse {
  status(code: number): ApiResponse
  json(body: unknown): void
  end(): void
  setHeader(name: string, value: string | readonly string[]): void
}

export type ApiHandler = (request: ApiRequest, response: ApiResponse) => void | Promise<void>

export type ProfileRole = 'customer' | 'staff' | 'owner'
export type ProgramType = 'stamps' | 'points'
export type TransactionKind = 'visit' | 'points' | 'redeem' | 'adjustment'
export type TransactionSource = 'scan' | 'manual' | 'owner'

export interface TenantRow {
  id: string
  slug: string
  name: string
  program_type: ProgramType
  stamp_goal: number
  points_per_dollar: number | string
  duplicate_window_seconds?: number
  undo_window_seconds?: number
  require_registered_device?: boolean
  wallet_brand?: Record<string, unknown>
  public_info?: Record<string, unknown>
  is_active?: boolean
}

export interface ProfileRow {
  id: string
  first_name: string
  last_name: string
  phone_e164: string | null
  created_at: string
}

export interface MembershipRow {
  id: string
  tenant_id: string
  profile_id: string
  role: ProfileRole
  first_name: string
  last_name: string
  member_number: string
  stamps_balance: number
  points_balance: number
  staff_code: string | null
  status: 'invited' | 'active' | 'suspended' | 'closed'
  joined_at: string
  created_at: string
  profile?: ProfileRow | ProfileRow[]
}

export interface RewardRow {
  id: string
  tenant_id: string
  code: string
  name: string
  description: string
  stamp_cost: number
  point_cost: number
  promotion_rule: string | null
  terms?: string | null
  wallet_offer_enabled?: boolean
  sort_order?: number
  active: boolean
  created_at: string
}

export interface TransactionRow {
  id: string
  tenant_id: string
  customer_id: string
  actor_id: string
  kind: string
  source: string
  stamps_delta: number
  points_delta: number
  reward_id: string | null
  reverses_id: string | null
  created_at: string
}

export interface WalletPassRow {
  id: string
  tenant_id: string
  membership_id: string
  provider: 'google'
  wallet_class_id: string
  object_id: string
  object_suffix: string
  status: 'pending' | 'active' | 'suspended' | 'revoked' | 'error'
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface WalletBarcodeCredentialRow {
  id: string
  tenant_id: string
  membership_id: string
  wallet_pass_id: string
  lookup_hash: string
  secret_ciphertext: string
  key_version: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: number
  period_seconds: number
  allowed_drift_windows: number
  active: boolean
}

export interface Actor {
  id: string
  tenantId: string
  role: ProfileRole
  firstName: string
  lastName: string
  staffCode?: string | null
  deviceId?: string
  authType: 'supabase' | 'staff-session'
}

export interface SupabaseUser {
  id: string
  phone?: string | null
  email?: string | null
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}
