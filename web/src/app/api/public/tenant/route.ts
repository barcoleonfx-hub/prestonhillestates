import { registerTenant, TENANT_AREAS } from '@/lib/tenants'

export const dynamic = 'force-dynamic'

const recent = new Map<string, number[]>()
const MOVES = ['As soon as possible', 'Within a month', 'In 1 to 3 months', 'In 3 months or more']
const FURN = ['furnished', 'unfurnished']

/** Tenant registrations from the Renting page: what they're looking for, for the waiting list and email alerts. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return Response.json({ ok: false, error: 'Please try again.' }, { status: 400 })
  const str = (k: string, n = 200) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, n) : '')
  if (str('hp_check')) return Response.json({ ok: true }) // a bot filled in the hidden box
  const name = str('name', 120), email = str('email'), phone = str('phone', 40)
  const fail = (error: string, field: string) => Response.json({ ok: false, error, field }, { status: 422 })
  if (!name) return fail('Please tell us your name.', 'name')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Add your email address so we can send you homes.', 'email')
  if (phone && !/^[0-9+()\s-]{7,20}$/.test(phone)) return fail('That phone number doesn’t look right.', 'phone')
  const key = email.toLowerCase()
  const times = (recent.get(key) || []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= 5) return fail('We’ve already got your details. New homes will be on their way.', 'email')
  recent.set(key, [...times, Date.now()])
  const maxRent = Math.round(Number(b.maxRent)) || null
  const minBeds = b.minBeds === '' || b.minBeds == null ? null : Math.min(Math.max(Math.round(Number(b.minBeds)) || 0, 0), 6)
  const areas = Array.isArray(b.areas) ? (b.areas as unknown[]).map(String).filter((a) => a in TENANT_AREAS).slice(0, 12) : []
  await registerTenant({
    name, email, phone, maxRent: maxRent && maxRent >= 300 && maxRent <= 20000 ? maxRent : null, minBeds, areas,
    moveBy: MOVES.includes(str('moveBy')) ? str('moveBy') : '', pets: b.pets === true, furnishing: FURN.includes(str('furnishing')) ? str('furnishing') : '', notes: str('notes', 600),
  })
  return Response.json({ ok: true })
}
