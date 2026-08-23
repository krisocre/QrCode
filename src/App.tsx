import { lazy, Suspense } from 'react'

const CustomerScreen = lazy(() => import('@screen/customer'))
const StaffScreen = lazy(() => import('@screen/staff'))
const OwnerScreen = lazy(() => import('@screen/owner'))

export default function App() {
  const staffRoute = window.location.pathname.startsWith('/staff')
  const adminRoute = /^\/admin\/?$/.test(window.location.pathname)
  const Screen = adminRoute ? OwnerScreen : staffRoute ? StaffScreen : CustomerScreen
  return (
    <Suspense fallback={<main className="auth-shell"><div className="loading-line" aria-label="Loading" /></main>}>
      <Screen />
    </Suspense>
  )
}
