import 'server-only'
import type { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { mailMessages, mailThreads, settings } from '@/db/schema'
import { emailText } from '@/lib/email-import'
import { areaFor, type AreaId } from '@/lib/mail-areas'
import { now, uid } from '@/lib/util'

// Keeps a copy of the office mailbox (inbox and sent) grouped into conversations, so the Inbox page can
// show the whole history and what's still waiting for a reply, whether we answered from the portal or
// from Apple Mail. Read-only on the mailbox side.

const KEY = 'mail_store'
const BACKFILL_DAYS = 60 // when first switched on, bring in the last couple of months
const PER_RUN = 250 // per folder, per check
const MAX_WHOLE = 3_000_000 // emails up to this size are downloaded whole
const MAX_SOURCE = 400_000 // bigger ones: just the start, which holds the text (attachments are cut off)
const OWN = /@prestonhillestates\.(com|co\.uk)$/i

type FolderCursor = { path: string; validity: string; upTo: number }
type StoreState = { inbox?: FolderCursor; sent?: FolderCursor; startedAt?: string; backfilled?: boolean }

async function loadState(): Promise<StoreState> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  try { return row ? (JSON.parse(row.value) as StoreState) : {} } catch { return {} }
}
async function saveState(s: StoreState) {
  await db.insert(settings).values({ key: KEY, value: JSON.stringify(s), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(s), updatedAt: now() } })
}
export async function mailStoreState() { await ready(); return loadState() }

export const normSubject = (s: string) => s.toLowerCase().replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().slice(0, 200)
const addrs = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).filter((v) => v.address)
const one = (a?: AddressObject | AddressObject[]) => addrs(a)[0]

/** Splits the List-Unsubscribe header into a web link (preferred) or a mailto address. */
function headerLine(mail: ParsedMail, key: string): string {
  return mail.headerLines.filter((h) => h.key === key).map((h) => h.line.slice(h.line.indexOf(':') + 1)).join(' ').trim()
}

