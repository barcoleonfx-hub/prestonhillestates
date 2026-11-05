import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { convert } from 'html-to-text'
import { simpleParser } from 'mailparser'
import { db, getClient, ready } from '@/db/client'
import { emailDocs, licences, licenceSuggestions, rentals, scanQueue, settings, type EmailDoc, type Rental } from '@/db/schema'
import { addressKey, classify, extract, findMention, normText, windowAt, type AddressKey, type DocKind, type Found } from './licensing-extract'
import { openSavedMailbox } from './mailbox'
import { now, uid } from './util'

// Reads the whole mailbox (every folder, going back years) for licences and safety certificates, matches them to
// rented properties by address and keeps what it finds as suggestions. Runs in the background a batch at a time.

const KEY = 'licence_scan'
const YEARS_BACK = 6
const PER_RUN_MS = 60_000
const MAX_MESSAGE = 20 * 1024 * 1024
const MAX_PDF = 6 * 1024 * 1024
const TEXT_LIMIT = 40_000
const SEARCHES: Record<string, unknown>[] = [
  ...['selective licence', 'selective license', 'licence number', 'license number', 'hmo licence', 'hmo license', 'property licence', 'licensing scheme',
    'gas safety', 'cp12', 'eicr', 'electrical installation condition', 'energy performance certificate',
    // Engineers often send just "certificate attached": the PDF is read to decide what it is.
    'certificate', 'lgsr', 'gas safe', 'safety record', 'electrical report', 'energy rating'].flatMap((t) => [{ subject: t }, { body: t }]),
  { from: 'brent.gov.uk' }, { from: 'harrow.gov.uk' },
]

export type ScanState = {
  status: 'idle' | 'searching' | 'reading' | 'done' | 'error'
  startedAt: string | null; finishedAt: string | null; by: string | null
  folders: number; queued: number; read: number; docs: number; suggestions: number; error: string | null
}
const EMPTY: ScanState = { status: 'idle', startedAt: null, finishedAt: null, by: null, folders: 0, queued: 0, read: 0, docs: 0, suggestions: 0, error: null }

export async function scanState(): Promise<ScanState> {
  await ready()
  const row = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  try { return row ? { ...EMPTY, ...JSON.parse(row.value) } : EMPTY } catch { return EMPTY }
}
async function save(s: ScanState) {
  const value = JSON.stringify(s)
  await db.insert(settings).values({ key: KEY, value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
}

export async function startScan(by: string) {
  await ready()
  await db.delete(scanQueue)
  await save({ ...EMPTY, status: 'searching', startedAt: now(), by })
}

async function claim(): Promise<boolean> {
  const t = new Date().toISOString(), before = new Date(Date.now() - 75_000).toISOString()
  const r = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('licence_scan', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [t, before] })
  return r.rowsAffected === 1
}

const SKIP_FOLDER = /trash|junk|spam|deleted|drafts|outbox|notes|calendar|contacts/i

/** Text of a PDF attachment, from its first few pages. */
async function pdfText(buf: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    if (pdf.numPages > 12) return ''
    const { text } = await extractText(pdf, { mergePages: true })
    return (Array.isArray(text) ? text.join('\n') : text).slice(0, TEXT_LIMIT)
  } catch { return '' }
}

