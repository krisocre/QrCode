import { config } from './config.js'
import { signRs256 } from './crypto.js'
import { ApiError } from './errors.js'
import { upstreamFetch } from './network.js'
import type { MembershipRow, ProfileRow, RewardRow, TenantRow } from './types.js'

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1'
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer'
let cachedAccessToken: { value: string; expiresAt: number } | undefined
const syncedClasses = new Map<string, number>()

type JsonObject = Record<string, unknown>

function localized(value: string): JsonObject {
  return { defaultValue: { language: 'en-US', value } }
}

function openingHoursText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const lines = Object.entries(value as Record<string, unknown>)
    .filter(([, hours]) => typeof hours === 'string')
    .map(([day, hours]) => `${day}: ${hours}`)
  return lines.length ? lines.join('\n') : undefined
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

export function walletClassId(tenant: TenantRow): string {
  return `${config.googleWalletIssuerId}.${safeId(`${tenant.slug}_${config.googleWalletClassSuffix}`)}`
}

function googleObjectId(objectSuffix: string): string {
  return `${config.googleWalletIssuerId}.${safeId(objectSuffix)}`
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) return cachedAccessToken.value
  const assertion = signRs256({
    iss: config.googleWalletServiceAccountEmail,
    scope: OAUTH_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }, config.googleWalletPrivateKey)
  const response = await upstreamFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  }, { timeoutMs: 15_000, code: 'wallet_authentication_unavailable', message: 'Google Wallet authentication is temporarily unavailable.' })
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!response.ok || !payload.access_token) {
    throw new ApiError(502, 'wallet_authentication_failed', 'Google Wallet authentication failed.', payload.error_description)
  }
  cachedAccessToken = { value: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) }
  return payload.access_token
}

async function walletRequest<T>(path: string, options: { method?: string; body?: unknown; allowNotFound?: boolean } = {}): Promise<T | undefined> {
  const response = await upstreamFetch(`${WALLET_API}/${path}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }, { timeoutMs: 15_000, code: 'wallet_api_unavailable', message: 'Google Wallet is temporarily unavailable.' })
  if (response.status === 404 && options.allowNotFound) return undefined
  const payload = await response.json().catch(() => undefined) as T | { error?: { message?: string } } | undefined
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? payload.error?.message : undefined
    throw new ApiError(502, 'wallet_api_failed', message ?? 'Google Wallet could not update the pass.')
  }
  return payload as T
}

function classPayload(tenant: TenantRow): JsonObject {
  const brand = tenant.wallet_brand ?? {}
  const logoUrl = typeof brand.logoUrl === 'string' && brand.logoUrl
    ? brand.logoUrl
    : `${config.appUrl}/icons/icon-192.png`
  const heroImageUrl = typeof brand.heroImageUrl === 'string' && brand.heroImageUrl ? brand.heroImageUrl : undefined
  const hero = heroImageUrl ? {
    heroImage: { sourceUri: { uri: heroImageUrl }, contentDescription: localized(`${tenant.name} salon`) },
  } : {}
  return {
    id: walletClassId(tenant),
    issuerName: tenant.name,
    programName: `${tenant.name} Rewards`,
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: typeof brand.brandColor === 'string' ? brand.brandColor : '#E86A92',
    programLogo: { sourceUri: { uri: logoUrl }, contentDescription: localized(`${tenant.name} logo`) },
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    viewUnlockRequirement: 'UNLOCK_REQUIRED_TO_VIEW',
    homepageUri: { uri: `${config.appUrl}/?tenant=${encodeURIComponent(tenant.slug)}`, description: `${tenant.name} member profile` },
    ...hero,
  }
}

async function ensureClass(tenant: TenantRow): Promise<void> {
  const id = walletClassId(tenant)
  const recent = syncedClasses.get(id)
  if (recent && Date.now() - recent < 60_000) return
  const existing = await walletRequest<JsonObject>(`loyaltyClass/${encodeURIComponent(id)}`, { allowNotFound: true })
  if (!existing) {
    await walletRequest('loyaltyClass', { method: 'POST', body: classPayload(tenant) })
    syncedClasses.set(id, Date.now())
    return
  }
  const { id: _id, reviewStatus: _review, ...updates } = classPayload(tenant)
  await walletRequest(`loyaltyClass/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates })
  syncedClasses.set(id, Date.now())
}

function nextReward(tenant: TenantRow, membership: MembershipRow, rewards: RewardRow[]): { reward?: RewardRow; remaining: number } {
  const balance = tenant.program_type === 'stamps' ? membership.stamps_balance : membership.points_balance
  const active = rewards
    .filter((reward) => reward.active)
    .sort((a, b) => (tenant.program_type === 'stamps' ? a.stamp_cost - b.stamp_cost : a.point_cost - b.point_cost))
  const reward = active.find((item) => (tenant.program_type === 'stamps' ? item.stamp_cost : item.point_cost) > balance) ?? active[0]
  const cost = reward ? (tenant.program_type === 'stamps' ? reward.stamp_cost : reward.point_cost) : tenant.stamp_goal
  return { reward, remaining: Math.max(0, cost - balance) }
}