function unsubscribeOf(mail: ParsedMail): { link: string | null; oneClick: boolean } {
  const all = [...headerLine(mail, 'list-unsubscribe').matchAll(/<([^>]+)>/g)].map((m) => m[1].trim())
  const web = all.find((u) => /^https:\/\//i.test(u))
  const mailto = all.find((u) => /^mailto:/i.test(u))
  const post = /one-click/i.test(headerLine(mail, 'list-unsubscribe-post'))
  return { link: web ?? mailto ?? null, oneClick: !!web && post }
}

export type IncomingMail = { raw: Buffer | string; direction: 'in' | 'out'; via?: 'portal' | 'mailbox'; sentBy?: string | null }

/** Saves one email and files it into a conversation. Returns false if it was already stored. */
export async function storeMail({ raw, direction, via = 'mailbox', sentBy = null }: IncomingMail): Promise<boolean> {
  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
  const from = one(mail.from)
  const fromAddr = (from?.address ?? '').toLowerCase()
  // Emails we sent show up in the inbox too when we copy ourselves in; treat anything from our own address as ours.
  const dir: 'in' | 'out' = direction === 'out' || OWN.test(fromAddr) ? 'out' : 'in'
  const sentAt = (mail.date && !isNaN(mail.date.getTime()) ? mail.date : new Date()).toISOString()
  const messageId = (mail.messageId ?? `<${fromAddr}|${sentAt}|${mail.subject ?? ''}>`).slice(0, 400)
  if (await db.query.mailMessages.findFirst({ where: eq(mailMessages.messageId, messageId), columns: { id: true } })) return false

  const subject = (mail.subject ?? '(no subject)').slice(0, 300)
  const body = emailText(mail).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 30_000)
  const bulk = !!headerLine(mail, 'list-unsubscribe') || !!headerLine(mail, 'list-id') || /bulk|list|junk/i.test(headerLine(mail, 'precedence')) || /auto-(generated|replied)/i.test(headerLine(mail, 'auto-submitted'))
  const to = addrs(mail.to), cc = addrs(mail.cc)
  const counterpart = dir === 'in' ? fromAddr : (to.find((t) => !OWN.test(t.address ?? ''))?.address ?? to[0]?.address ?? '').toLowerCase()
  const counterpartName = dir === 'in' ? from?.name || null : to[0]?.name || null
  const { area, kind, needsReply } = dir === 'in' ? areaFor(fromAddr, subject, body, bulk) : { area: 'general' as AreaId, kind: 'internal', needsReply: false }
  const unsub = dir === 'in' && bulk ? unsubscribeOf(mail) : { link: null, oneClick: false }
  const refsList = [...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])]
  const inReplyTo = mail.inReplyTo ?? null

  // Which conversation: by the reply headers first, then by subject and person within 45 days.
  const ns = normSubject(subject)
  let threadId: string | null = null
  const linked = [inReplyTo, ...refsList].filter(Boolean) as string[]
  if (linked.length) threadId = (await db.select({ t: mailMessages.threadId }).from(mailMessages).where(inArray(mailMessages.messageId, linked.slice(-20))).limit(1))[0]?.t ?? null
  if (!threadId) threadId = (await db.select({ t: mailMessages.threadId }).from(mailMessages).where(eq(mailMessages.inReplyTo, messageId)).limit(1))[0]?.t ?? null
  if (!threadId && ns && counterpart) {
    const since = new Date(new Date(sentAt).getTime() - 45 * 86400000).toISOString()
    threadId = (await db.select({ id: mailThreads.id }).from(mailThreads)
      .where(and(eq(mailThreads.normSubject, ns), eq(mailThreads.counterpart, counterpart), gt(mailThreads.lastAt, since))).limit(1))[0]?.id ?? null
  }
  if (!threadId) {
    threadId = uid()
    await db.insert(mailThreads).values({
      id: threadId, subject, normSubject: ns, counterpart, counterpartName, area: dir === 'in' ? area : 'general', kind,
      status: dir === 'in' ? (area === 'promo' ? 'promo' : needsReply ? 'pending' : 'info') : 'replied',
      firstAt: sentAt, lastAt: sentAt, messageCount: 0,
    })
  }
  await db.insert(mailMessages).values({
    id: uid(), messageId, threadId, direction: dir, fromAddr, fromName: from?.name || null,
    replyTo: one(mail.replyTo)?.address?.toLowerCase() ?? null,
    toAddrs: to.map((t) => t.address).join(', '), ccAddrs: cc.map((t) => t.address).join(', ') || null,
    subject, sentAt, snippet: body.replace(/\s+/g, ' ').slice(0, 240), body,
    inReplyTo, refs: refsList.join(' ') || null,
    area: dir === 'in' ? area : 'general', kind, promo: dir === 'in' && area === 'promo', needsReply: dir === 'in' && needsReply,
    unsubscribe: unsub.link, unsubscribePost: unsub.oneClick,
    attachments: mail.attachments?.length ?? 0, via, sentBy, createdAt: now(),
  }).onConflictDoNothing()
  await refreshThread(threadId)
  return true
}

/** Recomputes a conversation's dates and status from its messages. */
export async function refreshThread(id: string) {
  const t = await db.query.mailThreads.findFirst({ where: eq(mailThreads.id, id) })
  if (!t) return
  const msgs = await db.select().from(mailMessages).where(eq(mailMessages.threadId, id)).orderBy(mailMessages.sentAt)
  if (!msgs.length) return
  const ins = msgs.filter((m) => m.direction === 'in'), outs = msgs.filter((m) => m.direction === 'out')
  const last = msgs[msgs.length - 1]
  const lastIn = ins[ins.length - 1]
  // The thread's area and person come from what people sent us, not our replies.
  const firstIn = ins[0]
  const lastOutAt = outs[outs.length - 1]?.sentAt ?? ''
  const waiting = ins.filter((m) => m.needsReply && m.sentAt > lastOutAt)
  let status: string
  if (!ins.length) status = 'sent' // only our own emails, e.g. a new message or an unsubscribe request
  else if (ins.every((m) => m.promo)) status = 'promo'
  else if (last.direction === 'out') status = 'replied'
  else if (t.doneAt && t.doneAt >= last.sentAt) status = 'done'
  else status = waiting.length ? 'pending' : 'info'
  await db.update(mailThreads).set({
    status, lastAt: last.sentAt, firstAt: msgs[0].sentAt,
    lastInAt: lastIn?.sentAt ?? null, lastOutAt: outs[outs.length - 1]?.sentAt ?? null, messageCount: msgs.length,
    ...(firstIn ? { area: firstIn.area, kind: firstIn.kind, counterpart: firstIn.fromAddr, counterpartName: firstIn.fromName } : {}),
  }).where(eq(mailThreads.id, id))
}

