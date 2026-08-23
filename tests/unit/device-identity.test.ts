import { describe, expect, it } from 'vitest'
import { publicKeyFromDeviceSetupCode } from '../../src/lib/device-identity'

describe('counter setup request', () => {
  const tenantId = '10000000-0000-4000-8000-000000000001'
  const publicKeyJwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: 'R2VuZXJhdGVkUHVibGljS2V5WA',
    y: 'R2VuZXJhdGVkUHVibGljS2V5WQ',
  }
  const code = Buffer.from(JSON.stringify([1, tenantId, publicKeyJwk.x, publicKeyJwk.y])).toString('base64url')

  it('accepts a P-256 request bound to the selected tenant', () => {
    expect(publicKeyFromDeviceSetupCode(code, tenantId)).toEqual(publicKeyJwk)
  })

  it('rejects reuse for a different tenant', () => {
    expect(() => publicKeyFromDeviceSetupCode(code, '20000000-0000-4000-8000-000000000002'))
      .toThrow(/different salon/i)
  })
})
