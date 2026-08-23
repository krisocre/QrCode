import { updateProgram } from '../../server/admin-domain.js'
import { requireSupabaseActor } from '../../server/auth.js'
import { tenantById } from '../../server/domain.js'
import { tenantView } from '../../server/presenters.js'
import { api, body, method, ok } from '../../server/http.js'
import { enumField, integerField, numberField, openingHoursField, record, stringField } from '../../server/validation.js'

export default api(async (request, response) => {
  const actual = method(request, ['GET', 'PATCH'])
  const actor = await requireSupabaseActor(request, ['owner'])
  if (actual === 'GET') return ok(response, { tenant: tenantView(await tenantById(actor.tenantId)) })
  const input = record(body(request))
  const programType = input.programType === undefined ? undefined : enumField(input, 'programType', ['stamps', 'points'] as const)
  const walletBrand = {
    brandColor: stringField(input, 'brandColor', { max: 7, optional: true, pattern: /^#[0-9A-Fa-f]{6}$/ }),
    logoUrl: stringField(input, 'logoUrl', { min: 0, max: 1000, optional: true }),
    heroImageUrl: stringField(input, 'heroImageUrl', { min: 0, max: 1000, optional: true }),
  }
  const publicInfo = {
    address: stringField(input, 'address', { min: 0, max: 300, optional: true }),
    phone: stringField(input, 'phone', { min: 0, max: 30, optional: true }),
    generalInfo: stringField(input, 'generalInfo', { min: 0, max: 1000, optional: true }),
    privacyUrl: stringField(input, 'privacyUrl', { min: 0, max: 1000, optional: true }),
    termsUrl: stringField(input, 'termsUrl', { min: 0, max: 1000, optional: true }),
    openingHours: openingHoursField(input.openingHours),
  }
  const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
  const tenant = await updateProgram(actor, {
    programType,
    stampGoal: integerField(input, 'stampGoal', { min: 1, max: 50, optional: true }),
    pointsPerDollar: numberField(input, 'pointsPerDollar', { min: 0.01, max: 1000, optional: true }),
    name: stringField(input, 'name', { max: 120, optional: true }),
    walletBrand: Object.values(walletBrand).some((value) => value !== undefined) ? clean(walletBrand) : undefined,
    publicInfo: Object.values(publicInfo).some((value) => value !== undefined) ? clean(publicInfo) : undefined,
  })
  ok(response, { tenant })
})
