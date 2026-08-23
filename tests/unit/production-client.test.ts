import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeProfile, normalizeReward, normalizeTenant, normalizeTransaction, productionApi } from '../../src/production/client'

afterEach(() => vi.unstubAllGlobals())

describe('production API normalization', () => {
  it('normalizes tenant and reward records returned in database casing', () => {
    expect(normalizeTenant({
      id: 'tenant-1',
      slug: 'luxe',
      name: 'Luxe Hair Studio',
      program_type: 'stamps',
      stamp_goal: 8,
      points_per_dollar: '2',
      brand_color: '#C23F73',
    })).toMatchObject({ programType: 'stamps', stampGoal: 8, pointsPerDollar: 2, brandColor: '#C23F73' })

    expect(normalizeReward({ id: 'reward-1', name: 'Scalp Treatment', stamp_cost: 5, point_cost: 500 }))
      .toMatchObject({ stampCost: 5, pointCost: 500 })
  })

  it('normalizes customer balances and wallet status without leaking server fields', () => {
    const profile = normalizeProfile({
      id: 'customer-1',
      tenant_id: 'tenant-1',
      role: 'customer',
      first_name: 'Jamie',
      phone_e164: '+14165550182',
      stamps: 6,
      wallet: { object_id: 'issuer.customer-1', status: 'active' },
    })
    expect(profile).toMatchObject({ firstName: 'Jamie', phone: '+14165550182', stamps: 6 })
    expect(profile.wallet).toMatchObject({ objectId: 'issuer.customer-1', status: 'active' })
    expect(profile).not.toHaveProperty('pin_hash')
  })

  it('normalizes immutable transaction ledger records', () => {
    expect(normalizeTransaction({
      id: 'transaction-1',
      customer_id: 'customer-1',
      staff_id: 'staff-1',
      kind: 'visit',
      source: 'scan',
      stamps_changed: 1,
      points_changed: 0,
      created_at: '2026-08-22T12:00:00Z',
    })).toMatchObject({ customerId: 'customer-1', staffId: 'staff-1', stampsChanged: 1 })
  })

  it('preserves a temporary redemption scan contract for the cashier action sheet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      customer: { id: 'customer-1', firstName: 'Jamie', stamps: 8 },
      rewards: [{ id: 'reward-1', name: 'Scalp Treatment', stampCost: 8 }],
      transactions: [],
      scanToken: 'signed-scan-token',
      scanKind: 'redemption',
      rewardId: 'reward-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(productionApi.staffScan('staff-session', 'LUXER1:temporary-code-value')).resolves.toMatchObject({
      scanKind: 'redemption',
      rewardId: 'reward-1',
      scanToken: 'signed-scan-token',
    })
  })
})
