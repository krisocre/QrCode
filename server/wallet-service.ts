import { config } from './config.js'
import { decryptWalletSecret, encryptWalletSecret, opaqueSuffix, pepperedHash, randomHex } from './crypto.js'
import { notFound } from './errors.js'
import { walletClassId } from './google-wallet.js'
import { db, rpc } from './supabase.js'
import { walletProvider } from './wallet-provider.js'
import type {
  MembershipRow,
  ProfileRow,
  RewardRow,
  TenantRow,
  WalletBarcodeCredentialRow,
  WalletPassRow,
} from './types.js'

interface WalletClassRow {
  id: string
  tenant_id: string
  provider: 'google'
  class_id: string
  status: string
}

interface WalletContext {
  tenant: TenantRow
  membership: MembershipRow
  profile: ProfileRow
  rewards: RewardRow[]
  pass?: WalletPassRow
  credential?: WalletBarcodeCredentialRow
}

interface ResolvedBarcode {
  barcode_id: string
  tenant_id: string
  customer_id: string
  wallet_pass_id: string
  object_id: string
  secret_ciphertext: string
  key_version: number
  algorithm: string
  digits: number
  period_seconds: number
  allowed_drift_windows: number
}

function relatedProfile(membership: MembershipRow): ProfileRow | undefined {
  return Array.isArray(membership.profile) ? membership.profile[0] : membership.profile
}

async function contextFor(membershipId: string, tenantId: string): Promise<WalletContext> {
  const [tenants, memberships, rewards, passes] = await Promise.all([
    db<TenantRow[]>('tenants', { query: { select: '*', id: `eq.${tenantId}`, is_active: 'eq.true', limit: 1 } }),
    db<MembershipRow[]>('tenant_memberships', {
      query: {
        select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at,profile:profiles(id,first_name,last_name,phone_e164,created_at)',
        id: `eq.${membershipId}`,
        tenant_id: `eq.${tenantId}`,
        role: 'eq.customer',
        status: 'eq.active',
        limit: 1,
      },
    }),
    db<RewardRow[]>('rewards', { query: { select: '*', tenant_id: `eq.${tenantId}`, active: 'eq.true', order: 'sort_order.asc,name.asc' } }),
    db<WalletPassRow[]>('wallet_passes', { query: { select: '*', tenant_id: `eq.${tenantId}`, membership_id: `eq.${membershipId}`, provider: 'eq.google', limit: 1 } }),
  ])
  const membership = memberships[0]
  const profile = membership && relatedProfile(membership)
  if (!tenants[0] || !membership || !profile) notFound('Customer account was not found.')
  const pass = passes[0]
  const credential = pass ? (await db<WalletBarcodeCredentialRow[]>('wallet_barcode_credentials', {
    query: {
      select: '*',
      tenant_id: `eq.${tenantId}`,
      membership_id: `eq.${membershipId}`,
      wallet_pass_id: `eq.${pass.id}`,
      active: 'eq.true',
      limit: 1,
    },
  }))[0] : undefined
  return { tenant: tenants[0], membership, profile, rewards, pass, credential }
}

async function ensureWalletClass(tenant: TenantRow): Promise<WalletClassRow> {
  const classId = walletClassId(tenant)
  const existing = await db<WalletClassRow[]>('wallet_classes', {
    query: { select: '*', tenant_id: `eq.${tenant.id}`, provider: 'eq.google', limit: 1 },
  })
  if (existing[0]) {
    if (existing[0].class_id !== classId) {
      const updated = await db<WalletClassRow[]>('wallet_classes', {
        method: 'PATCH',
        query: { id: `eq.${existing[0].id}`, tenant_id: `eq.${tenant.id}` },
        prefer: 'return=representation',
        body: { issuer_account_id: config.googleWalletIssuerId, class_id: classId },
      })
      return updated[0]
    }
    return existing[0]
  }
  const created = await db<WalletClassRow[]>('wallet_classes', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      tenant_id: tenant.id,
      provider: 'google',
      issuer_account_id: config.googleWalletIssuerId,
      class_id: classId,
      status: 'pending',
      configuration: {},
    },
  })
  if (!created[0]) throw new Error('Wallet class registration did not return a result.')
  return created[0]
}