/** One run: either find the matching emails in every folder, or read the next batch of them. */
export async function runLicenceScan(opts: { force?: boolean } = {}): Promise<{ ran: boolean }> {
  await ready()
  const st = await scanState()
  if (st.status !== 'searching' && st.status !== 'reading') return { ran: false }
  if (!opts.force && !(await claim())) return { ran: false }
  let c
  try { c = await openSavedMailbox() } catch (e) { await save({ ...st, status: 'error', error: (e as Error).message }); return { ran: true } }
  try {
    if (st.status === 'searching') {
      const since = new Date(Date.now() - YEARS_BACK * 365 * 86400000)
      const folders = (await c.list()).filter((f) => !f.flags?.has('\\Noselect') && !['\\Trash', '\\Junk', '\\Drafts'].includes(f.specialUse ?? '') && !SKIP_FOLDER.test(f.path))
      let queued = 0
      for (const f of folders) {
        const lock = await c.getMailboxLock(f.path, { readOnly: true })
        try {
          const found = new Set<number>()
          for (const q of SEARCHES) {
            const uids = await c.search({ since, ...q }, { uid: true }).catch(() => [])
            for (const u of (uids || []) as number[]) found.add(u)
          }
          const list = [...found]
          for (let i = 0; i < list.length; i += 300) {
            const ins = await db.insert(scanQueue).values(list.slice(i, i + 300).map((u) => ({ folder: f.path, uid: u }))).onConflictDoNothing()
            queued += ins.rowsAffected
          }
        } finally { lock.release() }
      }
      await save({ ...st, status: 'reading', folders: folders.length, queued, error: null })
      return { ran: true }
    }

    // Reading: a batch from one folder at a time, until the time for this run is used up.
    const started = Date.now()
    let read = st.read, docs = st.docs
    while (Date.now() - started < PER_RUN_MS) {
      const next = await db.select().from(scanQueue).where(eq(scanQueue.status, 'queued')).orderBy(asc(scanQueue.folder), asc(scanQueue.uid)).limit(15)
      if (!next.length) break
      const folder = next[0].folder
      const batch = next.filter((n) => n.folder === folder)
      const lock = await c.getMailboxLock(folder, { readOnly: true })
      try {
        for (const q of batch) {
          if (Date.now() - started > PER_RUN_MS) break
          const done = (status: string) => db.update(scanQueue).set({ status }).where(and(eq(scanQueue.folder, folder), eq(scanQueue.uid, q.uid)))
          const meta = await c.fetchOne(String(q.uid), { size: true }, { uid: true }).catch(() => null)
          if (!meta || (meta.size ?? 0) > MAX_MESSAGE) { await done('skipped'); read++; continue }
          const msg = await c.fetchOne(String(q.uid), { source: true }, { uid: true }).catch(() => null)
          if (!msg || !msg.source) { await done('skipped'); read++; continue }
          const mail = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true }).catch(() => null)
          if (!mail) { await done('skipped'); read++; continue }
          const body = mail.text || (mail.html ? convert(mail.html, { wordwrap: false }) : '')
          const files: string[] = []
          let pdfs = ''
          for (const a of mail.attachments ?? []) {
            const isPdf = /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename ?? '')
            if (!isPdf || a.size > MAX_PDF) continue
            files.push(a.filename ?? 'attachment.pdf')
            pdfs += `\n\n[${a.filename ?? 'PDF'}]\n${await pdfText(a.content)}`
          }
          const subject = mail.subject ?? ''
          const from = mail.from?.value?.[0]?.address ?? ''
          const text = `${subject}\n${body}${pdfs}`.slice(0, TEXT_LIMIT)
          const kinds = classify(subject, from, text)
          if (kinds.length) {
            const ins = await db.insert(emailDocs).values({
              id: uid(), folder, uid: q.uid, messageId: mail.messageId ?? null, subject: subject.slice(0, 300), fromAddr: from, sentAt: (mail.date ?? new Date()).toISOString(),
              kinds: kinds.join(','), files: files.join('\n') || null, text, createdAt: now(),
            }).onConflictDoNothing()
            docs += ins.rowsAffected
          }
          await done('done'); read++
        }
      } finally { lock.release() }
    }
    const left = (await db.select({ u: scanQueue.uid }).from(scanQueue).where(eq(scanQueue.status, 'queued')).limit(1)).length
    if (!left) {
      await matchDocs()
      // Totals across every scan, so a re-run doesn't look like it found less.
      const total = (await db.select({ id: emailDocs.id }).from(emailDocs)).length
      const open = (await db.select({ id: licenceSuggestions.id }).from(licenceSuggestions).where(eq(licenceSuggestions.status, 'new'))).length
      await save({ ...st, status: 'done', read, docs: total, suggestions: open, finishedAt: now(), error: null })
    } else await save({ ...st, read, docs, error: null })
    return { ran: true }
  } catch (e) {
    await save({ ...(await scanState()), error: `Paused: ${(e as Error).message}. It will try again in a couple of minutes.` })
    return { ran: true }
  } finally {
    await c.logout().catch(() => c.close())
  }
}

// ---------- matching what was read to properties ----------

/** Matches stored emails to rented properties (all of them, or just some) and records new suggestions. */
export async function matchDocs(rentalIds?: string[]): Promise<number> {
  await ready()
  const rs = rentalIds?.length ? await db.select().from(rentals).where(inArray(rentals.id, rentalIds)) : await db.select().from(rentals).where(eq(rentals.archived, false))
  const keys = rs.map((r) => addressKey(r.id, r.address, r.postcode)).filter(Boolean) as AddressKey[]
  if (!keys.length) return 0
  let added = 0
  const docs = await db.select().from(emailDocs)
  for (const d of docs) {
    const norm = normText(d.text)
    const sent = (d.sentAt ?? d.createdAt).slice(0, 10)
    for (const k of keys) {
      const at = findMention(norm, k)
      if (at < 0) continue
      const part = windowAt(d.text, at, norm.length)
      for (const kind of d.kinds.split(',') as DocKind[]) {
        const f = extract(kind, part, sent, d.fromAddr ?? '')
        if (!f) continue
        const ins = await db.insert(licenceSuggestions).values({ id: uid(), rentalId: k.id, docId: d.id, kind, found: JSON.stringify(f), confidence: f.confidence, createdAt: now() }).onConflictDoNothing()
        added += ins.rowsAffected
      }
    }
  }
  return added
}

export type Suggestion = { id: string; rentalId: string; kind: DocKind; found: Found; confidence: string; status: string; doc: Pick<EmailDoc, 'subject' | 'fromAddr' | 'sentAt' | 'files' | 'folder'> }

