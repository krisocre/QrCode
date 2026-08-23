const DATABASE_NAME = 'luxe-device-security-v1'
const STORE_NAME = 'signing-identities'

interface StoredIdentity {
  tenantId: string
  privateKey: CryptoKey
  publicKeyJwk: JsonWebKey
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'tenantId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Device security storage is unavailable.'))
  })
}

async function readIdentity(tenantId: string): Promise<StoredIdentity | undefined> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(tenantId)
    request.onsuccess = () => resolve(request.result as StoredIdentity | undefined)
    request.onerror = () => reject(request.error ?? new Error('Unable to read this device identity.'))
    transaction.oncomplete = () => database.close()
  })
}

async function writeIdentity(identity: StoredIdentity): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(identity)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Unable to secure this device identity.')) }
  })
}

export async function ensureDeviceIdentity(tenantId: string): Promise<StoredIdentity> {
  const existing = await readIdentity(tenantId)
  if (existing) return existing
  if (!crypto.subtle) throw new Error('This browser cannot create a secure device identity.')
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  )
  const identity: StoredIdentity = {
    tenantId,
    privateKey: pair.privateKey,
    publicKeyJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
  }
  await writeIdentity(identity)
  return identity
}

function base64Url(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes)
  let binary = ''
  for (const value of data) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlText(value: string): string {
  return base64Url(new TextEncoder().encode(value).buffer)
}

function decodeBase64UrlText(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

export async function createDeviceSetupCode(tenantId: string): Promise<string> {
  const identity = await ensureDeviceIdentity(tenantId)
  return base64UrlText(JSON.stringify([1, tenantId, identity.publicKeyJwk.x, identity.publicKeyJwk.y]))
}

export function publicKeyFromDeviceSetupCode(code: string, tenantId: string): JsonWebKey {
  try {
    const value = JSON.parse(decodeBase64UrlText(code)) as unknown
    const compact = Array.isArray(value) ? value : null
    const legacy = !compact && value && typeof value === 'object'
      ? value as { version?: unknown; tenantId?: unknown; publicKeyJwk?: JsonWebKey }
      : null
    const version = compact?.[0] ?? legacy?.version
    const requestTenantId = compact?.[1] ?? legacy?.tenantId
    const key: JsonWebKey | undefined = compact
      ? { kty: 'EC', crv: 'P-256', x: typeof compact[2] === 'string' ? compact[2] : undefined, y: typeof compact[3] === 'string' ? compact[3] : undefined }
      : legacy?.publicKeyJwk
    if (version !== 1 || requestTenantId !== tenantId || key?.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y) {
      throw new Error('invalid')
    }
    return key
  } catch {
    throw new Error('This counter setup request is invalid or belongs to a different salon.')
  }
}

export async function signDeviceEvent(tenantId: string, canonicalEvent: string): Promise<string> {
  const identity = await readIdentity(tenantId)
  if (!identity) throw new Error('This enrollment was created on another device. Re-enroll from this counter device to enable secure offline visits.')
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    new TextEncoder().encode(canonicalEvent),
  )
  return base64Url(signature)
}
