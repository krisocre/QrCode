const DATABASE_NAME = 'luxe-session-security-v1'
const STORE_NAME = 'encryption-keys'
const KEY_ID = 'supabase-session'

interface StoredKey {
  id: string
  key: CryptoKey
}

interface EncryptedValue {
  version: 1
  iv: string
  ciphertext: string
}

let keyPromise: Promise<CryptoKey> | undefined

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Secure session storage is unavailable.'))
  })
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const database = await openDatabase()
  const existing = await new Promise<StoredKey | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(KEY_ID)
    request.onsuccess = () => resolve(request.result as StoredKey | undefined)
    request.onerror = () => reject(request.error ?? new Error('Unable to read the session encryption key.'))
    transaction.oncomplete = () => database.close()
  })
  if (existing?.key) return existing.key

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const writeDatabase = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = writeDatabase.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ id: KEY_ID, key } satisfies StoredKey)
    transaction.oncomplete = () => { writeDatabase.close(); resolve() }
    transaction.onerror = () => { writeDatabase.close(); reject(transaction.error ?? new Error('Unable to store the session encryption key.')) }
  })
  return key
}

function sessionKey(): Promise<CryptoKey> {
  keyPromise ??= loadOrCreateKey()
  return keyPromise
}

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decode(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function authenticatedStorageKey(key: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(key)
  const bytes = new Uint8Array(encoded.length)
  bytes.set(encoded)
  return bytes.buffer
}

export const encryptedSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = localStorage.getItem(key)
    if (!stored) return null
    try {
      const payload = JSON.parse(stored) as Partial<EncryptedValue>
      if (payload.version !== 1 || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
        throw new Error('Unsupported session format.')
      }
      const cleartext = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: decode(payload.iv),
        additionalData: authenticatedStorageKey(key),
      }, await sessionKey(), decode(payload.ciphertext))
      return new TextDecoder().decode(cleartext)
    } catch {
      localStorage.removeItem(key)
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: authenticatedStorageKey(key),
    }, await sessionKey(), new TextEncoder().encode(value))
    const payload: EncryptedValue = { version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
    localStorage.setItem(key, JSON.stringify(payload))
  },

  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key)
  },
}
