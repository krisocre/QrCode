import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  decryptWalletSecret,
  encryptWalletSecret,
  verifyWalletTotp,
} from '../../server/crypto.js'
import { requireCron } from '../../server/cron.js'
import { createGoogleWalletSaveUrl } from '../../server/google-wallet.js'
import { body } from '../../server/http.js'
import { canonicalOfflineVisit, offlineVisitIdempotencyKey } from '../../server/offline-events.js'
import { confirmTransaction } from '../../server/transactions.js'
import type { Actor, ApiRequest } from '../../server/types.js'
import { openingHoursField, phoneE164, publicP256Jwk, stringField, tenantSlug } from '../../server/validation.js'

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL = 'wallet@example.iam.gserviceaccount.com'
  process.env.GOOGLE_WALLET_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000022000000'
  process.env.APP_URL = 'https://loyalty.example.com'
  process.env.CRON_SECRET = 'cron-secret-for-tests-only-1234567890'
})

describe('Wallet security primitives', () => {
  it('encrypts barcode credentials and refuses a different key', () => {
    const encrypted = encryptWalletSecret('31323334353637383930', 'a'.repeat(32))
    expect(encrypted).not.toContain('31323334353637383930')
    expect(decryptWalletSecret(encrypted, 'a'.repeat(32))).toBe('31323334353637383930')
    expect(() => decryptWalletSecret(encrypted, 'b'.repeat(32))).toThrow(/could not be decrypted/i)
  })

  it('validates the RFC 6238 SHA-1 test vector', () => {
    const secret = Buffer.from('12345678901234567890').toString('hex')
    expect(verifyWalletTotp(secret, 59, '94287082', {
      periodSeconds: 30,
      digits: 8,
      skewPeriods: 0,
      nowSeconds: 59,
    })).toBe(true)
    expect(verifyWalletTotp(secret, 59, '94287081', {
      periodSeconds: 30,
      digits: 8,
      skewPeriods: 0,
      nowSeconds: 59,
    })).toBe(false)
  })

  it('keeps member data and rotating secrets out of the save JWT', () => {
    const url = createGoogleWalletSaveUrl('3388000000022000000.member_opaque', '3388000000022000000.luxe_loyalty')
    const token = url.split('/').at(-1)!
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    expect(payload.payload).toEqual({
      loyaltyObjects: [{
        id: '3388000000022000000.member_opaque',
        classId: '3388000000022000000.luxe_loyalty',
      }],
    })
    expect(JSON.stringify(payload)).not.toMatch(/accountName|phone|barcode|secret/i)
  })
})

describe('Offline visit contract', () => {
  const actor: Actor = {
    id: '3b9a7b5c-e055-47aa-894c-b3f26f7f6402',
    tenantId: 'c0c35151-9e56-42f5-afd3-ae8f4dc8fc41',
    role: 'staff',
    firstName: 'Maya',
    lastName: '',
    deviceId: 'b18a6383-31b7-4528-afdd-8740405822ee',
    authType: 'staff-session',
  }

  it('builds a deterministic signed event and idempotency key', () => {
    const event = {
      occurredAt: '2026-08-22T12:00:00.000Z',
      deviceEventId: '4c24d03e-8479-4431-ae25-824e77215b72',
      deviceSignature: 'unused',
    }
    expect(canonicalOfflineVisit({ actor, customerId: '14fe434d-193e-44af-91e1-3949ffcc7cee', event })).toBe([
      'luxe-offline-visit-v1', actor.deviceId, actor.tenantId, actor.id,
      '14fe434d-193e-44af-91e1-3949ffcc7cee', 'visit', '1', event.occurredAt, event.deviceEventId,
    ].join('\n'))
    expect(offlineVisitIdempotencyKey(actor.deviceId!, event.deviceEventId))
      .toBe(`offline:${actor.deviceId}:${event.deviceEventId}`)
  })
})

