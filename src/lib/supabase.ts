import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { encryptedSessionStorage } from './secure-storage'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
  const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
  if (!url || !publishableKey) throw new Error('Supabase client configuration is incomplete.')
  client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'luxe-auth-session-v1',
      storage: encryptedSessionStorage,
    },
  })
  return client
}

export async function setSupabaseSession(accessToken: string, refreshToken: string): Promise<Session> {
  const { data, error } = await getSupabaseClient().auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  if (error || !data.session) throw new Error(error?.message || 'Unable to save the secure session.')
  return data.session
}

export async function customerAccessToken(): Promise<string | null> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}

export async function clearSupabaseSession(): Promise<void> {
  const auth = getSupabaseClient().auth
  const { error } = await auth.signOut()
  if (!error) return
  const { error: localError } = await auth.signOut({ scope: 'local' })
  if (localError) throw localError
}
