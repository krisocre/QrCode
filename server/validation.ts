import { createPublicKey, type JsonWebKey as NodeJsonWebKey } from 'node:crypto'
import { badRequest } from './errors.js'

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) badRequest('Request body must be a JSON object.')
  return value as Record<string, unknown>
}

export function stringField(
  input: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean; pattern?: RegExp } = {},
): string | undefined {
  const value = input[key]
  if ((value === undefined || value === null) && options.optional) return undefined
  if (typeof value !== 'string') badRequest(`${key} must be a string.`)
  const trimmed = value.trim()
  if (options.optional && trimmed.length === 0 && options.min !== 0) return undefined
  if (trimmed.length < (options.min ?? 1)) badRequest(`${key} is required.`)
  if (trimmed.length > (options.max ?? 500)) badRequest(`${key} is too long.`)
  if (options.pattern && !options.pattern.test(trimmed)) badRequest(`${key} has an invalid format.`)
  return trimmed
}

export function publicP256Jwk(value: unknown): JsonWebKey {
  const key = record(value)
  const coordinatePattern = /^[A-Za-z0-9_-]{43}$/
  if (
    key.kty !== 'EC'
    || key.crv !== 'P-256'
    || typeof key.x !== 'string'
    || typeof key.y !== 'string'
    || !coordinatePattern.test(key.x)
    || !coordinatePattern.test(key.y)
  ) {
    badRequest('Device public key must be an ECDSA P-256 public JWK.')
  }
  if (key.d !== undefined) badRequest('Device public key must not include private key material.')
  const publicKey: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: key.x,
    y: key.y,
    ext: true,
    key_ops: ['verify'],
  }
  try {
    createPublicKey({ key: publicKey as NodeJsonWebKey, format: 'jwk' })
  } catch {
    badRequest('Device public key is not a valid P-256 curve point.')
  }
  return publicKey
}

export function booleanField(input: Record<string, unknown>, key: string): boolean {
  if (typeof input[key] !== 'boolean') badRequest(`${key} must be true or false.`)
  return input[key] as boolean
}

export function integerField(
  input: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): number | undefined {
  const value = input[key]
  if ((value === undefined || value === null) && options.optional) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) badRequest(`${key} must be a whole number.`)
  if (options.min !== undefined && value < options.min) badRequest(`${key} must be at least ${options.min}.`)
  if (options.max !== undefined && value > options.max) badRequest(`${key} must be no more than ${options.max}.`)
  return value
}

export function numberField(
  input: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): number | undefined {
  const value = input[key]
  if ((value === undefined || value === null) && options.optional) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) badRequest(`${key} must be a number.`)
  if (options.min !== undefined && value < options.min) badRequest(`${key} must be at least ${options.min}.`)
  if (options.max !== undefined && value > options.max) badRequest(`${key} must be no more than ${options.max}.`)
  return value
}

export function enumField<T extends string>(input: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = stringField(input, key)
  if (!values.includes(value as T)) badRequest(`${key} must be one of: ${values.join(', ')}.`)
  return value as T
}

export function uuid(value: string | undefined, name: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    badRequest(`${name} must be a valid identifier.`)
  }
  return value
}

export function tenantSlug(value: string | undefined): string {
  if (!value || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) badRequest('tenantSlug has an invalid format.')
  return value
}

export function phoneE164(value: string | undefined): string {
  if (!value || !/^\+[1-9]\d{7,14}$/.test(value)) badRequest('Enter a valid phone number including country code.')
  return value
}

export function safeSearch(value: string | undefined): string {
  const cleaned = (value ?? '').trim().replace(/[,%()]/g, '')
  if (cleaned.length < 2) badRequest('Enter at least two characters to search.')
  if (cleaned.length > 80) badRequest('Search is too long.')
  return cleaned
}

export function openingHoursField(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return badRequest('openingHours must be a day-to-hours object.')
  }
  const entries = Object.entries(value)
  if (entries.length > 7) badRequest('openingHours cannot contain more than seven days.')
  const hours: Record<string, string> = {}
  for (const [dayValue, scheduleValue] of entries) {
    const day = dayValue.trim()
    if (!day || day.length > 20) badRequest('Each opening-hours day must be between 1 and 20 characters.')
    if (typeof scheduleValue !== 'string') badRequest(`Opening hours for ${day} must be text.`)
    const schedule = scheduleValue.trim()
    if (!schedule || schedule.length > 100) badRequest(`Opening hours for ${day} must be between 1 and 100 characters.`)
    hours[day] = schedule
  }
  return hours
}
