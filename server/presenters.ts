import type { MembershipRow, ProfileRow, RewardRow, TenantRow, TransactionRow, WalletPassRow } from './types.js'

export function tenantView(tenant: TenantRow) {
  const brand = tenant.wallet_brand ?? {}
  const info = tenant.public_info ?? {}
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    programType: tenant.program_type,
    stampGoal: tenant.stamp_goal,
    pointsPerDollar: Number(tenant.points_per_dollar),
    brandColor: typeof brand.brandColor === 'string' ? brand.brandColor : '#E86A92',
    logoUrl: typeof brand.logoUrl === 'string' ? brand.logoUrl : null,
    heroImageUrl: typeof brand.heroImageUrl === 'string' ? brand.heroImageUrl : null,
    address: typeof info.address === 'string' ? info.address : null,
    phone: typeof info.phone === 'string' ? info.phone : null,
    openingHours: info.openingHours ?? null,
    generalInfo: typeof info.generalInfo === 'string' ? info.generalInfo : null,
    privacyUrl: typeof info.privacyUrl === 'string' ? info.privacyUrl : null,
    termsUrl: typeof info.termsUrl === 'string' ? info.termsUrl : null,
  }
}

export function rewardView(reward: RewardRow) {
  return {
    id: reward.id,
    code: reward.code,
    name: reward.name,
    description: reward.description,
    stampCost: reward.stamp_cost,
    pointCost: reward.point_cost,
    promotion: reward.promotion_rule,
    terms: reward.terms ?? null,
    walletOfferEnabled: reward.wallet_offer_enabled ?? true,
    sortOrder: reward.sort_order ?? 0,
    active: reward.active,
  }
}

export function profileView(membership: MembershipRow, profile?: ProfileRow) {
  const joined = profile ?? (Array.isArray(membership.profile) ? membership.profile[0] : membership.profile)
  return {
    id: membership.id,
    tenantId: membership.tenant_id,
    role: membership.role,
    memberNumber: membership.member_number,
    firstName: membership.first_name || joined?.first_name || '',
    lastName: membership.last_name || joined?.last_name || '',
    phone: joined?.phone_e164 ?? null,
    stamps: membership.stamps_balance,
    points: membership.points_balance,
    staffCode: membership.staff_code,
    status: membership.status,
    memberSince: membership.joined_at ?? membership.created_at,
  }
}

export function transactionView(transaction: TransactionRow) {
  return {
    id: transaction.id,
    customerId: transaction.customer_id,
    staffId: transaction.actor_id,
    kind: transaction.kind,
    source: transaction.source,
    stampsChanged: transaction.stamps_delta,
    pointsChanged: transaction.points_delta,
    rewardId: transaction.reward_id,
    reversesId: transaction.reverses_id,
    createdAt: transaction.created_at,
  }
}

export function walletPassView(pass: WalletPassRow | undefined) {
  return pass ? {
    provider: pass.provider,
    objectId: pass.object_id,
    status: pass.status,
    lastSyncedAt: pass.last_synced_at,
    syncPending: !pass.last_synced_at || Boolean(pass.last_error),
  } : null
}