async function registerPass(context: WalletContext): Promise<{ pass: WalletPassRow; credential: WalletBarcodeCredentialRow }> {
  const walletClass = await ensureWalletClass(context.tenant)
  const objectSuffix = context.pass?.object_suffix ?? `member_${opaqueSuffix(context.membership.id, config.qrSigningSecret, 28)}`
  const secretHex = randomHex(20)
  const result = await rpc<WalletPassRow | WalletPassRow[]>('register_wallet_pass', {
    p_customer_id: context.membership.id,
    p_wallet_class_id: walletClass.id,
    p_object_suffix: objectSuffix,
    p_object_id: `${config.googleWalletIssuerId}.${objectSuffix}`,
    p_lookup_hash: `\\x${pepperedHash(objectSuffix, config.tokenHashPepper)}`,
    p_secret_ciphertext: encryptWalletSecret(secretHex, config.qrSigningSecret),
    p_key_version: 1,
  })
  const pass = Array.isArray(result) ? result[0] : result
  if (!pass) throw new Error('Wallet pass registration did not return a result.')
  const credentials = await db<WalletBarcodeCredentialRow[]>('wallet_barcode_credentials', {
    query: {
      select: '*',
      tenant_id: `eq.${context.tenant.id}`,
      membership_id: `eq.${context.membership.id}`,
      wallet_pass_id: `eq.${pass.id}`,
      active: 'eq.true',
      limit: 1,
    },
  })
  if (!credentials[0]) throw new Error('Wallet pass registration did not create barcode credentials.')
  return { pass, credential: credentials[0] }
}

export async function syncWalletPass(membershipId: string, tenantId: string): Promise<{ objectId: string; saveUrl: string; status: string }> {
  const context = await contextFor(membershipId, tenantId)
  const provider = walletProvider('google')
  const registered = context.pass && context.credential
    ? { pass: context.pass, credential: context.credential }
    : await registerPass(context)
  try {
    const wallet = await provider.upsert({
      tenant: context.tenant,
      membership: context.membership,
      profile: context.profile,
      rewards: context.rewards,
      objectSuffix: registered.pass.object_suffix,
      barcodeSecretHex: decryptWalletSecret(registered.credential.secret_ciphertext, config.qrSigningSecret),
    })
    await Promise.all([
      db('wallet_passes', {
        method: 'PATCH',
        query: { id: `eq.${registered.pass.id}`, tenant_id: `eq.${tenantId}` },
        body: { status: 'active', last_synced_at: new Date().toISOString(), last_error: null },
      }),
      db('wallet_classes', {
        method: 'PATCH',
        query: { id: `eq.${registered.pass.wallet_class_id}`, tenant_id: `eq.${tenantId}` },
        body: { status: 'active' },
      }),
    ])
    return { objectId: wallet.objectId, saveUrl: provider.saveUrl(wallet.objectId, wallet.classId), status: 'active' }
  } catch (error) {
    await db('wallet_passes', {
      method: 'PATCH',
      query: { id: `eq.${registered.pass.id}`, tenant_id: `eq.${tenantId}` },
      body: { status: 'error', last_error: error instanceof Error ? error.message.slice(0, 500) : 'Wallet sync failed.' },
    }).catch(() => undefined)
    throw error
  }
}

export async function walletContextForScan(objectSuffix: string): Promise<{
  barcodeId: string
  tenantId: string
  membership: MembershipRow
  secretHex: string
  digits: number
  periodSeconds: number
  skewPeriods: number
}> {
  const result = await rpc<ResolvedBarcode | ResolvedBarcode[]>('resolve_wallet_barcode', {
    p_provider: 'google',
    p_object_suffix: objectSuffix,
  })
  const resolved = Array.isArray(result) ? result[0] : result
  if (!resolved) notFound('This Wallet pass is invalid or no longer active.')
  const memberships = await db<MembershipRow[]>('tenant_memberships', {
    query: {
      select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at,profile:profiles(id,first_name,last_name,phone_e164,created_at)',
      id: `eq.${resolved.customer_id}`,
      tenant_id: `eq.${resolved.tenant_id}`,
      role: 'eq.customer',
      status: 'eq.active',
      limit: 1,
    },
  })
  if (!memberships[0]) notFound('This customer account is not active.')
  return {
    barcodeId: resolved.barcode_id,
    tenantId: resolved.tenant_id,
    membership: memberships[0],
    secretHex: decryptWalletSecret(resolved.secret_ciphertext, config.qrSigningSecret),
    digits: resolved.digits,
    periodSeconds: resolved.period_seconds,
    skewPeriods: resolved.allowed_drift_windows,
  }
}