function objectPayload(input: {
  tenant: TenantRow
  membership: MembershipRow
  profile: ProfileRow
  rewards: RewardRow[]
  objectSuffix: string
  barcodeSecretHex: string
}): JsonObject {
  const { tenant, membership, profile, rewards, barcodeSecretHex } = input
  const info = tenant.public_info ?? {}
  const objectId = googleObjectId(input.objectSuffix)
  const balance = tenant.program_type === 'stamps' ? membership.stamps_balance : membership.points_balance
  const unit = tenant.program_type === 'stamps' ? 'Visits' : 'Points'
  const upcoming = nextReward(tenant, membership, rewards)
  const fullName = `${profile.first_name} ${profile.last_name}`.trim()
  const details = upcoming.reward
    ? `${upcoming.remaining} ${tenant.program_type === 'stamps' ? 'visit' : 'point'}${upcoming.remaining === 1 ? '' : 's'} until ${upcoming.reward.name}`
    : 'Your current loyalty balance'
  const textModulesData: JsonObject[] = [
    { id: 'next_reward', header: 'NEXT REWARD', body: details },
    { id: 'member_since', header: 'MEMBER SINCE', body: new Date(membership.joined_at ?? membership.created_at).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }) },
  ]
  if (typeof info.address === 'string') textModulesData.push({ id: 'location', header: 'LOCATION', body: info.address })
  const openingHours = openingHoursText(info.openingHours)
  if (openingHours) textModulesData.push({ id: 'hours', header: 'OPENING HOURS', body: openingHours })
  if (typeof info.generalInfo === 'string') textModulesData.push({ id: 'info', header: 'ABOUT', body: info.generalInfo })
  const links: JsonObject[] = [
    { id: 'profile', uri: `${config.appUrl}/profile?tenant=${encodeURIComponent(tenant.slug)}`, description: 'Member profile' },
  ]
  if (typeof info.phone === 'string') links.push({ id: 'phone', uri: `tel:${info.phone.replace(/[^+\d]/g, '')}`, description: `Call ${tenant.name}` })
  if (typeof info.privacyUrl === 'string') links.push({ id: 'privacy', uri: info.privacyUrl, description: 'Privacy policy' })

  return {
    id: objectId,
    classId: walletClassId(tenant),
    state: 'ACTIVE',
    accountName: fullName,
    accountId: membership.member_number,
    loyaltyPoints: { label: unit, balance: { int: balance } },
    rotatingBarcode: {
      type: 'QR_CODE',
      renderEncoding: 'UTF_8',
      valuePattern: `LUXE1:${input.objectSuffix}:{totp_timestamp_seconds}:{totp_value_0}`,
      totpDetails: {
        periodMillis: '60000',
        algorithm: 'TOTP_SHA1',
        parameters: [{ key: barcodeSecretHex.toUpperCase(), valueLength: 8 }],
      },
      alternateText: `Member ${membership.member_number.slice(-6)}`,
    },
    textModulesData,
    linksModuleData: { uris: links },
  }
}

export async function upsertGoogleWalletPass(input: {
  tenant: TenantRow
  membership: MembershipRow
  profile: ProfileRow
  rewards: RewardRow[]
  objectSuffix: string
  barcodeSecretHex: string
}): Promise<{ objectId: string; classId: string }> {
  await ensureClass(input.tenant)
  const payload = objectPayload(input)
  const objectId = String(payload.id)
  const existing = await walletRequest<JsonObject>(`loyaltyObject/${encodeURIComponent(objectId)}`, { allowNotFound: true })
  if (!existing) await walletRequest('loyaltyObject', { method: 'POST', body: payload })
  else {
    const { id: _id, classId: _classId, ...updates } = payload
    await walletRequest(`loyaltyObject/${encodeURIComponent(objectId)}`, { method: 'PATCH', body: updates })
  }
  return { objectId, classId: walletClassId(input.tenant) }
}

export function createGoogleWalletSaveUrl(objectId: string, classId: string): string {
  const now = Math.floor(Date.now() / 1000)
  // The save JWT references the object created through the authenticated REST API. It contains no member PII or barcode secret.
  const token = signRs256({
    iss: config.googleWalletServiceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: now,
    origins: config.googleWalletOrigins,
    payload: { loyaltyObjects: [{ id: objectId, classId }] },
  }, config.googleWalletPrivateKey)
  return `https://pay.google.com/gp/v/save/${token}`
}
