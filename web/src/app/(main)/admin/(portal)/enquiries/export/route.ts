import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { enquiryLabel, enquirySide } from '@/lib/enquiry-labels'

export const dynamic = 'force-dynamic'

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** Enquiries as a spreadsheet (CSV): the unsorted ones by default, so they can be checked or shared. */
export async function GET(req: Request) {
  if (!(await currentAdmin())) return new Response('Sign in first', { status: 401 })
  await ready()
  const want = new URL(req.url).searchParams.get('side') ?? 'unsorted'
  const rows = await db.select({ e: enquiries, channel: properties.channel, roles: contacts.roles }).from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(contacts, eq(enquiries.contactId, contacts.id))
  const list = rows.filter((r) => (enquirySide(r.e, r.channel, r.roles) ?? 'unsorted') === want || want === 'all')
  const head = ['Date', 'Name', 'Email', 'Phone', 'Source', 'Type', 'Postcode', 'What it says']
  const csv = [head, ...list.map(({ e }) => [e.createdAt.slice(0, 16).replace('T', ' '), e.name, e.email, e.phone, e.source, enquiryLabel(e), e.postcode, (e.message ?? '').replace(/\s*\n\s*/g, ' | ')])]
    .map((r) => r.map(cell).join(',')).join('\r\n')
  return new Response(`﻿${csv}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="enquiries-${want}.csv"` } })
}
