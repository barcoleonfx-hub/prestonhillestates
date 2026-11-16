import 'server-only'
// Property emails (see lib/letter-email): who they go to, the property box, the attachments, and sending. Up to 25
// people go straight away from the office mailbox (copies in Sent and the portal); more go in the background a few
// at a time, within the same daily limit as campaigns.

import { readFile } from 'node:fs/promises'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { contacts, enquiries, letterRecipients, letters, type Contact, type Letter } from '@/db/schema'
import type { Audience } from './campaign'
import { audienceContacts, campaignLimits, sentToday } from './campaign-data'
import { recordOutgoing } from './enquiry-thread'
import { SEND_NOW_MAX, attachLimit, parseAddresses, renderLetter, type LetterContent, type LetterFooter, type LetterProperty } from './letter-email'
import { bulkSender, mailboxStatus, sendFromMailbox } from './mailbox'
import { FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from './options'
import { displayAddressFor, getProperty, listPublished, priceLabel, slugFor } from './properties'
import { knownBase, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { localPath } from './storage'
import { now } from './util'

export type LetterFile = { id: string; name: string; type: string; size: number; key: string }
export type ToMode = 'one' | 'list' | 'groups'
export type Target = { email: string; name: string; contactId: string | null; footer: LetterFooter }
export type Skipped = { email: string; name: string; reason: string }

export const filesOf = (l: Pick<Letter, 'attachments'>): LetterFile[] => { try { return JSON.parse(l.attachments) as LetterFile[] } catch { return [] } }
export const contentOf = (l: Pick<Letter, 'content'>): LetterContent => JSON.parse(l.content) as LetterContent
export const audienceOf = (l: Pick<Letter, 'audience'>): Audience => {
  try { return { roles: [], areas: '', activeMonths: null, ...(l.audience ? JSON.parse(l.audience) : {}) } } catch { return { roles: [], areas: '', activeMonths: null } }
}

/** Our homes on the website, for the "which property?" list. */
export async function letterPropertyOptions() {
  const rows = await listPublished({}).catch(() => [])
  return rows.map((p) => ({ id: p.id, channel: p.channel as 'sale' | 'let', label: `${displayAddressFor(p)} · ${priceLabel(p)} · ${p.ref}` }))
}

/** The plain property box: name, price and a few key details. Only what the listing has; no photos. */
export async function letterProperty(id: string | null, base?: string): Promise<LetterProperty | null> {
  if (!id) return null
  const p = await getProperty(id).catch(() => null)
  if (!p || !p.published) return null
  const b = base ?? await knownBase()
  const beds = p.bedrooms == null ? null : p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bedroom${p.bedrooms === 1 ? '' : 's'}`
  const baths = p.bathrooms ? `${p.bathrooms} bathroom${p.bathrooms === 1 ? '' : 's'}` : null
  const type = p.propertyType ? labelFor(PROPERTY_TYPES, p.propertyType) : null
  const extra = p.channel === 'let' ? (p.furnishing ? labelFor(FURNISHING, p.furnishing) : null) : (p.tenure ? labelFor(TENURES, p.tenure) : null)
  return {
    id: p.id, ref: p.ref, address: displayAddressFor(p), priceText: priceLabel(p),
    facts: [beds, baths, type, extra].filter((x): x is string => !!x && x !== '—'), url: `${b}/properties/${slugFor(p)}`,
  }
}

async function contactsByEmail(emails: string[]): Promise<Map<string, Contact>> {
  if (!emails.length) return new Map()
  const rows = await db.select().from(contacts).where(inArray(sql`lower(trim(${contacts.email}))`, emails))
  return new Map(rows.map((c) => [(c.email ?? '').trim().toLowerCase(), c]))
}

/**
 * Who it goes to. One person: always (unless they asked not to be contacted), since it's about something they
 * asked for. Typed addresses and groups: never anyone who unsubscribed, asked not to be contacted, or is archived.
 */
export async function resolveTargets(l: Letter, base: string): Promise<{ targets: Target[]; skipped: Skipped[]; bad: string[] }> {
  await ready()
  const targets: Target[] = [], skipped: Skipped[] = []
  const seen = new Set<string>()
  const add = (t: Target) => { if (!seen.has(t.email)) { seen.add(t.email); targets.push(t) } }
  const mode = l.toMode as ToMode
  if (mode === 'one') {
    const c = l.oneContactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, l.oneContactId) }) : null
    const email = (l.oneEmail ?? c?.email ?? '').trim().toLowerCase()
    if (!email) return { targets, skipped, bad: [] }
    const known = c ?? (await contactsByEmail([email])).get(email) ?? null
    if (known?.doNotContact) skipped.push({ email, name: l.oneName ?? known.name, reason: 'Asked not to be contacted' })
    else add({ email, name: (l.oneName ?? known?.name ?? '').trim(), contactId: known?.id ?? null, footer: 'plain' })
    return { targets, skipped, bad: [] }
  }
  const { list, bad } = parseAddresses(l.recipients)
  if (mode === 'groups') {
    const a = audienceOf(l)
    if (a.roles.length) {
      for (const c of await audienceContacts(a)) add({ email: c.email!.trim().toLowerCase(), name: c.name, contactId: c.id, footer: 'unsubscribe' })
    }
  }
  const known = await contactsByEmail(list.map((r) => r.email))
  for (const r of list) {
    const c = known.get(r.email)
    if (c?.doNotContact) { skipped.push({ email: r.email, name: r.name || c.name, reason: 'Asked not to be contacted' }); continue }
    if (c?.marketingOptOut) { skipped.push({ email: r.email, name: r.name || c.name, reason: 'Unsubscribed from our emails' }); continue }
    add({ email: r.email, name: r.name || c?.name || '', contactId: c?.id ?? null, footer: c ? 'unsubscribe' : 'reply' })
  }
  return { targets, skipped, bad }
}

async function readFiles(files: LetterFile[]) {
  return Promise.all(files.map(async (f) => ({ filename: f.name, content: await readFile(localPath(f.key)), contentType: f.type })))
}

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })

export function renderFor(l: Letter, t: Pick<Target, 'email' | 'name' | 'contactId' | 'footer'>, o: { base: string; senderEmail: string; property: LetterProperty | null }) {
  return renderLetter(contentOf(l), { email: t.email, name: t.name }, {
    base: o.base, senderEmail: o.senderEmail, property: o.property, attachments: filesOf(l).map((f) => f.name), footer: t.footer,
    unsubscribeUrl: t.contactId && t.footer === 'unsubscribe' ? unsubscribeUrl(o.base, t.contactId) : null, date: today(),
  })
}

const listHeaders = (base: string, user: string, t: Target) => (t.contactId && t.footer === 'unsubscribe'
  ? { 'List-Unsubscribe': `<${oneClickUrl(base, t.contactId)}>, <mailto:${user}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  : undefined)

/** Sends it: straight away to a few people, or queued for the background job for more. */
export async function sendLetter(l: Letter, by: string): Promise<{ ok: boolean; error?: string; sent?: number; failed?: number; queued?: number; skipped?: Skipped[] }> {
  const c = contentOf(l)
  if (!c.subject.trim()) return { ok: false, error: 'Add a subject line.' }
  if (!c.body.trim()) return { ok: false, error: 'Write your message first.' }
  const box = await mailboxStatus()
  if (!box?.hasPassword) return { ok: false, error: 'Connect the office mailbox in Email settings first.' }
  const base = await knownBase()
  const { targets, skipped, bad } = await resolveTargets(l, base)
  if (bad.length) return { ok: false, error: `These don’t look like email addresses: ${bad.slice(0, 3).join(', ')}` }
  if (!targets.length) return { ok: false, error: skipped.length ? `Nobody to send to: ${skipped.map((s) => `${s.email} (${s.reason.toLowerCase()})`).join(', ')}` : 'Choose who it’s to first.' }
  const files = filesOf(l)
  const size = files.reduce((n, f) => n + f.size, 0)
  if (size > attachLimit(targets.length)) return { ok: false, error: `The attachments come to ${(size / 1048576).toFixed(1)} MB. To ${targets.length} people, keep them under ${attachLimit(targets.length) / 1048576} MB.` }
  if (c.propertyId && c.showProperty && !(await letterProperty(c.propertyId, base))) return { ok: false, error: 'That property isn’t on the website any more. Choose another, or none.' }

  await db.delete(letterRecipients).where(eq(letterRecipients.letterId, l.id))
  for (let i = 0; i < targets.length; i += 200) {
    await db.insert(letterRecipients).values(targets.slice(i, i + 200).map((t) => ({ letterId: l.id, email: t.email, name: t.name, contactId: t.contactId, status: 'queued' })))
  }
  if (skipped.length) await db.insert(letterRecipients).values(skipped.map((s) => ({ letterId: l.id, email: s.email, name: s.name, status: 'skipped', error: s.reason, sentAt: now() }))).onConflictDoNothing()

  if (targets.length > SEND_NOW_MAX) {
    await db.update(letters).set({ status: 'sending', total: targets.length, sent: 0, failed: 0, lastError: null, sentAt: now(), updatedAt: now() }).where(eq(letters.id, l.id))
    return { ok: true, queued: targets.length, skipped }
  }

  // A few people: now, from the mailbox, so each copy is in Sent and in the portal's email history.
  const property = await letterProperty(c.propertyId, base)
  const attachments = files.length ? await readFiles(files) : []
  let sent = 0, failed = 0
  for (const t of targets) {
    const m = renderFor(l, t, { base, senderEmail: box.user ?? '', property })
    const res = await sendFromMailbox({ to: [t.name ? `"${t.name.replace(/"/g, '')}" <${t.email}>` : t.email], subject: m.subject, text: m.text, html: m.html, by, attachments, headers: listHeaders(base, box.user ?? '', t) })
    await db.update(letterRecipients).set({ status: res.ok ? 'sent' : 'failed', error: res.ok ? null : res.error, sentAt: now() }).where(and(eq(letterRecipients.letterId, l.id), eq(letterRecipients.email, t.email)))
    if (res.ok) {
      sent++
      // Writing to one person about a home: it joins their latest enquiry, so their reply lands there too.
      if (l.toMode === 'one' && t.contactId) {
        const [e] = await db.select({ id: enquiries.id }).from(enquiries).where(eq(enquiries.contactId, t.contactId)).orderBy(desc(enquiries.createdAt)).limit(1)
        if (e) await recordOutgoing(e.id, { messageId: res.messageId, subject: m.subject, body: m.text, by }).catch(() => {})
      }
    } else {
      failed++
      if (/password|connect the mailbox|couldn’t reach/i.test(res.error)) break
    }
  }
  await db.update(letters).set({ status: sent ? 'sent' : 'draft', total: targets.length, sent, failed, lastError: failed && !sent ? 'Nothing could be sent' : null, sentAt: now(), updatedAt: now() }).where(eq(letters.id, l.id))
  return sent ? { ok: true, sent, failed, skipped } : { ok: false, error: (await db.select().from(letterRecipients).where(and(eq(letterRecipients.letterId, l.id), eq(letterRecipients.status, 'failed'))).limit(1))[0]?.error ?? 'Nothing was sent.' }
}

/** The background part: the next few of any big send, within the daily limit. Called every couple of minutes. */
export async function runLetters(): Promise<{ ran: boolean; sent?: number; error?: string }> {
  await ready()
  const [l] = await db.select().from(letters).where(eq(letters.status, 'sending')).orderBy(asc(letters.sentAt)).limit(1)
  if (!l) return { ran: false }
  const claim = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('letters', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [now(), new Date(Date.now() - 90_000).toISOString()] })
  if (claim.rowsAffected !== 1) return { ran: false }
  const { perDay } = await campaignLimits()
  const allowance = Math.min(12, perDay - (await sentToday()))
  if (allowance <= 0) { await db.update(letters).set({ lastError: `Daily limit of ${perDay} reached. Sending carries on tomorrow.`, updatedAt: now() }).where(eq(letters.id, l.id)); return { ran: true, sent: 0 } }
  const batch = await db.select().from(letterRecipients).where(and(eq(letterRecipients.letterId, l.id), eq(letterRecipients.status, 'queued'))).limit(allowance)
  let sent = 0, stop: string | null = null
  if (batch.length) {
    const tx = await bulkSender()
    if ('error' in tx) stop = tx.error
    else {
      try {
        const base = await knownBase()
        const property = await letterProperty(contentOf(l).propertyId, base)
        const attachments = await readFiles(filesOf(l))
        const people = new Map((await db.select().from(contacts).where(inArray(contacts.id, batch.map((b) => b.contactId).filter((x): x is string => !!x)))).map((p) => [p.id, p]))
        for (const r of batch) {
          const p = r.contactId ? people.get(r.contactId) : null
          const where = and(eq(letterRecipients.letterId, l.id), eq(letterRecipients.email, r.email))
          if (p && (p.marketingOptOut || p.doNotContact)) { await db.update(letterRecipients).set({ status: 'skipped', error: p.doNotContact ? 'Asked not to be contacted' : 'Unsubscribed', sentAt: now() }).where(where); continue }
          const t: Target = { email: r.email, name: r.name, contactId: r.contactId, footer: r.contactId ? 'unsubscribe' : 'reply' }
          const m = renderFor(l, t, { base, senderEmail: tx.user, property })
          const res = await tx.send({ to: r.email, subject: m.subject, text: m.text, html: m.html, attachments, headers: { ...listHeaders(base, tx.user, t), 'X-Letter': l.id } })
          if (res.ok) { sent++; await db.update(letterRecipients).set({ status: 'sent', error: null, sentAt: now() }).where(where) }
          else if (res.fatal) { stop = res.error; break }
          else await db.update(letterRecipients).set({ status: 'failed', error: res.error, sentAt: now() }).where(where)
          await new Promise((ok) => setTimeout(ok, 400))
        }
      } finally { tx.close() }
    }
  }
  const counts = await db.select({ s: letterRecipients.status, n: sql<number>`count(*)` }).from(letterRecipients).where(eq(letterRecipients.letterId, l.id)).groupBy(letterRecipients.status)
  const n = (s: string) => Number(counts.find((x) => x.s === s)?.n ?? 0)
  await db.update(letters).set({ sent: n('sent'), failed: n('failed'), lastError: stop, updatedAt: now(), ...(n('queued') === 0 ? { status: 'sent' } : {}) }).where(eq(letters.id, l.id))
  return { ran: true, sent, ...(stop ? { error: stop } : {}) }
}

export async function letterResults(id: string) {
  return db.select().from(letterRecipients).where(eq(letterRecipients.letterId, id)).orderBy(asc(letterRecipients.status), asc(letterRecipients.email)).limit(500)
}
