'use server'

import { Readable } from 'node:stream'
import { unlink } from 'node:fs/promises'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, desc, eq, isNotNull, like, or, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, letters } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import type { Audience, Role } from '@/lib/campaign'
import { audienceSummary } from '@/lib/campaign-data'
import { audit } from '@/lib/contacts'
import { ATTACH_TYPES, MAX_FILE, blankLetter, type LetterContent, type LetterProperty } from '@/lib/letter-email'
import { filesOf, letterProperty, renderFor, sendLetter, type LetterFile, type ToMode } from '@/lib/letters'
import { bulkSender } from '@/lib/mailbox'
import { knownBase } from '@/lib/property-email-data'
import { isLocalStorage, localPath, writeLocal } from '@/lib/storage'
import { now, uid } from '@/lib/util'

export type LetterState = {
  name: string
  content: LetterContent
  toMode: ToMode
  one: { contactId: string | null; email: string; name: string }
  recipients: string
  audience: Audience
}

const ROLES: Role[] = ['buyer', 'tenant', 'landlord', 'seller', 'other']

export async function createLetter(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = uid()
  const propertyId = String(form.get('propertyId') ?? '') || null
  await db.insert(letters).values({ id, name: 'New property email', content: JSON.stringify({ ...blankLetter(me.name), propertyId }), toMode: 'one', createdBy: me.id, createdAt: now(), updatedAt: now() })
  redirect(`/admin/campaigns/letter/${id}`)
}

export async function duplicateLetter(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const src = await db.query.letters.findFirst({ where: eq(letters.id, String(form.get('id'))) })
  if (!src) redirect('/admin/campaigns')
  const id = uid()
  // The files are shared by reference: they're never changed, only added or removed.
  await db.insert(letters).values({ id, name: `${src.name} (copy)`.slice(0, 120), content: src.content, toMode: src.toMode, audience: src.audience, attachments: src.attachments, createdBy: me.id, createdAt: now(), updatedAt: now() })
  redirect(`/admin/campaigns/letter/${id}`)
}

export async function deleteLetter(form: FormData) {
  await requireAdmin()
  await ready()
  const id = String(form.get('id'))
  const l = await db.query.letters.findFirst({ where: eq(letters.id, id) })
  if (l?.status === 'sending') redirect(`/admin/campaigns/letter/${id}`)
  await db.delete(letters).where(eq(letters.id, id))
  revalidatePath('/admin/campaigns')
  redirect('/admin/campaigns#letters')
}

function clean(s: LetterState) {
  const a = s.audience ?? { roles: [], areas: '', activeMonths: null }
  return {
    // Named after the subject until staff give it a name of their own.
    name: ((s.name ?? '').trim() && s.name.trim() !== 'New property email' ? s.name.trim() : s.content.subject.replace(/\{(first name|name)\},?\s*/gi, '').trim() || 'New property email').slice(0, 120),
    content: JSON.stringify({
      subject: String(s.content.subject ?? '').slice(0, 200), greeting: String(s.content.greeting ?? '').slice(0, 200), body: String(s.content.body ?? '').slice(0, 20000),
      signoff: String(s.content.signoff ?? '').slice(0, 80), signedBy: String(s.content.signedBy ?? '').slice(0, 120), signTitle: String(s.content.signTitle ?? '').slice(0, 120),
      propertyId: s.content.propertyId || null, showProperty: !!s.content.showProperty,
    } satisfies LetterContent),
    toMode: (['one', 'list', 'groups'] as const).includes(s.toMode) ? s.toMode : 'one',
    oneContactId: s.one?.contactId || null, oneEmail: s.one?.email?.trim().toLowerCase() || null, oneName: s.one?.name?.trim() || null,
    recipients: String(s.recipients ?? '').slice(0, 20000),
    audience: JSON.stringify({ roles: (a.roles ?? []).filter((r) => ROLES.includes(r)), areas: String(a.areas ?? '').slice(0, 200), activeMonths: a.activeMonths ? Number(a.activeMonths) : null }),
  }
}

export async function saveLetter(id: string, s: LetterState): Promise<{ ok?: boolean; error?: string }> {
  await requireAdmin()
  await ready()
  const l = await db.query.letters.findFirst({ where: eq(letters.id, id) })
  if (!l) return { error: 'This email no longer exists.' }
  if (l.status !== 'draft') return { error: 'This email has been sent. Use “Use again” to send it to someone else.' }
  await db.update(letters).set({ ...clean(s), updatedAt: now() }).where(eq(letters.id, id))
  return { ok: true }
}

/** The plain property box for the preview (and the email). */
export async function propertyBox(id: string | null): Promise<LetterProperty | null> {
  await requireAdmin()
  return letterProperty(id)
}

/** People on the contact list, for "one person". */
export async function findContacts(q: string): Promise<{ id: string; name: string; email: string; note: string | null }[]> {
  await requireAdmin()
  await ready()
  const t = q.trim().toLowerCase()
  if (t.length < 2) return []
  const rows = await db.select().from(contacts).where(and(isNotNull(contacts.email), eq(contacts.archived, false), or(like(sql`lower(${contacts.name})`, `%${t}%`), like(sql`lower(${contacts.email})`, `%${t}%`), like(sql`replace(coalesce(${contacts.phone}, ''), ' ', '')`, `%${t.replace(/\s/g, '')}%`))))
    .orderBy(desc(contacts.lastContactAt)).limit(8)
  return rows.map((c) => ({ id: c.id, name: c.name, email: c.email!, note: c.doNotContact ? 'Asked not to be contacted' : c.marketingOptOut ? 'Unsubscribed from marketing (fine for a reply about a home they asked about)' : null }))
}