describe('public input validation', () => {
  it('accepts canonical tenant and phone values and rejects ambiguous input', () => {
    expect(tenantSlug('luxe-hair')).toBe('luxe-hair')
    expect(phoneE164('+14165550182')).toBe('+14165550182')
    expect(() => tenantSlug('../admin')).toThrow(/invalid format/i)
    expect(() => phoneE164('416-555-0182')).toThrow(/country code/i)
  })

  it('normalizes the seven-day salon schedule', () => {
    expect(openingHoursField({ Monday: ' 9:00 AM - 6:00 PM ', Sunday: 'Closed' })).toEqual({
      Monday: '9:00 AM - 6:00 PM',
      Sunday: 'Closed',
    })
  })

  it('rejects malformed opening-hours values', () => {
    expect(() => openingHoursField('Monday: 9-5')).toThrow(/day-to-hours object/i)
    expect(() => openingHoursField({ Monday: 9 })).toThrow(/must be text/i)
    expect(() => openingHoursField({ Monday: '' })).toThrow(/between 1 and 100/i)
    expect(() => openingHoursField(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`Day ${index}`, 'Closed']))))
      .toThrow(/more than seven/i)
  })

  it('accepts blank optional form fields without weakening required fields', () => {
    expect(stringField({ lastName: '' }, 'lastName', { optional: true })).toBeUndefined()
    expect(stringField({ generalInfo: '' }, 'generalInfo', { min: 0, optional: true })).toBe('')
    expect(() => stringField({ firstName: '' }, 'firstName')).toThrow(/required/i)
  })

  it('stores only a valid public P-256 device key', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const publicJwk = publicKey.export({ format: 'jwk' })
    const sanitized = publicP256Jwk({ ...publicJwk, kid: 'ignored-client-label' })
    expect(sanitized).toEqual({
      kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y, ext: true, key_ops: ['verify'],
    })
    expect(() => publicP256Jwk(privateKey.export({ format: 'jwk' }))).toThrow(/private key material/i)
    expect(() => publicP256Jwk({ kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) }))
      .toThrow(/curve point/i)
  })

  it('enforces the body limit after the platform has parsed JSON', () => {
    const request = (value: unknown): ApiRequest => ({ method: 'POST', headers: {}, query: {}, body: value })
    expect(body(request({ value: 'small' }))).toEqual({ value: 'small' })
    expect(() => body(request({ value: 'x'.repeat(33_000) }))).toThrow(/too large/i)
  })
})

describe('maintenance authentication', () => {
  const request = (authorization?: string): ApiRequest => ({
    method: 'GET',
    headers: authorization ? { authorization } : {},
    query: {},
  })

  it('accepts only the exact CRON_SECRET bearer token', () => {
    expect(() => requireCron(request(`Bearer ${process.env.CRON_SECRET}`))).not.toThrow()
    expect(() => requireCron(request())).toThrow(/not authorized/i)
    expect(() => requireCron(request('Bearer wrong-secret'))).toThrow(/not authorized/i)
    expect(() => requireCron(request(`bearer ${process.env.CRON_SECRET}`))).toThrow(/not authorized/i)
  })
})

describe('transaction request boundary', () => {
  const actor: Actor = {
    id: '3b9a7b5c-e055-47aa-894c-b3f26f7f6402',
    tenantId: 'c0c35151-9e56-42f5-afd3-ae8f4dc8fc41',
    role: 'staff',
    firstName: 'Maya',
    lastName: '',
    deviceId: 'b18a6383-31b7-4528-afdd-8740405822ee',
    authType: 'staff-session',
  }
  const request: ApiRequest = {
    method: 'POST',
    headers: { 'idempotency-key': 'transaction:test-request' },
    query: {},
  }

  it('rejects fields that do not belong to the selected transaction kind or source', async () => {
    await expect(confirmTransaction(request, actor, {
      customerId: '14fe434d-193e-44af-91e1-3949ffcc7cee', kind: 'visit', source: 'manual', points: 20,
    })).rejects.toThrow(/custom-points/i)
    await expect(confirmTransaction(request, actor, {
      customerId: '14fe434d-193e-44af-91e1-3949ffcc7cee', kind: 'visit', source: 'manual',
      rewardId: '3a0df6ba-92f0-441b-9c7e-8c1999b21234',
    })).rejects.toThrow(/reward redemption/i)
    await expect(confirmTransaction(request, actor, {
      customerId: '14fe434d-193e-44af-91e1-3949ffcc7cee', kind: 'visit', source: 'manual', scanToken: 'signed-scan-token',
    })).rejects.toThrow(/scanned transaction/i)
  })
})
