import { notFound } from '../server/errors.js'
import { api } from '../server/http.js'
import type { ApiHandler, ApiRequest, ApiResponse } from '../server/types.js'
import health from '../server/api-routes/health.js'
import maintenance from '../server/api-routes/maintenance.js'
import adminCustomers from '../server/api-routes/admin/customers.js'
import adminDeviceEnrollments from '../server/api-routes/admin/device-enrollments.js'
import adminOverview from '../server/api-routes/admin/overview.js'
import adminProgram from '../server/api-routes/admin/program.js'
import adminRewards from '../server/api-routes/admin/rewards.js'
import adminStaff from '../server/api-routes/admin/staff.js'
import authLogout from '../server/api-routes/auth/logout.js'
import authPhoneLogin from '../server/api-routes/auth/phone-login.js'
import authRefresh from '../server/api-routes/auth/refresh.js'
import authRequestOtp from '../server/api-routes/auth/request-otp.js'
import authVerifyOtp from '../server/api-routes/auth/verify-otp.js'
import customerEnroll from '../server/api-routes/customer/enroll.js'
import customerProfile from '../server/api-routes/customer/profile.js'
import customerRedemption from '../server/api-routes/customer/redemption.js'
import customerWallet from '../server/api-routes/customer/wallet.js'
import publicTenant from '../server/api-routes/public/tenant.js'
import staffAudit from '../server/api-routes/staff/audit.js'
import staffCustomer from '../server/api-routes/staff/customer.js'
import staffLogout from '../server/api-routes/staff/logout.js'
import staffScan from '../server/api-routes/staff/scan.js'
import staffSearch from '../server/api-routes/staff/search.js'
import staffUnlock from '../server/api-routes/staff/unlock.js'
import staffConfirm from '../server/api-routes/staff/transactions/confirm.js'
import staffUndo from '../server/api-routes/staff/transactions/undo.js'
import walletSync from '../server/api-routes/wallet/sync.js'

const routes: Record<string, ApiHandler> = {
  health,
  maintenance,
  'admin/customers': adminCustomers,
  'admin/device-enrollments': adminDeviceEnrollments,
  'admin/overview': adminOverview,
  'admin/program': adminProgram,
  'admin/rewards': adminRewards,
  'admin/staff': adminStaff,
  'auth/logout': authLogout,
  'auth/phone-login': authPhoneLogin,
  'auth/refresh': authRefresh,
  'auth/request-otp': authRequestOtp,
  'auth/verify-otp': authVerifyOtp,
  'customer/enroll': customerEnroll,
  'customer/profile': customerProfile,
  'customer/redemption': customerRedemption,
  'customer/wallet': customerWallet,
  'public/tenant': publicTenant,
  'staff/audit': staffAudit,
  'staff/customer': staffCustomer,
  'staff/logout': staffLogout,
  'staff/scan': staffScan,
  'staff/search': staffSearch,
  'staff/unlock': staffUnlock,
  'staff/transactions/confirm': staffConfirm,
  'staff/transactions/undo': staffUndo,
  'wallet/sync': walletSync,
}

function requestPath(request: ApiRequest): string {
  const routed = request.query.route
  if (typeof routed === 'string' && routed) return routed.replace(/^\/+|\/+$/g, '')
  if (Array.isArray(routed) && routed[0]) return routed[0].replace(/^\/+|\/+$/g, '')
  const url = (request as ApiRequest & { url?: string }).url ?? '/api'
  const pathname = new URL(url, 'https://luxe-loyalty.local').pathname
  return pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '')
}

export default api(async (request: ApiRequest, response: ApiResponse) => {
  const handler = routes[requestPath(request)]
  if (!handler) notFound('This API endpoint does not exist.')
  await handler(request, response)
})
