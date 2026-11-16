import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { exportPerson } from '@/lib/personal-data'

export const dynamic = 'force-dynamic'

/** Everything we hold about a person, as a JSON file to send them (a subject access request). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const data = await exportPerson(id)
  if (!data) return new Response('Not found', { status: 404 })
  await audit(me.id, 'exported personal data', 'contact', id)
  const slug = data.person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'person'
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="preston-hill-data-${slug}-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
