import { sendValuationRequest } from '@/app/(main)/(site)/actions'

export const dynamic = 'force-dynamic'

/** Valuation requests from the homepage form and pop-up. Same checks and storage as the property pages' pop-up. */
export async function POST(req: Request) {
  // JSON from the pop-ups; a plain form post (multipart or urlencoded) from the homepage's valuation form.
  const type = req.headers.get('content-type') ?? ''
  const body = (/form-data|x-www-form-urlencoded/.test(type)
    ? await req.formData().then((f) => {
      const o: Record<string, unknown> = {}
      for (const [k, v] of f) if (typeof v === 'string') o[k] = /^consent_/.test(k) ? v === 'on' || v === 'true' : v
      return o
    }).catch(() => null)
    : await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ ok: false, error: 'Please try again.' }, { status: 400 })
  const form = new FormData()
  for (const k of ['name', 'phone', 'email', 'postcode', 'intent', 'address', 'propertyType', 'bedrooms', 'timescale', 'contactTime', 'notes', 'hp_check', 'attribution', 'consent_email', 'consent_whatsapp', 'magnet']) form.set(k, typeof body[k] === 'string' ? (body[k] as string).slice(0, 1000) : typeof body[k] === 'boolean' ? String(body[k]) : '')
  const res = await sendValuationRequest({}, form)
  return Response.json({ ok: !!res.ok, error: res.error, field: res.field, estimate: res.estimate ?? null }, { status: res.ok ? 200 : 422 })
}
