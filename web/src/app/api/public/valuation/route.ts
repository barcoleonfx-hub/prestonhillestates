import { sendValuationRequest } from '@/app/(main)/(site)/actions'

export const dynamic = 'force-dynamic'

/** Valuation requests from the homepage form and pop-up. Same checks and storage as the property pages' pop-up. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ ok: false, error: 'Please try again.' }, { status: 400 })
  const form = new FormData()
  for (const k of ['name', 'phone', 'email', 'postcode', 'intent', 'address', 'propertyType', 'bedrooms', 'timescale', 'contactTime', 'notes', 'hp_check']) form.set(k, typeof body[k] === 'string' ? (body[k] as string).slice(0, 1000) : '')
  const res = await sendValuationRequest({}, form)
  return Response.json({ ok: !!res.ok, error: res.error, field: res.field, estimate: res.estimate ?? null }, { status: res.ok ? 200 : 422 })
}
