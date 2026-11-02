import { currentAdmin } from '@/lib/auth'
import { findMatches, getContact, openTasks, timelineFor } from '@/lib/contacts'
import { rolesOf } from '@/lib/crm-options'

export const dynamic = 'force-dynamic'

/** ?q= searches by number, name, email or address while a call is being logged. ?id= returns one person's summary. */
export async function GET(req: Request) {
  const me = await currentAdmin()
  if (!me) return Response.json({ error: 'signed out' }, { status: 401 })
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (id) {
    const c = await getContact(id)
    if (!c) return Response.json({ error: 'not found' }, { status: 404 })
    const [timeline, open] = await Promise.all([timelineFor(c), openTasks({ contactId: c.id })])
    return Response.json({
      contact: {
        id: c.id, name: c.name, phone: c.phone, email: c.email, roles: rolesOf(c.roles), areas: c.areas, minBeds: c.minBeds,
        maxPrice: c.maxPrice, position: c.position, address: c.address, ownerName: c.ownerName, source: c.source,
      },
      recent: timeline.filter((t) => t.type !== 'created').slice(0, 4),
      tasks: open.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, assigneeName: t.assigneeName, mine: t.assignedTo === me.id })),
    })
  }
  const q = (url.searchParams.get('q') || '').slice(0, 80)
  return Response.json({ matches: await findMatches(q) })
}
