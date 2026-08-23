import { config } from './config.js'
import { pepperedHash } from './crypto.js'
import { tooManyRequests } from './errors.js'
import { db, rpc } from './supabase.js'

export async function reservePhoneAuthenticationAttempt(input: {
  tenantId: string
  phone: string
  ip: string
}): Promise<void> {
  const phoneHash = pepperedHash(input.phone, config.tokenHashPepper)
  const ipHash = pepperedHash(input.ip, config.tokenHashPepper)
  const available = await rpc<boolean>('otp_rate_limit_available', {
    p_tenant_id: input.tenantId,
    p_phone_hash: phoneHash,
    p_ip_hash: ipHash,
  })
  if (!available) tooManyRequests('Too many sign-in attempts. Try again in one hour.', 3600)
  await db('otp_requests', {
    method: 'POST',
    body: { tenant_id: input.tenantId, phone_hash: phoneHash, ip_hash: ipHash },
  })
}
