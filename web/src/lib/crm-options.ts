// Vocabularies and helpers for contacts and the call log. Safe to import from client components.

export const CALLER_TYPES = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'seller', label: 'Seller' },
  { value: 'landlord', label: 'Landlord' },
  { value: 'other', label: 'Other' },
] as const

export const roleLabel = (r: string) => CALLER_TYPES.find((c) => c.value === r)?.label ?? r

export const DIRECTIONS = [
  { value: 'in', label: 'They called' },
  { value: 'out', label: 'We called' },
  { value: 'walk_in', label: 'Walk-in' },
] as const

export const directionLabel = (d: string) =>
  ({ in: 'Incoming call', out: 'Outgoing call', walk_in: 'Walk-in' } as Record<string, string>)[d] ?? 'Call'

export const SOURCES = [
  'Zoopla', 'OnTheMarket', 'Our website', 'For sale / to let board', 'Walked past the office',
  'Recommended', 'Past client', 'Leaflet', 'Other',
] as const

export const POSITIONS: Record<string, string[]> = {
  buyer: ['First time buyer', 'Nothing to sell', 'Property to sell', 'Under offer on theirs', 'Cash buyer', 'Mortgage agreed in principle', 'Investor'],
  tenant: ['Ready now', 'Within a month', 'Just looking', 'Has a guarantor', 'Housing benefit / UC', 'Has pets'],
  seller: ['Ready to sell', 'Thinking about it', 'Probate', 'Already on with another agent'],
  landlord: ['Vacant now', 'Tenant leaving soon', 'Portfolio landlord', 'Already with another agent'],
  other: [],
}

export const CALL_NEXT = [
  { value: 'callback', label: 'Call back' },
  { value: 'viewing', label: 'Book viewing' },
  { value: 'valuation', label: 'Book valuation' },
  { value: 'none', label: 'No action needed' },
] as const

export const nextLabel = (v: string) => CALL_NEXT.find((n) => n.value === v)?.label ?? v

/** Digits only, with +44 / 0044 turned into a leading 0, so "+44 7700 900123" and "07700900123" match. */
export function normPhone(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.startsWith('0044')) d = '0' + d.slice(4)
  else if (d.startsWith('44') && d.length >= 11) d = '0' + d.slice(2)
  return d
}

export const normEmail = (raw: string | null | undefined) => (raw ?? '').trim().toLowerCase()

/** "07700900123" → "07700 900123", London "02081277001" → "020 8127 7001". Leaves anything unusual alone. */
export function prettyPhone(raw: string | null | undefined): string {
  const d = normPhone(raw)
  if (/^02\d{9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`
  if (/^0\d{10}$/.test(d)) return `${d.slice(0, 5)} ${d.slice(5)}`
  return (raw ?? '').trim()
}

export const rolesOf = (csv: string | null | undefined) => (csv ?? '').split(',').filter(Boolean)
export const addRole = (csv: string, role: string) => [...new Set([...rolesOf(csv), role])].join(',')

export function moneyShort(n: number | null | undefined): string {
  if (!n) return ''
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.?0+$/, '')}m`
  if (n >= 10_000) return `£${Math.round(n / 1000)}k`
  return `£${n.toLocaleString('en-GB')}`
}

/** Accepts "450k", "£1.2m", "450,000", "1500" → whole pounds. */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[£,\s]/g, '')
  if (!s) return null
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s)
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1000 : 1)
  return Number.isFinite(n) ? Math.round(n) : null
}
