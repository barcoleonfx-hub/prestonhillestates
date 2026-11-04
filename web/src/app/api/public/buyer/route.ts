import { registerBuyer } from '@/app/(main)/(site)/actions'

export const dynamic = 'force-dynamic'

/** Buyer registrations from the borrowing calculator. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ ok: false, error: 'Please try again.' }, { status: 400 })
  const form = new FormData()
  for (const k of ['name', 'phone', 'email', 'areas', 'budget', 'summary', 'hp_check']) form.set(k, body[k] == null ? '' : String(body[k]).slice(0, 600))
  const res = await registerBuyer({}, form)
  return Response.json({ ok: !!res.ok, error: res.error, field: res.field }, { status: res.ok ? 200 : 422 })
}
