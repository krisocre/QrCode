export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  const local = digits.startsWith('1') ? digits.slice(1) : digits
  if (!local.length) return '+1 '
  if (local.length <= 3) return `+1 (${local}`
  if (local.length <= 6) return `+1 (${local.slice(0, 3)}) ${local.slice(3)}`
  return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6, 10)}`
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return `+${digits.startsWith('1') ? digits : `1${digits}`}`
}

export function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return phone
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export function shortTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

export function relativeVisit(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}
