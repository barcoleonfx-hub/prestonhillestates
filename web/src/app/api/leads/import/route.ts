import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, leadEvents, properties } from '@/db/schema'
import { upsertContact } from '@/lib/contacts'
import { ENQUIRY_SOURCES } from '@/lib/enquiry-labels'
import { MAX_IMPORT, leadsIn, parseImportLead } from '@/lib/lead-import'
import { parseAttribution } from '@/lib/lead-rules'
import { recordConsents, setLeadSource } from '@/lib/leads'
import { now, uid } from '@/lib/util'

export const dynamic = 'force-dynamic'

// Leads from other tools (a form builder, a spreadsheet script, another system): POST JSON with
// "Authorization: Bearer <LEAD_IMPORT_SECRET>". See SETUP.md for the fields.

const hits = new Map<string, number[]>()
const PER_MINUTE = 30

function authorised(req: Request): boolean {
  const secret = process.env.LEAD_IMPORT_SECRET ?? ''
  if (secret.length < 24) return false
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(got), h(secret))
}

export async function POST(req: Request) {
  if (!process.env.LEAD_IMPORT_SECRET || process.env.LEAD_IMPORT_SECRET.length < 24) return Response.json({ ok: false, error: 'Lead import is switched off (set LEAD_IMPORT_SECRET, at least 24 characters).' }, { status: 503 })
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const recent = (hits.get(ip) ?? []).filter((t) => t > Date.now() - 60_000)
  if (recent.length >= PER_MINUTE) return Response.json({ ok: false, error: 'Too many requests. Try again in a minute.' }, { status: 429, headers: { 'Retry-After': '60' } })
  hits.set(ip, [...recent, Date.now()])
  if (!authorised(req)) return Response.json({ ok: false, error: 'Wrong or missing key.' }, { status: 401 })

  const list = leadsIn(await req.json().catch(() => null))
  if (!list) return Response.json({ ok: false, error: 'Send JSON: one lead, a list of leads, or { "leads": [...] }.' }, { status: 400 })
  if (list.length > MAX_IMPORT) return Response.json({ ok: false, error: `Send ${MAX_IMPORT} leads at most at a time.` }, { status: 413 })

  await ready()
  const results: { index: number; ok: boolean; id?: string; duplicate?: boolean; error?: string }[] = []
  for (const [index, raw] of list.entries()) {
    const p = parseImportLead(raw)
    if (!p.ok) { results.push({ index, ok: false, error: p.error }); continue }
    const l = p.lead
    const externalId = l.externalId ? `api:${l.source}:${l.externalId}` : null
    if (externalId) {
      const dup = await db.query.enquiries.findFirst({ where: eq(enquiries.externalId, externalId) })
      if (dup) { results.push({ index, ok: true, id: dup.id, duplicate: true }); continue }
    }
    try {
      const property = l.propertyRef ? await db.query.properties.findFirst({ where: and(eq(properties.ref, l.propertyRef)) }) : null
      const role = l.kind === 'valuation' ? (l.intent === 'letting' ? 'landlord' : 'seller') : property?.channel === 'let' ? 'tenant' : 'buyer'
      const contactId = await upsertContact({ name: l.name, phone: l.phone, email: l.email, role, source: ENQUIRY_SOURCES[l.source] ?? l.source }).catch(() => null)
      const id = uid()
      await db.insert(enquiries).values({
        id, propertyId: property?.id ?? null, kind: l.kind, contactId, name: l.name, phone: l.phone, email: l.email, message: l.message,
        postcode: l.postcode, intent: l.intent, source: l.source, externalId, createdAt: now(),
      })
      await setLeadSource(id, parseAttribution(l.attribution), 'import')
      await recordConsents({ contactId, enquiryId: id, email: l.consentEmail, whatsapp: l.consentWhatsapp, source: `Imported (${ENQUIRY_SOURCES[l.source] ?? l.source})` })
      await db.insert(leadEvents).values({ id: uid(), enquiryId: id, contactId, kind: 'import', detail: `Imported from ${ENQUIRY_SOURCES[l.source] ?? l.source}`, createdBy: 'system', createdAt: now() })
      results.push({ index, ok: true, id })
    } catch (e) {
      console.error('lead import failed', e)
      results.push({ index, ok: false, error: 'Couldn’t save this one.' })
    }
  }
  const saved = results.filter((r) => r.ok).length
  return Response.json({ ok: saved === results.length, saved, failed: results.length - saved, results }, { status: saved ? 200 : 422 })
}
