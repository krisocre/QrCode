import { config } from './config.js'
import { randomUUID } from 'node:crypto'
import { pepperedHash, verifyHs256, signHs256 } from './crypto.js'
import { forbidden, unauthorized } from './errors.js'
import { header } from './http.js'
import { db, getSupabaseUser } from './supabase.js'
import type { Actor, ApiRequest, MembershipRow, ProfileRole, ProfileRow } from './types.js'
import { uuid } from './validation.js'

interface StaffSessionClaims {
  iss: 'luxe-loyalty-api'
  aud: 'luxe-staff'
  kind: 'staff-session'
  sub: string
  tenant_id: string
  role: 'staff' | 'owner'
  first_name: string
  last_name: string
  staff_code?: string | null
  device_id: string
  iat: number
  exp: number
  jti: string
}

interface DeviceClaims {
  iss: 'luxe-loyalty-api'
  aud: 'luxe-device'
  kind: 'device-token'
  sub: string
  tenant_id: string
  iat: number
  exp: number
}

function bearer(request: ApiRequest): string {
  const authorization = header(request, 'authorization')
  if (!authorization?.startsWith('Bearer ')) unauthorized()
  const value = authorization.slice(7).trim()
  if (!value) unauthorized()
  return value
}

export async function requireSupabaseUser(request: ApiRequest) {
  const token = bearer(request)
  if (untrustedKind(token) === 'staff-session') unauthorized('This action requires a customer or owner sign-in.')
  return getSupabaseUser(token)
}

function untrustedKind(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { kind?: unknown }
    return typeof payload.kind === 'string' ? payload.kind : undefined
  } catch {
    return undefined
  }
}

function profileFrom(membership: MembershipRow): ProfileRow | undefined {
  return Array.isArray(membership.profile) ? membership.profile[0] : membership.profile
}

async function ensureDeviceActive(deviceId: string, tenantId: string, membershipId?: string): Promise<void> {
  const devices = await db<Array<{ id: string }>>('store_devices', {
    query: { select: 'id', id: `eq.${deviceId}`, tenant_id: `eq.${tenantId}`, status: 'eq.active', limit: 1 },
  })
  if (!devices[0]) unauthorized('This store device is no longer authorized.')
  if (membershipId) {
    const access = await db<Array<{ device_id: string }>>('staff_device_access', {
      query: {
        select: 'device_id',
        tenant_id: `eq.${tenantId}`,
        device_id: `eq.${deviceId}`,
        staff_membership_id: `eq.${membershipId}`,
        revoked_at: 'is.null',
        limit: 1,
      },
    })
    if (!access[0]) unauthorized('This staff account is not authorized on this device.')
  }
}

async function ensureTenantActive(tenantId: string): Promise<void> {
  const tenants = await db<Array<{ id: string }>>('tenants', {
    query: { select: 'id', id: `eq.${tenantId}`, is_active: 'eq.true', limit: 1 },
  })
  if (!tenants[0]) forbidden('This loyalty program is not active.')
}

async function ensureStaffSession(claims: StaffSessionClaims, token: string): Promise<void> {
  const sessions = await db<Array<{ id: string; session_token_hash: string }>>('staff_sessions', {
    query: {
      select: 'id,session_token_hash',
      id: `eq.${claims.jti}`,
      tenant_id: `eq.${claims.tenant_id}`,
      staff_membership_id: `eq.${claims.sub}`,
      device_id: `eq.${claims.device_id}`,
      revoked_at: 'is.null',
      expires_at: `gt.${new Date().toISOString()}`,
      limit: 1,
    },
  })
  if (!sessions[0]) unauthorized('This staff session was revoked or expired.')
  const expectedHash = `\\x${pepperedHash(token, config.sessionSigningSecret)}`.toLowerCase()
  if (sessions[0].session_token_hash.toLowerCase() !== expectedHash) unauthorized('This staff session is invalid.')
  await db('staff_sessions', { method: 'PATCH', query: { id: `eq.${claims.jti}` }, body: { last_seen_at: new Date().toISOString() } })
}

export async function requireSupabaseActor(request: ApiRequest, roles: readonly ProfileRole[]): Promise<Actor> {
  const user = await requireSupabaseUser(request)
  const requestedTenant = uuid(header(request, 'x-tenant-id'), 'X-Tenant-Id')
  const memberships = await db<MembershipRow[]>('tenant_memberships', {
    query: {
      select: 'id,tenant_id,profile_id,role,first_name,last_name,member_number,stamps_balance,points_balance,staff_code,status,joined_at,created_at,profile:profiles(id,first_name,last_name,phone_e164,created_at)',
      profile_id: `eq.${user.id}`,
      tenant_id: `eq.${requestedTenant}`,
      status: 'eq.active',
      limit: 20,
    },
  })
  if (!memberships.length) forbidden('No active loyalty account is linked to this sign-in.')
  const allowed = memberships.filter((membership) =>
    roles.includes(membership.role) && membership.tenant_id === requestedTenant,
  )
  if (allowed.length !== 1) forbidden('This account does not have the required role.')
  const membership = allowed[0]
  await ensureTenantActive(membership.tenant_id)
  const profile = profileFrom(membership)
  return {
    id: membership.id,
    tenantId: membership.tenant_id,
    role: membership.role,
    firstName: membership.first_name || profile?.first_name || '',
    lastName: membership.last_name || profile?.last_name || '',
    staffCode: membership.staff_code,
    authType: 'supabase',
  }
}

