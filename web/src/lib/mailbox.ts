import 'server-only'
import { ImapFlow } from 'imapflow'
import { promises as dns } from 'node:dns'
import net from 'node:net'
import tls from 'node:tls'
import { eq } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { notifications, settings } from '@/db/schema'
import { analyse } from '@/lib/email-import'
import { saveEmailRow } from '@/lib/email-intake'
import { attachReply, linkSentReplies, matchReply } from '@/lib/enquiry-thread'
import { enquiryLabel } from '@/lib/enquiry-labels'
import { open, seal } from '@/lib/secret-box'
import { now, uid } from '@/lib/util'
import nodemailer from 'nodemailer'
import { sentFolderPath, storeMail, syncMailStore } from '@/lib/mail-store'

// Reads new emails from the office mailbox (IMAP, e.g. Fasthosts) every few minutes and turns
// Zoopla, OnTheMarket and website-form leads into enquiries under "Needs a reply", with an alert.
// The mailbox is opened read-only: nothing is marked as read, moved or deleted.

export const FASTHOSTS_IMAP = 'mail.livemail.co.uk'
const KEY = 'mailbox'
const EVERY_MS = 2 * 60 * 1000
const FIRST_LOOK_DAYS = 3 // when first connected, pick up the last few days in case anything was missed
const MAX_PER_RUN = 150

export type MailboxSettings = {
  host: string; port: number; user: string; pass: string // sealed
  enabled: boolean; includePeople: boolean
  uidValidity?: string; lastUid?: number
  lastCheckAt?: string; lastOkAt?: string; lastError?: string | null; lastFound?: number; totalFound?: number
  connectedAt?: string
  smtpHost?: string; smtpPort?: number
  lastStored?: number
  /** The Junk/Spam folder, checked for portal and website leads that landed there. */
  junkPath?: string | null; junkValidity?: string; junkLastUid?: number; lastJunkFound?: number
  /** Folders besides the Inbox that are checked (mail rules often file portal leads into their own folder).
   *  Not set: found automatically by name ("On The Market", "Zoopla", "Enquiries"…). */
  watched?: string[]
  /** Where each checked folder got to. */
  folders?: Record<string, { validity: string; lastUid: number }>
  /** Every folder in the mailbox that could hold leads, for choosing on Email settings. */
  allFolders?: string[]
}

/** Folder names that look like they hold portal or website leads. */
export const LEAD_FOLDER = /on ?the ?market|onthemarket|\botm\b|zoopla|rightmove|enquir|\bleads?\b|website|valuations?|portals?|applicants?|lettings|sales|web ?chat|chat/i
/** Folders inside the Inbox: mail rules file leads there, so they're checked unless someone unticks them. */
export const autoWatched = (p: string) => LEAD_FOLDER.test(p) || /^inbox[/.]/i.test(p)
const NEW_FOLDER_DAYS = 14 // a folder checked for the first time: pick up the last fortnight

export async function setWatchedFolders(paths: string[]) {
  const s = await load()
  if (s) await store({ ...s, watched: paths })
}
export type MailboxStatus = Omit<MailboxSettings, 'pass'> & { hasPassword: boolean }

async function load(): Promise<MailboxSettings | null> {
  await ready()
  const row = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  if (!row) return null
  try { return JSON.parse(row.value) as MailboxSettings } catch { return null }
}

async function store(s: MailboxSettings) {
  await db.insert(settings).values({ key: KEY, value: JSON.stringify(s), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(s), updatedAt: now() } })
}

// ---------- emails looked at but not added, so nothing disappears without a trace ----------

const SKIPPED_KEY = 'mailbox_skipped'
export type SkippedEmail = { at: string; seenAt: string; folder: string; uid: number; validity: string; from: string | null; subject: string; name: string | null; reason: string }

