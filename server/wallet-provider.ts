import { createGoogleWalletSaveUrl, upsertGoogleWalletPass } from './google-wallet.js'
import type { MembershipRow, ProfileRow, RewardRow, TenantRow } from './types.js'

export interface WalletPassInput {
  tenant: TenantRow
  membership: MembershipRow
  profile: ProfileRow
  rewards: RewardRow[]
  objectSuffix: string
  barcodeSecretHex: string
}

export interface WalletProvider {
  readonly name: 'google' | 'apple'
  upsert(input: WalletPassInput): Promise<{ objectId: string; classId: string }>
  saveUrl(objectId: string, classId: string): string
}

const googleProvider: WalletProvider = {
  name: 'google',
  upsert: upsertGoogleWalletPass,
  saveUrl: createGoogleWalletSaveUrl,
}

export function walletProvider(name: 'google'): WalletProvider {
  if (name === 'google') return googleProvider
  throw new Error(`Wallet provider ${String(name)} is not supported.`)
}
