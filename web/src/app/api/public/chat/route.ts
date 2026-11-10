import { sendChatLead } from '@/app/(main)/(site)/actions'

export const dynamic = 'force-dynamic'

/** The website chat ("Selling, letting or management?"). An ordinary route, so it keeps working across updates. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ ok: false, error: 'Please try again.' }, { status: 400 })
  const form = new FormData()
  for (const k of ['goal', 'postcode', 'name', 'phone', 'page', 'hp_check']) form.set(k, typeof body[k] === 'string' ? (body[k] as string).slice(0, 300) : '')
  const res = await sendChatLead(form)
  return Response.json({ ok: !!res.ok, error: res.error, field: res.field }, { status: res.ok ? 200 : 422 })
}