export async function skippedEmails(): Promise<SkippedEmail[]> {
  await ready()
  const row = await db.query.settings.findFirst({ where: eq(settings.key, SKIPPED_KEY) })
  try { return row ? (JSON.parse(row.value) as SkippedEmail[]) : [] } catch { return [] }
}
async function noteSkipped(items: SkippedEmail[]) {
  if (!items.length) return
  const seen = new Set<string>()
  const keep = [...items, ...(await skippedEmails())].filter((x) => { const k = `${x.folder}|${x.uid}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 60)
  await db.insert(settings).values({ key: SKIPPED_KEY, value: JSON.stringify(keep), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(keep), updatedAt: now() } })
}
export async function forgetSkipped(uidInFolder: number, folder: string) {
  const keep = (await skippedEmails()).filter((x) => !(x.uid === uidInFolder && x.folder === folder))
  await db.insert(settings).values({ key: SKIPPED_KEY, value: JSON.stringify(keep), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(keep), updatedAt: now() } })
}

/** Adds an email the check passed over (staff decided it is an enquiry after all). */
export async function addSkippedEmail(folder: string, emailUid: number): Promise<{ ok: boolean; error?: string; name?: string }> {
  const s = await load()
  if (!s?.pass) return { ok: false, error: 'The mailbox isn’t connected.' }
  const pass = open(s.pass)
  if (!pass) return { ok: false, error: 'The saved mailbox password could not be read.' }
  const c = client(s.host, s.port, s.user, pass)
  try {
    await c.connect()
    await c.mailboxOpen(folder, { readOnly: true })
    let source: string | null = null
    for await (const m of c.fetch(String(emailUid), { uid: true, source: true }, { uid: true })) if (m.source) source = m.source.toString('utf8')
    await c.logout().catch(() => c.close())
    if (!source) return { ok: false, error: 'That email is no longer in the mailbox.' }
    const row = await analyse(source)
    if (!row) return { ok: false, error: 'That email couldn’t be read.' }
    const forced = { ...row, category: row.source === 'zoopla' || row.source === 'onthemarket' ? 'portal' as const : row.source === 'website' ? 'website' as const : 'person' as const }
    const saved = await saveEmailRow(forced, { by: null, handled: false, startedAt: now() })
    await forgetSkipped(emailUid, folder)
    return saved ? { ok: true, name: row.name } : { ok: false, error: 'It’s already in the portal.' }
  } catch (e) {
    await c.logout().catch(() => c.close())
    return { ok: false, error: explain(e) }
  }
}

export async function mailboxStatus(): Promise<MailboxStatus | null> {
  const s = await load()
  if (!s) return null
  const { pass, ...rest } = s
  return { ...rest, hasPassword: !!pass }
}

function client(host: string, port: number, user: string, pass: string) {
  const c = new ImapFlow({
    host, port, secure: port === 993, auth: { user, pass }, logger: false, ...(port === 143 ? { doSTARTTLS: true } : {}),
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000, disableAutoIdle: true,
  })
  // A dropped connection is reported as an 'error' event; without a listener Node would stop the whole server.
  c.on('error', (e: unknown) => console.error('mailbox connection error', e instanceof Error ? e.message : e))
  return c
}

/** Plain-English reason a connection failed. */
function explain(e: unknown): string {
  const err = e as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string }
  if (err?.authenticationFailed || /auth|login|credentials|password/i.test(err?.responseText ?? err?.message ?? '')) return 'The email address or password was not accepted. Check them, and that IMAP is switched on for this mailbox.'
  if (err?.code === 'ENOTFOUND') return 'That mail server name could not be found. Check the server name.'
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED' || /timeout|timed out|required time/i.test(err?.message ?? '')) return 'The mail server did not answer. Check the server name and port.'
  return (err?.responseText || err?.message || 'Could not connect to the mailbox.').slice(0, 200)
}

/** Tries the login and opens the inbox. Returns how many emails are in it. */
export async function testMailbox(host: string, port: number, user: string, pass: string): Promise<{ ok: true; messages: number } | { ok: false; error: string }> {
  const c = client(host, port, user, pass)
  try {
    await c.connect()
    const box = await c.mailboxOpen('INBOX', { readOnly: true })
    return { ok: true, messages: box.exists }
  } catch (e) {
    return { ok: false, error: explain(e) }
  } finally {
    await c.logout().catch(() => c.close())
  }
}

/** Who handles email for a domain, from its MX records, in plain words, plus the servers worth trying. */
export async function mailProvider(domain: string): Promise<{ name: string | null; mx: string[]; hosts: string[]; note?: string }> {
  let mx: string[] = []
  try { mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase()) } catch { /* no MX records, or DNS unavailable */ }
  const all = mx.join(' ')
  if (/livemail\.co\.uk|fasthosts/.test(all)) return { name: 'Fasthosts', mx, hosts: ['mail.livemail.co.uk', 'imap.livemail.co.uk', 'imap.fasthosts.co.uk'] }
  if (/outlook\.com|office365|microsoft/.test(all)) return { name: 'Microsoft 365', mx, hosts: ['outlook.office365.com'], note: 'Your email is run by Microsoft 365, which no longer lets other apps sign in with just a password. It needs a one-off approval through Microsoft instead; tell us and we’ll set that up.' }
  if (/google\.com|googlemail/.test(all)) return { name: 'Google Workspace', mx, hosts: ['imap.gmail.com'], note: 'Your email is run by Google. Use an “app password” from your Google account (Security → App passwords) rather than your normal password.' }
  if (/ionos|1and1/.test(all)) return { name: 'IONOS', mx, hosts: ['imap.ionos.co.uk'] }
  if (/123-reg/.test(all)) return { name: '123 Reg', mx, hosts: ['imap.123-reg.co.uk'] }
  return { name: null, mx, hosts: [`mail.${domain}`, `imap.${domain}`] }
}

/** Quick check that something answers like a mail server at host:port (IMAP greeting), without logging in. */
function probe(host: string, port: number, ms = 9000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => { if (!done) { done = true; sock.destroy(); resolve(ok) } }
    const sock: net.Socket = port === 993
      ? tls.connect({ host, port, servername: host, timeout: ms })
      : net.connect({ host, port, timeout: ms })
    sock.setTimeout(ms, () => finish(false))
    sock.on('error', () => finish(false))
    sock.on('data', (d) => finish(/^\* (OK|PREAUTH)/i.test(d.toString())))
  })
}

/**
 * Finds a mail server that answers for this mailbox: the one typed in first, then the usual ones for
 * whoever runs the domain's email. Tries them side by side and keeps the first in that order that answers.
 */
export async function findMailServer(user: string, typedHost: string, typedPort: number) {
  const domain = user.split('@')[1]?.toLowerCase() ?? ''
  const provider = await mailProvider(domain)
  const fasthosts = ['mail.livemail.co.uk', 'imap.livemail.co.uk', 'imap.fasthosts.co.uk']
  const hosts = [...new Set([typedHost, ...provider.hosts, ...(provider.name ? [] : fasthosts)].filter(Boolean))]
  const tries = hosts.flatMap((h) => (h === typedHost && typedPort !== 993 ? [{ host: h, port: typedPort }] : [{ host: h, port: 993 }, { host: h, port: 143 }]))
  const results = await Promise.all(tries.map(async (t) => ({ ...t, ok: await probe(t.host, t.port) })))
  return { found: results.find((r) => r.ok) ?? null, tried: tries, provider }
}

/** Saves the mailbox details. A blank password keeps the one already saved. */
export async function saveMailbox(input: { host: string; port: number; user: string; pass?: string; enabled: boolean; includePeople: boolean }) {
  const old = await load()
  const sameBox = old && old.user.toLowerCase() === input.user.toLowerCase() && old.host === input.host
  await store({
    ...(sameBox ? old : {}),
    host: input.host, port: input.port, user: input.user,
    pass: input.pass ? seal(input.pass) : old?.pass ?? '',
    enabled: input.enabled, includePeople: input.includePeople,
    lastError: null,
    connectedAt: sameBox ? old?.connectedAt ?? now() : now(),
  })
}

export async function setMailboxEnabled(enabled: boolean) {
  const s = await load()
  if (s) await store({ ...s, enabled, lastError: enabled ? s.lastError : null })
}

export async function forgetMailbox() {
  await ready()
  await db.delete(settings).where(eq(settings.key, KEY))
}

/** Only one check at a time across the whole server, and not more often than every couple of minutes. */
async function claim(force: boolean): Promise<boolean> {
  const client = getClient()
  const t = new Date().toISOString()
  const before = new Date(Date.now() - (force ? 20_000 : EVERY_MS - 10_000)).toISOString()
  const r = await client.execute({
    sql: `INSERT INTO jobs (name, last_run_at) VALUES ('mailbox', ?)
          ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
    args: [t, before],
  })
  return r.rowsAffected === 1
}

