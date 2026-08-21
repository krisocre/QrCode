import { lazy, Suspense } from 'react'

const CustomerApp = lazy(() => import('./customer/CustomerApp').then((module) => ({ default: module.CustomerApp })))
const StaffApp = lazy(() => import('./staff/StaffApp').then((module) => ({ default: module.StaffApp })))
const OwnerApp = lazy(() => import('./owner/OwnerApp').then((module) => ({ default: module.OwnerApp })))

export default function App() {
  const staffRoute = window.location.pathname.startsWith('/staff')
  const adminRoute = /^\/admin\/?$/.test(window.location.pathname)
  return (
    <Suspense fallback={<main className="auth-shell"><div className="loading-line" aria-label="Loading" /></main>}>
      {adminRoute ? <OwnerApp /> : staffRoute ? <StaffApp /> : <CustomerApp />}
    </Suspense>
  )
}