export async function requireStaffActor(request: ApiRequest, roles: readonly ('staff' | 'owner')[] = ['staff', 'owner']): Promise<Actor> {
  const token = bearer(request)
  if (untrustedKind(token) !== 'staff-session') return requireSupabaseActor(request, roles)
  const claims = verifyHs256<StaffSessionClaims>(token, config.sessionSigningSecret, {
    issuer: 'luxe-loyalty-api',
    audience: 'luxe-staff',
  })
  if (claims.kind !== 'staff-session' || !roles.includes(claims.role)) forbidden()
  await Promise.all([
    ensureTenantActive(claims.tenant_id),
    ensureDeviceActive(claims.device_id, claims.tenant_id, claims.sub),
    ensureStaffSession(claims, token),
  ])
  return {
    id: claims.sub,
    tenantId: claims.tenant_id,
    role: claims.role,
    firstName: claims.first_name,
    lastName: claims.last_name,
    staffCode: claims.staff_code,
    deviceId: claims.device_id,
    authType: 'staff-session',
  }
}

export async function requireCustomerActor(request: ApiRequest): Promise<Actor> {
  return requireSupabaseActor(request, ['customer'])
}

export async function requireAnyActor(request: ApiRequest): Promise<Actor> {
  const token = bearer(request)
  if (untrustedKind(token) === 'staff-session') return requireStaffActor(request)
  return requireSupabaseActor(request, ['customer', 'staff', 'owner'])
}

export async function issueStaffSession(input: {
  membershipId: string
  tenantId: string
  role: 'staff' | 'owner'
  firstName: string
  lastName: string
  staffCode?: string | null
  deviceId: string
}): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000)
  const expires = now + 8 * 60 * 60
  const sessionId = randomUUID()
  const token = signHs256({
    iss: 'luxe-loyalty-api',
    aud: 'luxe-staff',
    kind: 'staff-session',
    sub: input.membershipId,
    tenant_id: input.tenantId,
    role: input.role,
    first_name: input.firstName,
    last_name: input.lastName,
    staff_code: input.staffCode,
    device_id: input.deviceId,
    iat: now,
    exp: expires,
    jti: sessionId,
  }, config.sessionSigningSecret)
  await db('staff_sessions', {
    method: 'POST',
    body: {
      id: sessionId,
      tenant_id: input.tenantId,
      staff_membership_id: input.membershipId,
      device_id: input.deviceId,
      session_token_hash: `\\x${pepperedHash(token, config.sessionSigningSecret)}`,
      issued_at: new Date(now * 1000).toISOString(),
      expires_at: new Date(expires * 1000).toISOString(),
    },
  })
  return { token, expiresAt: new Date(expires * 1000).toISOString() }
}

export function issueDeviceToken(input: { deviceId: string; tenantId: string }): string {
  const now = Math.floor(Date.now() / 1000)
  return signHs256({
    iss: 'luxe-loyalty-api',
    aud: 'luxe-device',
    kind: 'device-token',
    sub: input.deviceId,
    tenant_id: input.tenantId,
    iat: now,
    exp: now + 365 * 24 * 60 * 60,
  }, config.sessionSigningSecret)
}

export function verifyDeviceToken(token: string, tenantId: string): DeviceClaims {
  const claims = verifyHs256<DeviceClaims>(token, config.sessionSigningSecret, {
    issuer: 'luxe-loyalty-api',
    audience: 'luxe-device',
  })
  if (claims.kind !== 'device-token' || claims.tenant_id !== tenantId) unauthorized('This device is not enrolled for this business.')
  return claims
}

export async function verifyEnrolledDeviceToken(token: string, tenantId: string): Promise<DeviceClaims> {
  const claims = verifyDeviceToken(token, tenantId)
  const devices = await db<Array<{ device_token_hash: string }>>('store_devices', {
    query: {
      select: 'device_token_hash',
      id: `eq.${claims.sub}`,
      tenant_id: `eq.${tenantId}`,
      status: 'eq.active',
      limit: 1,
    },
  })
  const expected = `\\x${pepperedHash(token, config.sessionSigningSecret)}`.toLowerCase()
  if (!devices[0] || devices[0].device_token_hash.toLowerCase() !== expected) unauthorized('This store device enrollment is invalid or revoked.')
  return claims
}

export async function revokeCurrentStaffSession(request: ApiRequest): Promise<void> {
  const token = bearer(request)
  const claims = verifyHs256<StaffSessionClaims>(token, config.sessionSigningSecret, {
    issuer: 'luxe-loyalty-api',
    audience: 'luxe-staff',
  })
  if (claims.kind !== 'staff-session') unauthorized()
  await db('staff_sessions', {
    method: 'PATCH',
    query: { id: `eq.${claims.jti}`, tenant_id: `eq.${claims.tenant_id}` },
    body: { revoked_at: new Date().toISOString(), revoke_reason: 'staff logout' },
  })
}