/** Marks a conversation as dealt with (no reply needed), or reopens it. */
export async function setThreadDone(id: string, done: boolean, by: string) {
  await db.update(mailThreads).set({ doneAt: done ? now() : null, doneBy: done ? by : null }).where(eq(mailThreads.id, id))
  await refreshThread(id)
}

async function syncFolder(c: ImapFlow, path: string, cur: FolderCursor | undefined, direction: 'in' | 'out'): Promise<{ cursor: FolderCursor; stored: number; more: boolean }> {
  const box = await c.mailboxOpen(path, { readOnly: true })
  const validity = String(box.uidValidity)
  let uids: number[]
  if (!cur || cur.validity !== validity || cur.path !== path) {
    uids = ((await c.search({ since: new Date(Date.now() - BACKFILL_DAYS * 86400000) }, { uid: true })) || []) as number[]
    cur = { path, validity, upTo: 0 }
  } else {
    const upTo = cur.upTo
    uids = box.uidNext > upTo + 1 ? ((((await c.search({ uid: `${upTo + 1}:*` }, { uid: true })) || []) as number[]).filter((u) => u > upTo)) : []
  }
  uids.sort((a, b) => a - b)
  const batch = uids.slice(0, PER_RUN)
  let stored = 0
  if (batch.length) {
    // Normal-sized emails are downloaded whole; only very large ones (big attachments) are cut short.
    const sizes = new Map<number, number>()
    for await (const m of c.fetch(batch.join(','), { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size ?? 0)
    const small = batch.filter((u) => (sizes.get(u) ?? 0) <= MAX_WHOLE), big = batch.filter((u) => (sizes.get(u) ?? 0) > MAX_WHOLE)
    const raws: { uid: number; source: Buffer }[] = []
    if (small.length) for await (const m of c.fetch(small.join(','), { uid: true, source: true }, { uid: true })) if (m.source) raws.push({ uid: m.uid, source: m.source })
    if (big.length) for await (const m of c.fetch(big.join(','), { uid: true, source: { maxLength: MAX_SOURCE } }, { uid: true })) if (m.source) raws.push({ uid: m.uid, source: m.source })
    for (const r of raws.sort((a, b) => a.uid - b.uid)) {
      try { if (await storeMail({ raw: r.source, direction })) stored++ } catch (e) { console.error('mail store: could not read one email', path, r.uid, e) }
      cur = { ...cur, upTo: Math.max(cur.upTo, r.uid) }
    }
    cur = { ...cur, upTo: Math.max(cur.upTo, batch[batch.length - 1]) }
  } else if (box.uidNext) cur = { ...cur, upTo: Math.max(cur.upTo, box.uidNext - 1) }
  return { cursor: cur, stored, more: uids.length > batch.length }
}

/** Finds the Sent folder, whatever the server calls it. */
export async function sentFolderPath(c: ImapFlow): Promise<string | null> {
  const boxes = await c.list()
  return (boxes.find((b) => b.specialUse === '\\Sent') ?? boxes.find((b) => /^(sent|sent items|sent messages|sent mail)$/i.test(b.name)))?.path ?? null
}

/** Brings new inbox and sent emails into the portal. Called on every mailbox check, on an open connection. */
export async function syncMailStore(c: ImapFlow): Promise<{ stored: number; more: boolean }> {
  const s = await loadState()
  const a = await syncFolder(c, 'INBOX', s.inbox, 'in')
  const sentPath = await sentFolderPath(c)
  const b = sentPath ? await syncFolder(c, sentPath, s.sent, 'out') : { cursor: s.sent, stored: 0, more: false }
  await saveState({ ...s, inbox: a.cursor, sent: b.cursor ?? undefined, startedAt: s.startedAt ?? now(), backfilled: s.backfilled || (!a.more && !b.more) })
  return { stored: a.stored + b.stored, more: a.more || b.more }
}

/** Removes stored emails older than the retention cutoff (2 years). */
export async function pruneMail(cutoff: string) {
  await db.delete(mailMessages).where(sql`${mailMessages.sentAt} < ${cutoff}`)
  await db.delete(mailThreads).where(sql`NOT EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = ${mailThreads.id})`)
}