export type CheckResult = { ran: boolean; found?: number; error?: string }

/**
 * Looks for new emails since the last check and saves the enquiries among them.
 * Safe to call often: it does nothing unless the mailbox is switched on and a couple of minutes have passed.
 */
export async function checkMailbox(opts: { force?: boolean; lookBackDays?: number } = {}): Promise<CheckResult> {
  const s = await load()
  if (!s?.enabled || !s.pass) return { ran: false }
  if (!(await claim(!!opts.force))) return { ran: false }
  const pass = open(s.pass)
  if (!pass) {
    await store({ ...s, lastCheckAt: now(), lastError: 'The saved password could not be read. Enter it again.' })
    return { ran: true, error: 'password' }
  }
  const c = client(s.host, s.port, s.user, pass)
  const startedAt = now()
  let found = 0
  let lastUid = s.lastUid ?? 0
  let uidValidity = s.uidValidity
  try {
    await c.connect()
    const box = await c.mailboxOpen('INBOX', { readOnly: true })
    const validity = String(box.uidValidity)
    // First run, or the server renumbered the mailbox: look at the last few days only.
    let uids: number[]
    // Asked to look again at recent days (nothing is added twice), or first run / renumbered mailbox.
    if (opts.lookBackDays) {
      uids = ((await c.search({ since: new Date(Date.now() - opts.lookBackDays * 86400000) }, { uid: true })) || []) as number[]
      uidValidity = validity
    } else if (!uidValidity || uidValidity !== validity || !lastUid) {
      const since = new Date(Date.now() - FIRST_LOOK_DAYS * 86400000)
      uids = ((await c.search({ since }, { uid: true })) || []) as number[]
      uidValidity = validity
    } else {
      uids = box.uidNext > lastUid + 1 ? (((await c.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []) as number[]).filter((u) => u > lastUid) : []
    }
    uids.sort((a, b) => a - b)
    const limit = opts.lookBackDays ? 800 : MAX_PER_RUN
    const batch = uids.slice(0, limit)
    const skipped: SkippedEmail[] = []
    // Reads the given emails in the open folder; saves the enquiries among them. In Junk, only portal and
    // website leads count (anything else there really is junk).
    const take = async (folder: string, list: number[], validityHere: string, junk: boolean, leadFolder = false) => {
      const sizes = new Map<number, number>()
      if (list.length) for await (const m of c.fetch(list.join(','), { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size ?? 0)
      // Lead emails are small: skip anything over 1 MB (big attachments), and read a few at a time.
      const want = list.filter((u) => (sizes.get(u) ?? 0) <= 1_000_000)
      for (let i = 0; i < want.length; i += 10) {
        const raws: { uid: number; source: string }[] = []
        for await (const m of c.fetch(want.slice(i, i + 10).join(','), { uid: true, source: true }, { uid: true })) {
          if (m.source) raws.push({ uid: m.uid, source: m.source.toString('utf8') })
        }
        for (const { uid: u, source } of raws.sort((a, b) => a.uid - b.uid)) {
          try {
            const row = await analyse(source)
            if (!row) continue
            // A reply to one of our emails (or a follow-up from someone with an enquiry) joins that enquiry.
            const reply = await matchReply(row).catch(() => null)
            if (reply) { if (await attachReply(reply.enquiryId, row, reply.how)) found++; continue }
            // In a folder the office's own mail rules fill with leads (Rightmove, Webchat, Valuation…), an email from a
            // person or a service counts as an enquiry too, as long as it has someone to contact.
            const wanted = junk ? row.category === 'portal' || row.category === 'website'
              : row.category !== 'skipped' && (row.category !== 'person' || leadFolder || (s.includePeople && row.intent))
            if (wanted) {
              const saved = await saveEmailRow(row, { by: null, handled: false, startedAt })
              if (saved) {
                found++
                await db.insert(notifications).values({
                  id: uid(), kind: 'enquiry', appointmentId: null,
                  title: `${enquiryLabel({ kind: 'email', source: row.source })}: ${row.name}${junk ? ' (found in Junk)' : ''}`,
                  body: [row.name, [row.phone, row.about ?? row.subject].filter(Boolean).join(' · ')].join('\n'),
                  createdBy: null, createdAt: now(),
                })
              }
            } else if (!junk && (row.category === 'person' ? !!row.intent : !/account email|no name, email or phone|older than|own address|newsletter/i.test(row.reason ?? ''))) {
              // Portal or website emails we didn't add, and people's emails that look like enquiries.
              skipped.push({
                at: row.date, seenAt: now(), folder, uid: u, validity: validityHere, from: row.source, subject: row.subject, name: row.name && row.name !== 'Unknown' ? row.name : null,
                reason: row.category === 'skipped' ? (row.reason ?? 'Not an enquiry') : 'An email from a person (emails from people aren’t added automatically)',
              })
            }
          } catch (e) {
            console.error('mailbox: could not read one email', folder, u, e)
          }
        }
      }
    }
    await take('INBOX', batch, validity, false)
    if (batch.length) lastUid = Math.max(lastUid, ...batch)

    // Other folders: leads that mail rules filed elsewhere ("On The Market", "Zoopla"…), and Junk.
    const listed = await c.list().catch(() => [])
    const usable = listed.filter((f) => !f.flags?.has('\\Noselect'))
    const junkPath = (usable.find((f) => f.specialUse === '\\Junk') ?? usable.find((f) => /^(junk|spam|junk e-?mail|bulk mail)$/i.test(f.name)))?.path ?? null
    const notLeads = (f: (typeof usable)[number]) => f.path.toUpperCase() === 'INBOX' || f.path === junkPath || ['\\Sent', '\\Drafts', '\\Trash', '\\All', '\\Flagged'].includes(f.specialUse ?? '')
      || /^(sent|drafts?|deleted|trash|bin|outbox|notes|calendar|contacts|tasks|journal|conversation history|sync issues|rss|archive)/i.test(f.name)
    const allFolders = usable.filter((f) => !notLeads(f)).map((f) => f.path)
    const watched = (s.watched ?? allFolders.filter(autoWatched)).filter((p) => allFolders.includes(p))
    const folders: Record<string, { validity: string; lastUid: number }> = { ...(s.folders ?? {}) }
    if (s.junkPath && s.junkValidity && !folders[s.junkPath]) folders[s.junkPath] = { validity: s.junkValidity, lastUid: s.junkLastUid ?? 0 }
    for (const path of [...watched, ...(junkPath ? [junkPath] : [])]) {
      try {
        const fb = await c.mailboxOpen(path, { readOnly: true })
        const fv = String(fb.uidValidity), st = folders[path]
        const fresh = !st || st.validity !== fv || !st.lastUid
        let list: number[]
        if (opts.lookBackDays || fresh) list = ((await c.search({ since: new Date(Date.now() - (opts.lookBackDays ?? (st ? FIRST_LOOK_DAYS : NEW_FOLDER_DAYS)) * 86400000) }, { uid: true })) || []) as number[]
        else list = fb.uidNext > st.lastUid + 1 ? (((await c.search({ uid: `${st.lastUid + 1}:*` }, { uid: true })) || []) as number[]).filter((u) => u > st.lastUid) : []
        list = list.sort((a, b) => a - b).slice(0, limit)
        await take(path, list, fv, path === junkPath, path !== junkPath)
        folders[path] = { validity: fv, lastUid: Math.max(fresh ? 0 : st.lastUid, ...list, list.length ? 0 : (fb.uidNext ?? 1) - 1) }
      } catch (e) { console.error('mailbox: folder check failed', path, e) }
    }
    await noteSkipped(skipped).catch(() => {})

    // Keep the portal's copy of the inbox and sent mail up to date (for the Inbox page).
    let stored = s.lastStored ?? 0
    try { stored = (await syncMailStore(c)).stored } catch (e) { console.error('mail store sync failed', e) }
    // Replies sent from Apple Mail to someone in an enquiry's conversation.
    await linkSentReplies().catch((e) => console.error('linking sent replies failed', e))
    await c.logout().catch(() => c.close())
    if (!uids.length && box.uidNext) lastUid = Math.max(lastUid, box.uidNext - 1)
    await store({ ...s, junkPath, folders, allFolders, uidValidity, lastUid, lastCheckAt: now(), lastOkAt: now(), lastError: null, lastFound: found, totalFound: (s.totalFound ?? 0) + found, lastStored: stored })
    return { ran: true, found }
  } catch (e) {
    await c.logout().catch(() => c.close())
    const error = explain(e)
    await store({ ...s, lastCheckAt: now(), lastError: error })
    return { ran: true, error }
  }
}

/** A connected client for the saved mailbox (caller logs out). Used by the inbox audit. */
export async function openSavedMailbox(): Promise<ImapFlow> {
  const s = await load()
  if (!s?.pass) throw new Error('Connect the mailbox first.')
  const pass = open(s.pass)
  if (!pass) throw new Error('The saved password could not be read. Enter it again on the Email inbox page.')
  const c = client(s.host, s.port, s.user, pass)
  await c.connect()
  return c
}

/** The outgoing (SMTP) server for the saved mailbox: Fasthosts' by default. */
function smtpFor(s: MailboxSettings) {
  const host = s.smtpHost || (/livemail\.co\.uk$/.test(s.host) ? 'smtp.livemail.co.uk' : s.host.replace(/^(imap|mail)\./, 'smtp.'))
  const port = s.smtpPort || 465
  return { host, port }
}

export type OutgoingMail = { to: string[]; cc?: string[]; subject: string; text: string; html?: string; headers?: Record<string, string>; inReplyTo?: string | null; references?: string[]; by?: string | null }

/**
 * Sends an email from the office mailbox, puts a copy in its Sent folder (so Apple Mail shows it too)
 * and files it in the portal's conversation history.
 */
export async function sendFromMailbox(m: OutgoingMail): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const s = await load()
  if (!s?.pass) return { ok: false, error: 'Connect the mailbox on the Email inbox page first.' }
  const pass = open(s.pass)
  if (!pass) return { ok: false, error: 'The saved mailbox password could not be read. Enter it again on the Email inbox page.' }
  const from = `Preston Hill Estates <${s.user}>`
  // Build the message once, so exactly the same email is sent, saved in Sent and kept in the portal.
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail({
    from, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, text: m.text, html: m.html, headers: m.headers,
    inReplyTo: m.inReplyTo ?? undefined, references: m.references?.length ? m.references : undefined,
  })
  const raw = built.message as Buffer
  const { host, port } = smtpFor(s)
  try {
    await nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465 && port !== 25, auth: { user: s.user, pass }, connectionTimeout: 20_000 })
      .sendMail({ envelope: { from: s.user, to: [...m.to, ...(m.cc ?? [])] }, raw })
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string }
    const why = err.code === 'EAUTH' || err.responseCode === 535 ? 'The mail server didn’t accept the mailbox password for sending.'
      : err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET' ? `Couldn’t reach the outgoing mail server (${host}:${port}).`
      : (err.message ?? 'Sending failed.').slice(0, 200)
    return { ok: false, error: why }
  }
  // Copy into Sent, then into the portal's history. Neither should undo a send that worked.
  const c = client(s.host, s.port, s.user, pass)
  try { await c.connect(); const path = await sentFolderPath(c); if (path) await c.append(path, raw, ['\\Seen']) } catch (e) { console.error('could not save a copy in Sent', e) } finally { await c.logout().catch(() => c.close()) }
  await storeMail({ raw, direction: 'out', via: 'portal', sentBy: m.by ?? null }).catch((e) => console.error('could not file sent email', e))
  return { ok: true, messageId: built.messageId ?? null }
}

