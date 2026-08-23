import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const requestedMode = env.VITE_APP_MODE?.toLowerCase()
  const explicitlyDemo = requestedMode === 'demo' || env.VITE_DEMO_MODE?.toLowerCase() === 'true'
  const productionScreens = requestedMode === 'production' || (command === 'build' && !explicitlyDemo)
  const flavor = productionScreens ? 'production' : 'demo'
  const screen = (name: string) => fileURLToPath(new URL(`./src/entrypoints/${name}.${flavor}.ts`, import.meta.url))

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@screen/customer': screen('customer'),
        '@screen/staff': screen('staff'),
        '@screen/owner': screen('owner'),
      },
    },
    server: { host: '0.0.0.0' },
  }
})
