import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, createSign, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import type { JsonWebKey as NodeJsonWebKey } from 'node:crypto'
import { ApiError, unauthorized } from './errors.js'

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

function decodeJsonPart<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  } catch {
    unauthorized('The session token is invalid.')
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function pepperedHash(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex')
}

export function randomHex(bytes = 20): string {
  return randomBytes(bytes).toString('hex')
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(`wallet-barcode:v1:${secret}`).digest()
}

export function encryptWalletSecret(value: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

export function decryptWalletSecret(value: string, secret: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new ApiError(500, 'wallet_secret_invalid', 'Wallet barcode credentials are invalid.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivValue, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new ApiError(500, 'wallet_secret_invalid', 'Wallet barcode credentials could not be decrypted.')
  }
}

export function opaqueSuffix(seed: string, secret: string, length = 32): string {
  return createHmac('sha256', secret).update(seed).digest('base64url').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, length)
}

export function signHs256(payload: Record<string, unknown>, secret: string, headerExtra: Record<string, unknown> = {}): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...headerExtra }))
  const encodedPayload = base64url(JSON.stringify(payload))
  const content = `${header}.${encodedPayload}`
  const signature = createHmac('sha256', secret).update(content).digest('base64url')
  return `${content}.${signature}`
}

export function verifyHs256<T extends { exp?: number; nbf?: number; iss?: string; aud?: string }>(
  token: string,
  secret: string,
  expected: { issuer?: string; audience?: string } = {},
): T {
  const parts = token.split('.')
  if (parts.length !== 3) unauthorized('The session token is invalid.')
  const content = `${parts[0]}.${parts[1]}`
  const actual = Buffer.from(parts[2], 'base64url')
  const expectedSignature = createHmac('sha256', secret).update(content).digest()
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) unauthorized('The session token is invalid.')
  const header = decodeJsonPart<{ alg?: string }>(parts[0])
  if (header.alg !== 'HS256') unauthorized('The session token uses an unsupported algorithm.')
  const payload = decodeJsonPart<T>(parts[1])
  const now = Math.floor(Date.now() / 1000)
  if (payload.nbf !== undefined && payload.nbf > now + 30) unauthorized('The session is not active yet.')
  if (payload.exp !== undefined && payload.exp <= now) unauthorized('The session has expired.')
  if (expected.issuer && payload.iss !== expected.issuer) unauthorized('The session token has an invalid issuer.')
  if (expected.audience && payload.aud !== expected.audience) unauthorized('The session token has an invalid audience.')
  return payload
}

export function signRs256(payload: Record<string, unknown>, privateKey: string, keyId?: string): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(keyId ? { kid: keyId } : {}) }))
  const encodedPayload = base64url(JSON.stringify(payload))
  const content = `${header}.${encodedPayload}`
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(content)
    signer.end()
    return `${content}.${signer.sign(privateKey, 'base64url')}`
  } catch {
    throw new ApiError(503, 'wallet_credentials_invalid', 'Google Wallet credentials could not sign a request.')
  }
}

function hotp(secretHex: string, counter: number, digits = 8): string {
  const buffer = Buffer.alloc(8)
  const high = Math.floor(counter / 0x100000000)
  const low = counter >>> 0
  buffer.writeUInt32BE(high >>> 0, 0)
  buffer.writeUInt32BE(low, 4)
  const digest = createHmac('sha1', Buffer.from(secretHex, 'hex')).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(code % 10 ** digits).padStart(digits, '0')
}

export function verifyWalletTotp(
  secretHex: string,
  timestampSeconds: number,
  value: string,
  options: { periodSeconds?: number; digits?: number; skewPeriods?: number; nowSeconds?: number } = {},
): boolean {
  if (!/^[0-9a-f]{32,}$/i.test(secretHex)) return false
  const period = options.periodSeconds ?? 60
  const digits = options.digits ?? 8
  const skew = options.skewPeriods ?? 1
  const current = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isInteger(timestampSeconds) || Math.abs(current - timestampSeconds) > period * (skew + 1)) return false
  const presented = Buffer.from(value)
  for (let offset = -skew; offset <= skew; offset += 1) {
    const calculated = Buffer.from(hotp(secretHex, Math.floor(timestampSeconds / period) + offset, digits))
    if (presented.length === calculated.length && timingSafeEqual(presented, calculated)) return true
  }
  return false
}

export function verifyDeviceEventSignature(publicKeyJwk: JsonWebKey, canonicalEvent: string, signature: string): boolean {
  try {
    if (publicKeyJwk.kty !== 'EC' || publicKeyJwk.crv !== 'P-256') return false
    const key = createPublicKey({ key: publicKeyJwk as NodeJsonWebKey, format: 'jwk' })
    return verify('sha256', Buffer.from(canonicalEvent, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}