export type BulkMail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }

/**
 * One SMTP connection for sending a batch of campaign emails from the office mailbox. Unlike sendFromMailbox,
 * these aren't copied into Sent or the portal's inbox: thousands of newsletters would bury the real mail.
 */
export async function bulkSender(): Promise<{ from: string; user: string; send: (m: BulkMail) => Promise<{ ok: true } | { ok: false; error: string; fatal: boolean }>; close: () => void } | { error: string }> {
  const s = await load()
  if (!s?.pass) return { error: 'Connect the mailbox in Email settings first.' }
  const pass = open(s.pass)
  if (!pass) return { error: 'The saved mailbox password could not be read. Enter it again in Email settings.' }
  const { host, port } = smtpFor(s)
  const t = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465 && port !== 25, auth: { user: s.user, pass }, connectionTimeout: 20_000, pool: true, maxConnections: 1 })
  const from = `Preston Hill Estates <${s.user}>`
  return {
    from, user: s.user,
    async send(m) {
      try {
        await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers })
        return { ok: true }
      } catch (e) {
        const err = e as { code?: string; responseCode?: number; message?: string }
        const auth = err.code === 'EAUTH' || err.responseCode === 535
        const conn = err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET'
        // 4xx after the connection is up usually means "slow down" (a sending limit); stop this batch and try later.
        const limit = !!err.responseCode && err.responseCode >= 400 && err.responseCode < 500
        return {
          ok: false, fatal: auth || conn || limit,
          error: auth ? 'The mail server didn’t accept the mailbox password for sending.' : conn ? `Couldn’t reach the outgoing mail server (${host}:${port}).`
            : limit ? `The mail server asked us to slow down: ${(err.message ?? '').slice(0, 160)}` : (err.message ?? 'Sending failed.').slice(0, 200),
        }
      }
    },
    close: () => t.close(),
  }
}