export async function suggestionsFor(rentalIds?: string[], status = 'new'): Promise<Suggestion[]> {
  await ready()
  const where = rentalIds ? and(eq(licenceSuggestions.status, status), inArray(licenceSuggestions.rentalId, rentalIds)) : eq(licenceSuggestions.status, status)
  const rows = await db.select({ s: licenceSuggestions, d: { subject: emailDocs.subject, fromAddr: emailDocs.fromAddr, sentAt: emailDocs.sentAt, files: emailDocs.files, folder: emailDocs.folder } })
    .from(licenceSuggestions).innerJoin(emailDocs, eq(emailDocs.id, licenceSuggestions.docId)).where(where)
  return rows.map(({ s, d }) => ({ id: s.id, rentalId: s.rentalId, kind: s.kind as DocKind, found: JSON.parse(s.found) as Found, confidence: s.confidence, status: s.status, doc: d }))
}

const rank = (c: string) => (c === 'high' ? 3 : c === 'medium' ? 2 : 1)
/** For each property and kind, the suggestion worth showing first: the latest expiry, then the most certain. */
export function bestOf(list: Suggestion[]): Suggestion[] {
  const by = new Map<string, Suggestion>()
  for (const s of list) {
    const k = `${s.rentalId}|${s.kind}`
    const cur = by.get(k)
    const key = (x: Suggestion) => `${x.found.expiresOn ?? x.found.startsOn ?? x.doc.sentAt ?? ''}|${rank(x.confidence)}`
    if (!cur || key(s) > key(cur)) by.set(k, s)
  }
  return [...by.values()]
}

/** Puts a suggestion into the register: a new licence record, or a certificate date (only ever moved later). */
export async function applySuggestion(id: string, by: string): Promise<{ ok: boolean; note?: string }> {
  await ready()
  const s = await db.query.licenceSuggestions.findFirst({ where: eq(licenceSuggestions.id, id) })
  if (!s || s.status !== 'new') return { ok: false, note: 'Already dealt with.' }
  const r = await db.query.rentals.findFirst({ where: eq(rentals.id, s.rentalId) })
  if (!r) return { ok: false }
  const f = JSON.parse(s.found) as Found
  let note: string | undefined
  if (s.kind === 'licence') {
    const existing = await db.select().from(licences).where(eq(licences.rentalId, r.id))
    const same = existing.find((l) => (f.number && l.number?.toUpperCase() === f.number) || (f.expiresOn && l.expiresOn === f.expiresOn))
    if (same) {
      // Fill in anything the existing record is missing; don't overwrite.
      await db.update(licences).set({ number: same.number ?? f.number ?? null, expiresOn: same.expiresOn ?? f.expiresOn ?? null, startsOn: same.startsOn ?? f.startsOn ?? null, council: same.council ?? f.council ?? null, updatedAt: now() }).where(eq(licences.id, same.id))
      note = 'Added to the licence already on file.'
    } else {
      await db.insert(licences).values({
        id: uid(), rentalId: r.id, kind: f.licenceKind ?? 'selective', council: f.council ?? r.council, number: f.number ?? null, status: f.status === 'applied' ? 'applied' : 'granted',
        appliedOn: f.status === 'applied' ? f.startsOn ?? null : null, startsOn: f.status === 'applied' ? null : f.startsOn ?? null, expiresOn: f.expiresOn ?? null,
        notes: 'Found in the mailbox', createdBy: by, createdAt: now(), updatedAt: now(),
      })
    }
  } else {
    const col = s.kind === 'gas' ? 'gasExpires' : s.kind === 'eicr' ? 'eicrExpires' : 'epcExpires'
    const cur = r[col as keyof Rental] as string | null
    const patch: Partial<Rental> = {}
    if (f.expiresOn && (!cur || f.expiresOn > cur)) (patch as Record<string, string>)[col] = f.expiresOn
    else if (f.expiresOn) note = `Kept the later date already on file (${cur}).`
    if (s.kind === 'epc' && f.rating && (!r.epcRating || (f.expiresOn && (!cur || f.expiresOn >= cur)))) patch.epcRating = f.rating
    if (Object.keys(patch).length) await db.update(rentals).set({ ...patch, updatedAt: now() }).where(eq(rentals.id, r.id))
  }
  await db.update(licenceSuggestions).set({ status: 'applied', decidedBy: by, decidedAt: now() }).where(eq(licenceSuggestions.id, id))
  // Other suggestions of the same kind for this property are no longer needed.
  await db.update(licenceSuggestions).set({ status: 'superseded', decidedBy: by, decidedAt: now() })
    .where(and(eq(licenceSuggestions.rentalId, r.id), eq(licenceSuggestions.kind, s.kind), eq(licenceSuggestions.status, 'new')))
  return { ok: true, note }
}

export async function dismissSuggestions(ids: string[], by: string) {
  await ready()
  if (ids.length) await db.update(licenceSuggestions).set({ status: 'dismissed', decidedBy: by, decidedAt: now() }).where(inArray(licenceSuggestions.id, ids))
}
