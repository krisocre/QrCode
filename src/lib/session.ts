const KEY_NAME = 'juniper-device-key-v1'
const SESSION_NAME = 'juniper-customer-session-v1'

interface CustomerSession {
  profileId: string
  tenantId: string
  expiresAt: number
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

async function deviceKey(): Promise<CryptoKey> {
  let encoded = localStorage.getItem(KEY_NAME)
  if (!encoded) {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    encoded = bytesToBase64(raw)
    localStorage.setItem(KEY_NAME, encoded)
  }
  return crypto.subtle.importKey('raw', base64ToBytes(encoded), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function saveCustomerSession(profileId: string, tenantId: string): Promise<void> {
  const key = await deviceKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const payload: CustomerSession = { profileId, tenantId, expiresAt: Date.now() + 30 * 86_400_000 }
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  localStorage.setItem(SESSION_NAME, JSON.stringify({
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  }))
}

export async function readCustomerSession(): Promise<CustomerSession | null> {
  try {
    const stored = localStorage.getItem(SESSION_NAME)
    if (!stored) return null
    const parsed = JSON.parse(stored) as { iv: string; data: string }
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(parsed.iv) },
      await deviceKey(),
      base64ToBytes(parsed.data),
    )
    const session = JSON.parse(new TextDecoder().decode(plain)) as CustomerSession
    if (session.expiresAt <= Date.now()) {
      clearCustomerSession()
      return null
    }
    return session
  } catch {
    clearCustomerSession()
    return null
  }
}

export function clearCustomerSession(): void {
  localStorage.removeItem(SESSION_NAME)
}
