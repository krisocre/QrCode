import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../server/config.js'

const originalMode = process.env.ALLOW_UNVERIFIED_PHONE_LOGIN

afterEach(() => {
  if (originalMode === undefined) delete process.env.ALLOW_UNVERIFIED_PHONE_LOGIN
  else process.env.ALLOW_UNVERIFIED_PHONE_LOGIN = originalMode
})

describe('phone-only setup mode', () => {
  it('is disabled unless the server-only flag is explicitly true', () => {
    delete process.env.ALLOW_UNVERIFIED_PHONE_LOGIN
    expect(config.allowUnverifiedPhoneLogin).toBe(false)
    process.env.ALLOW_UNVERIFIED_PHONE_LOGIN = 'TRUE'
    expect(config.allowUnverifiedPhoneLogin).toBe(true)
    process.env.ALLOW_UNVERIFIED_PHONE_LOGIN = 'yes'
    expect(config.allowUnverifiedPhoneLogin).toBe(false)
  })
})
