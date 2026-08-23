export type AppMode = 'demo' | 'production'

const requestedMode = (import.meta.env.VITE_APP_MODE as string | undefined)?.toLowerCase()
const explicitlyDemo = requestedMode === 'demo' || String(import.meta.env.VITE_DEMO_MODE ?? '').toLowerCase() === 'true'

export const appMode: AppMode = requestedMode === 'production' || (!import.meta.env.DEV && !explicitlyDemo)
  ? 'production'
  : 'demo'
export const isProductionMode = appMode === 'production'

export function tenantSlugFromLocation(): string {
  const requested = new URLSearchParams(window.location.search).get('tenant')?.trim().toLowerCase()
  const fallback = (import.meta.env.VITE_DEFAULT_TENANT_SLUG as string | undefined)?.trim().toLowerCase()
  return requested || fallback || 'juniper'
}

export function productionConfigurationIssues(): string[] {
  if (!isProductionMode) return []
  const required: Array<[string, unknown]> = [
    ['VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY],
    ['VITE_DEFAULT_TENANT_SLUG', import.meta.env.VITE_DEFAULT_TENANT_SLUG],
  ]
  return required.filter(([, value]) => !String(value ?? '').trim()).map(([name]) => name)
}
