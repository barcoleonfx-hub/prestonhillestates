import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { campaigns } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { audienceList, parseAudience, peopleCsv, recipientList } from '@/lib/campaign-data'
import { kebab } from '@/lib/util'

export const dynamic = 'force-dynamic'

/** Everyone a campaign is going to (or went to, with how each send went), as a spreadsheet. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentAdmin()
  if (!me) return new Response('Sign in first', { status: 403 })
  await ready()
  const { id } = await params
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) return new Response('Not found', { status: 404 })
  const list = c.status === 'draft' ? await audienceList(parseAudience(c), '', 0, 0) : await recipientList(c.id, '', '', 0, 0)
  return new Response('﻿' + peopleCsv(list.people), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kebab(c.name) || 'campaign'}-people.csv"`, 'Cache-Control': 'no-store' },
  })
}