/** How many people a group choice reaches. */
export async function groupCount(a: Audience): Promise<{ total: number }> {
  await requireAdmin()
  if (!a.roles?.length) return { total: 0 }
  const s = await audienceSummary({ roles: a.roles.filter((r) => ROLES.includes(r)), areas: a.areas ?? '', activeMonths: a.activeMonths ? Number(a.activeMonths) : null })
  return { total: s.total }
}

export async function uploadLetterFile(form: FormData): Promise<{ ok: true; files: LetterFile[] } | { ok: false; error: string }> {
  await requireAdmin()
  await ready()
  const id = String(form.get('id') ?? '')
  const l = await db.query.letters.findFirst({ where: eq(letters.id, id) })
  if (!l) return { ok: false, error: 'This email no longer exists.' }
  if (l.status !== 'draft') return { ok: false, error: 'This email has been sent already.' }
  if (!isLocalStorage()) return { ok: false, error: 'Files can only be attached when uploads are kept on the server’s disk.' }
  const files = filesOf(l)
  for (const f of form.getAll('file')) {
    if (!(f instanceof File) || !f.size) continue
    const ext = ATTACH_TYPES[f.type]
    if (!ext) return { ok: false, error: `${f.name}: attach PDFs, photos (JPEG or PNG) or Word documents.` }
    if (f.size > MAX_FILE) return { ok: false, error: `${f.name} is over 10 MB. Save a smaller version and try again.` }
    if (files.reduce((n, x) => n + x.size, 0) + f.size > 15 * 1024 * 1024) return { ok: false, error: 'That would take the attachments over 15 MB, which many inboxes refuse.' }
    if (files.length >= 10) return { ok: false, error: 'Ten files at most.' }
    const fid = uid()
    const key = `letter-files/${fid}.${ext}`
    const size = await writeLocal(key, Readable.toWeb(Readable.from(Buffer.from(await f.arrayBuffer()))) as ReadableStream<Uint8Array>, MAX_FILE)
    files.push({ id: fid, name: f.name.replace(/[^\w .()&-]/g, '_').slice(0, 120) || `file.${ext}`, type: f.type, size, key })
  }
  await db.update(letters).set({ attachments: JSON.stringify(files), updatedAt: now() }).where(eq(letters.id, id))
  return { ok: true, files }
}

export async function removeLetterFile(id: string, fileId: string): Promise<{ ok: true; files: LetterFile[] } | { ok: false; error: string }> {
  await requireAdmin()
  await ready()
  const l = await db.query.letters.findFirst({ where: eq(letters.id, id) })
  if (!l || l.status !== 'draft') return { ok: false, error: 'This email can’t be changed now.' }
  const files = filesOf(l)
  const gone = files.find((f) => f.id === fileId)
  const keep = files.filter((f) => f.id !== fileId)
  await db.update(letters).set({ attachments: JSON.stringify(keep), updatedAt: now() }).where(eq(letters.id, id))
  // Only delete the file itself if no other email (a copy) still uses it.
  if (gone) {
    const others = await db.select({ id: letters.id }).from(letters).where(like(letters.attachments, `%${gone.id}%`)).limit(1)
    if (!others.length) await unlink(localPath(gone.key)).catch(() => {})
  }
  return { ok: true, files: keep }
}

/** Sends it to the person signed in, marked as a test, with the attachments. */
export async function testLetter(id: string, s: LetterState): Promise<{ ok?: boolean; error?: string; to?: string }> {
  const me = await requireAdmin()
  const saved = await saveLetter(id, s)
  if (saved.error) return saved
  const l = (await db.query.letters.findFirst({ where: eq(letters.id, id) }))!
  const tx = await bulkSender()
  if ('error' in tx) return { error: tx.error }
  try {
    const base = await knownBase()
    const property = await letterProperty(s.content.propertyId, base)
    const sample = s.toMode === 'one' && s.one.name ? s.one.name : me.name
    const m = renderFor(l, { email: me.email, name: sample, contactId: null, footer: s.toMode === 'one' ? 'plain' : 'unsubscribe' }, { base, senderEmail: tx.user, property })
    const { readFile } = await import('node:fs/promises')
    const attachments = await Promise.all(filesOf(l).map(async (f) => ({ filename: f.name, content: await readFile(localPath(f.key)), contentType: f.type })))
    const r = await tx.send({ to: me.email, subject: `[Test] ${m.subject}`, text: m.text, html: m.html, attachments })
    return r.ok ? { ok: true, to: me.email } : { error: r.error }
  } finally { tx.close() }
}

export async function sendLetterAction(id: string, s: LetterState): Promise<{ ok?: boolean; error?: string; sent?: number; failed?: number; queued?: number; skipped?: { email: string; reason: string }[] }> {
  const me = await requireAdmin()
  const saved = await saveLetter(id, s)
  if (saved.error) return saved
  const l = (await db.query.letters.findFirst({ where: eq(letters.id, id) }))!
  const r = await sendLetter(l, me.id)
  if (r.ok) await audit(me.id, 'sent property email', 'letter', id, `${r.queued ? `${r.queued} queued` : `${r.sent} sent`}: ${s.content.subject}`)
  revalidatePath('/admin/campaigns')
  return { ok: r.ok, error: r.error, sent: r.sent, failed: r.failed, queued: r.queued, skipped: r.skipped?.map((x) => ({ email: x.email, reason: x.reason })) }
}

