import { useSyncExternalStore } from 'react'
import { loyaltyStore } from '../lib/store'

export function useDatabase() {
  return useSyncExternalStore(loyaltyStore.subscribe, loyaltyStore.getSnapshot)
}
