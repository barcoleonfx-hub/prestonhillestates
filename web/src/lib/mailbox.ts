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
import { enquiryLabel } from '@/lib/enquiry-labels'
import { open, seal } from '@/lib/secret-box'
import { now, uid } from '@/lib/util'

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

export async function mailboxStatus(): Promise<MailboxStatus | null> {
  const s = await load()
  if (!s) return null
  const { pass, ...rest } = s
  return { ...rest, hasPassword: !!pass }
}

function client(host: string, port: number, user: string, pass: string) {
  return new ImapFlow({
    host, port, secure: port === 993, auth: { user, pass }, logger: false, ...(port === 143 ? { doSTARTTLS: true } : {}),
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 60_000, disableAutoIdle: true,
  })
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
export async function checkMailbox(opts: { force?: boolean } = {}): Promise<CheckResult> {
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
    if (!uidValidity || uidValidity !== validity || !lastUid) {
      const since = new Date(Date.now() - FIRST_LOOK_DAYS * 86400000)
      uids = ((await c.search({ since }, { uid: true })) || []) as number[]
      uidValidity = validity
    } else {
      uids = box.uidNext > lastUid + 1 ? (((await c.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []) as number[]).filter((u) => u > lastUid) : []
    }
    uids.sort((a, b) => a - b)
    const batch = uids.slice(0, MAX_PER_RUN)
    const raws: { uid: number; source: string }[] = []
    if (batch.length) {
      for await (const m of c.fetch(batch.join(','), { uid: true, source: true }, { uid: true })) {
        if (m.source) raws.push({ uid: m.uid, source: m.source.toString('utf8') })
      }
    }
    await c.logout().catch(() => c.close())

    for (const { uid: u, source } of raws.sort((a, b) => a.uid - b.uid)) {
      try {
        const row = await analyse(source)
        const wanted = row && row.category !== 'skipped' && (row.category !== 'person' || (s.includePeople && row.intent))
        if (row && wanted) {
          const saved = await saveEmailRow(row, { by: null, handled: false, startedAt })
          if (saved) {
            found++
            await db.insert(notifications).values({
              id: uid(), kind: 'enquiry', appointmentId: null,
              title: `${enquiryLabel({ kind: 'email', source: row.source })}: ${row.name}`,
              body: [row.name, [row.phone, row.about ?? row.subject].filter(Boolean).join(' · ')].join('\n'),
              createdBy: null, createdAt: now(),
            })
          }
        }
      } catch (e) {
        console.error('mailbox: could not read one email', u, e)
      }
      lastUid = Math.max(lastUid, u)
    }
    if (!raws.length && uids.length) lastUid = Math.max(lastUid, ...batch)
    if (!uids.length && box.uidNext) lastUid = Math.max(lastUid, box.uidNext - 1)
    await store({ ...s, uidValidity, lastUid, lastCheckAt: now(), lastOkAt: now(), lastError: null, lastFound: found, totalFound: (s.totalFound ?? 0) + found })
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
