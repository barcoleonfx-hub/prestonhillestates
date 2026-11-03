import { eq, like, or, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { audit, upsertContact } from '@/lib/contacts'
import { dropBatch, readBatch, validBatch } from '@/lib/import-batches'
import { uid } from '@/lib/util'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** "I am a first-time buyer" → "First time buyer", to match the positions used in the call log. */
function position(situation: string | null): string | null {
  if (!situation) return null
  const t = situation.toLowerCase()
  if (/first[- ]time/.test(t)) return 'First time buyer'
  if (/cash/.test(t)) return 'Cash buyer'
  if (/under offer/.test(t)) return 'Under offer on theirs'
  if (/(have|has|got) a property to sell|need to sell|property to sell/.test(t)) return 'Property to sell'
  if (/nothing to sell|not need to sell|don.t need to sell/.test(t)) return 'Nothing to sell'
  if (/mortgage/.test(t)) return 'Mortgage agreed in principle'
  if (/invest/.test(t)) return 'Investor'
  return situation.replace(/^i am an?\s+/i, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 80)
}

/** Links the enquiry to one of our listings when the street and postcode area match. */
async function matchProperty(about: string | null, postcode: string | null): Promise<string | null> {
  if (!about) return null
  const street = about.split(',').map((p) => p.trim().replace(/^\d+[a-z]?\s+/i, '')).find((p) => /[a-z]{3,}/i.test(p) && !/^\d/.test(p))
  if (!street) return null
  const outward = (postcode ?? /\b([A-Z]{1,2}\d[A-Z\d]?)\b/i.exec(about.split(',').pop() ?? '')?.[1] ?? '').split(' ')[0].toUpperCase()
  const st = `%${street.toLowerCase()}%`
  const rows = await db.select({ id: properties.id, postcode: properties.postcode }).from(properties)
    .where(or(like(sql`lower(${properties.street})`, st), like(sql`lower(${properties.displayAddress})`, st)))
    .limit(5)
  const hit = rows.find((r) => !outward || (r.postcode ?? '').toUpperCase().startsWith(outward)) ?? null
  return hit?.id ?? null
}

const SOURCE_FOR_CONTACT: Record<string, string | null> = { zoopla: 'Zoopla', onthemarket: 'OnTheMarket', website: 'Our website', email: null }

/** Saves the ticked emails as enquiries on their original dates, each linked to a contact. Admins only. */
export async function POST(req: Request) {
  const me = await currentAdmin()
  if (!me || me.role !== 'admin') return Response.json({ error: 'Admins only' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { batch?: string; keys?: unknown }
  if (!validBatch(body.batch ?? null) || !Array.isArray(body.keys)) return Response.json({ error: 'Bad request' }, { status: 400 })
  const want = new Set(body.keys.filter((k): k is string => typeof k === 'string'))
  const rows = (await readBatch(body.batch!)).filter((r) => want.has(r.key) && r.category !== 'skipped')
  await ready()
  const startedAt = new Date().toISOString()

  let imported = 0
  const people = new Set<string>()
  for (const r of rows.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (await db.query.enquiries.findFirst({ where: eq(enquiries.externalId, r.key) })) continue
    const contactId = await upsertContact({
      name: r.name, phone: r.phone, email: r.email,
      role: r.intent === 'rent' ? 'tenant' : r.intent === 'valuation' ? 'seller' : 'buyer',
      source: SOURCE_FOR_CONTACT[r.source] ?? null, by: me.id, touch: false,
    })
    // Their "last contact" is the latest email's date, not today, so the 2-year rule treats them correctly.
    // Never move an existing contact's date backwards.
    const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
    if (c) {
      const createdByImport = c.createdAt >= startedAt
      const known = c.lastContactAt && (!createdByImport || c.lastContactAt < startedAt) ? c.lastContactAt : null
      const last = known && known > r.date ? known : r.date
      if (last !== c.lastContactAt) await db.update(contacts).set({ lastContactAt: last }).where(eq(contacts.id, contactId))
    }
    // Fill in what the lead told us, without overwriting anything staff have already recorded.
    if (c) {
      const patch: { position?: string; address?: string } = {}
      const pos = position(r.situation)
      if (pos && !c.position) patch.position = pos
      if (r.applicantAddress && !c.address) patch.address = r.applicantAddress
      if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, contactId))
    }
    const propertyId = await matchProperty(r.about, r.propertyPostcode).catch(() => null)
    await db.insert(enquiries).values({
      id: uid(), propertyId, postcode: r.intent === 'valuation' ? r.propertyPostcode : null, kind: 'email', source: r.source, externalId: r.key, contactId,
      name: r.name, phone: r.phone, email: r.email, handled: true, createdAt: r.date,
      message: [r.about ? `About: ${r.about}` : '', r.message].filter(Boolean).join('\n').slice(0, 2000),
    }).onConflictDoNothing()
    imported++
    people.add(contactId)
  }
  await audit(me.id, 'import_emails', 'enquiry', body.batch!, `${imported} imported`)
  await dropBatch(body.batch!)
  return Response.json({ ok: true, imported, contacts: people.size })
}
