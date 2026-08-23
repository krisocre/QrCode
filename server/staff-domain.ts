import { profileView, transactionView } from './presenters.js'
import { db } from './supabase.js'
import type { MembershipRow, ProfileRow, TransactionRow } from './types.js'

function profileFrom(membership: MembershipRow): ProfileRow | undefined {
  return Array.isArray(membership.profile) ? membership.profile[0] : membership.profile
}

export async function auditFeed(tenantId: string, limit = 100) {
  const transactions = await db<TransactionRow[]>('loyalty_transactions', {
    query: { select: '*', tenant_id: `eq.${tenantId}`, order: 'created_at.desc', limit },
  })
  const ids = [...new Set(transactions.flatMap((transaction) => [transaction.customer_id, transaction.actor_id]))]
  if (!ids.length) return []
  const memberships = await db<MembershipRow[]>('tenant_memberships', {
    query: {
      select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at,profile:profiles(id,first_name,last_name,phone_e164,created_at)',
      tenant_id: `eq.${tenantId}`,
      id: `in.(${ids.join(',')})`,
    },
  })
  const byId = new Map(memberships.map((membership) => [membership.id, membership]))
  return transactions.map((transaction) => {
    const customer = byId.get(transaction.customer_id)
    const staff = byId.get(transaction.actor_id)
    return {
      ...transactionView(transaction),
      customer: customer ? profileView(customer, profileFrom(customer)) : null,
      staff: staff ? profileView(staff, profileFrom(staff)) : null,
      undoAvailableUntil: new Date(Date.parse(transaction.created_at) + 60_000).toISOString(),
    }
  })
}
