import 'server-only'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { councilRegisters, emailDocs, emailFiles, licences, licenceSuggestions, registerHits, rentals, type CouncilRegister } from '@/db/schema'
import { addressKey, datesIn, normText, type AddressKey, type Found } from './licensing-extract'
import { localPath } from './storage'
import { now, uid } from './util'

// Councils must keep a public register of licensed properties. Brent publishes theirs as a PDF; Harrow has
// downloadable selective and HMO registers. Every week the portal downloads each one, reads it and checks every
// property in that council against it: on the register (with its reference and dates) or not.

const SEED: Omit<CouncilRegister, 'id' | 'lastFetchedAt' | 'lastOkAt' | 'lastError' | 'asOf' | 'entries' | 'fileKey' | 'docId' | 'updatedAt'>[] = [
  { council: 'brent', name: 'Brent public register of licensed properties', enabled: true,
    url: 'https://www.brent.gov.uk/-/media/files/resident-documents/housing-documents/online-register-of-licenced-properties.pdf',
    pageUrl: 'https://www.brent.gov.uk/housing/landlords/property-licensing' },
  { council: 'harrow', name: 'Harrow selective licensing register', enabled: true,
    url: 'https://www.harrow.gov.uk/downloads/file/23809/selective-licensing-register', pageUrl: 'https://www.harrow.gov.uk/licences/selective-licensing' },
  { council: 'harrow', name: 'Harrow HMO register', enabled: true,
    url: 'https://www.harrow.gov.uk/downloads/file/23799/hmo-register-of-properties', pageUrl: 'https://www.harrow.gov.uk/licences/licences-houses-multiple-occupation-hmos' },
]

export async function registers(): Promise<CouncilRegister[]> {
  await ready()
  let rows = await db.select().from(councilRegisters)
  if (!rows.length) {
    await db.insert(councilRegisters).values(SEED.map((s) => ({ ...s, id: uid(), updatedAt: now() })))
    rows = await db.select().from(councilRegisters)
  }
  return rows
}

const UA = 'Mozilla/5.0 (compatible; PrestonHillPortal/1.0; licensing register check)'
const MAX_BYTES = 60 * 1024 * 1024

async function get(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html;q=0.8,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`The council’s site answered ${r.status} for ${url}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error('The register file is larger than expected (over 60 MB)')
  return { buf, type: r.headers.get('content-type') ?? '', url: r.url || url }
}
const kindOf = (buf: Buffer, type: string, url: string) =>
  buf.subarray(0, 5).toString() === '%PDF-' ? 'pdf' : buf.subarray(0, 2).toString() === 'PK' ? 'xlsx' : /csv/i.test(type) || /\.csv(\?|$)/i.test(url) ? 'csv' : /html/i.test(type) || /^\s*</.test(buf.subarray(0, 200).toString()) ? 'html' : 'other'

/** The register file: the URL itself, or, if that's a web page, the register file it links to. */
async function download(reg: CouncilRegister): Promise<{ buf: Buffer; kind: 'pdf' | 'xlsx' | 'csv'; url: string }> {
  const tryUrl = async (u: string, depth = 0): Promise<{ buf: Buffer; kind: 'pdf' | 'xlsx' | 'csv'; url: string } | null> => {
    const res = await get(u)
    const k = kindOf(res.buf, res.type, res.url)
    if (k === 'pdf' || k === 'xlsx' || k === 'csv') return { buf: res.buf, kind: k, url: res.url }
    if (k !== 'html' || depth > 1) return null
    // A page: follow the link that looks most like the register file.
    const html = res.buf.toString('utf8')
    const links = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), res.url).toString())
    const score = (l: string) => (/(register|licen[cs]ed-propert|licensed propert)/i.test(l) ? 2 : 0) + (/\.(pdf|xlsx|csv)(\?|$)|\/download(\/|$)|\/downloads\/file\//i.test(l) ? 2 : 0) - (/\.(css|js|png|jpg|svg)(\?|$)/i.test(l) ? 9 : 0)
    const best = links.filter((l) => score(l) >= 3).sort((a, b) => score(b) - score(a))
    for (const l of best.slice(0, 3)) { const got = await tryUrl(l, depth + 1).catch(() => null); if (got) return got }
    return null
  }
  const direct = await tryUrl(reg.url).catch((e) => { if (!reg.pageUrl) throw e; return null })
  if (direct) return direct
  if (reg.pageUrl) { const viaPage = await tryUrl(reg.pageUrl); if (viaPage) return viaPage }
  throw new Error('Couldn’t find the register file on the council’s site. The link may have changed: update it on the Council schemes page.')
}

async function textOf(file: { buf: Buffer; kind: string }): Promise<{ text: string; pages: number }> {
  if (file.kind === 'pdf') {
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(file.buf))
    const parts: string[] = []
    for (let i = 1; i <= Math.min(pdf.numPages, 2500); i++) {
      const page = await pdf.getPage(i)
      const c = await page.getTextContent()
      // Keep each table row on its own line, so an address and its licence details stay together.
      let line = '', lastY: number | null = null
      for (const it of c.items as { str: string; transform: number[] }[]) {
        const y = Math.round(it.transform[5])
        if (lastY != null && Math.abs(y - lastY) > 2) { parts.push(line.trim()); line = '' }
        line += `${it.str} `; lastY = y
      }
      if (line.trim()) parts.push(line.trim())
      page.cleanup()
    }
    const pages = pdf.numPages
    await pdf.destroy()
    return { text: parts.join('\n'), pages }
  }
  if (file.kind === 'xlsx') {
    const { readXlsxSheets } = await import('./xlsx')
    return { text: readXlsxSheets(file.buf).flatMap((s) => s.rows.map((r) => r.join(' | '))).join('\n'), pages: 1 }
  }
  return { text: file.buf.toString('utf8').replace(/,/g, ' | '), pages: 1 }
}

// Licence references as councils write them: HMOL/20871, SL/60110, HAR/SL/1001, 2024/00123/SEL…
const REF = /\b([A-Z]{1,6}(?:[/-][A-Z]{1,6}){0,2}[/-]?\d{3,}(?:[/-][A-Z0-9]+)*|\d{2,4}\/\d{3,}\/[A-Z0-9]+)\b/i

/**
 * The register line for a property: by its address (as typed, or as worked out from a shortened one), checked
 * against the flat number; or, for registers that include postcodes, by postcode and house number, which finds
 * a property whatever the spelling.
 */
function rowFor(r: { id: string; address: string; resolvedAddress: string | null; postcode: string | null }, normLines: string[], compactLines: string[]): number {
  const flatOk = (k: AddressKey, i: number) => !k.flat || new RegExp(`\\b(flat|apartment|apt|unit)\\s+${k.flat}\\b`).test(normLines[i])
  for (const a of [r.resolvedAddress, r.address]) {
    const k = a ? addressKey(r.id, a, r.postcode) : null
    if (!k) continue
    const pc = k.postcode
    for (let i = 0; i < normLines.length; i++) {
      if (!normLines[i].includes(k.key) || !flatOk(k, i)) continue
      // When the line has a postcode, it must be ours (stops "12 Church Road" matching another Church Road).
      const linePc = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(normLines[i].toUpperCase())
      if (pc && linePc && `${linePc[1]}${linePc[2]}`.toUpperCase() !== pc) continue
      return i
    }
  }
  const pc = r.postcode?.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const num = /\b(\d+[a-z]?)\b/i.exec(normText(r.resolvedAddress ?? r.address).replace(/\b(flat|apartment|apt|unit)\s+\w+/, ' '))?.[1]
  const k = addressKey(r.id, r.resolvedAddress ?? r.address, r.postcode)
  if (pc && num) {
    for (let i = 0; i < compactLines.length; i++) {
      if (!compactLines[i].includes(pc)) continue
      if (!new RegExp(`(^|\\s)${num}(\\s|$)`, 'i').test(normLines[i])) continue
      if (k && !flatOk(k, i)) continue
      return i
    }
  }
  return -1
}

/** What the register's row for a property says: reference, kind of licence and dates. */
function readRow(row: string): Pick<Found, 'number' | 'licenceKind' | 'startsOn' | 'expiresOn'> {
  const dates = datesIn(row).map((d) => d.iso)
  const sorted = [...dates].sort()
  return {
    number: REF.exec(row)?.[1]?.toUpperCase() ?? null,
    licenceKind: /mandatory/i.test(row) ? 'mandatory_hmo' : /additional/i.test(row) ? 'additional_hmo' : /hmo/i.test(row) && !/selective/i.test(row) ? 'additional_hmo' : /selective/i.test(row) ? 'selective' : null,
    startsOn: sorted.length >= 2 ? sorted[0] : null,
    expiresOn: sorted.length >= 2 ? sorted[sorted.length - 1] : sorted.length === 1 && dates[0] > new Date().toISOString().slice(0, 10) ? dates[0] : null,
  }
}

async function claim(force: boolean): Promise<boolean> {
  const t = new Date().toISOString(), before = new Date(Date.now() - (force ? 60_000 : 6 * 86400_000)).toISOString()
  const r = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('council_registers', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [t, before] })
  return r.rowsAffected === 1
}

/** Downloads each council's register (weekly, or now when asked) and checks every property in that council. */
export async function checkRegisters(opts: { force?: boolean } = {}): Promise<{ ran: boolean; results?: { name: string; ok: boolean; found?: number; of?: number; error?: string }[] }> {
  await ready()
  if (!(await claim(!!opts.force))) return { ran: false }
  const results: { name: string; ok: boolean; found?: number; of?: number; error?: string }[] = []
  for (const reg of (await registers()).filter((r) => r.enabled)) {
    try {
      const file = await download(reg)
      const { text } = await textOf(file)
      if (text.length < 200) throw new Error('The register file had no readable text (it may be a scanned image).')
      const asOf = /\b(?:created|produced|report date|as at|as of|correct (?:at|as of))\b[^0-9]{0,30}(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[- ][A-Za-z]{3,9}[- ]\d{2,4})/i.exec(text)?.[1] ?? null
      // Keep a copy of the register itself, so staff can open exactly what was checked.
      const key = `registers/${reg.id}/${new Date().toISOString().slice(0, 10)}.${file.kind}`
      const dest = localPath(key)
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, file.buf)
      const docId = uid()
      await db.insert(emailDocs).values({ id: docId, folder: 'Council register', uid: Date.now() % 2_000_000_000, messageId: null, subject: `${reg.name}${asOf ? ` (as of ${asOf})` : ''}`, fromAddr: new URL(file.url).hostname, sentAt: now(), kinds: 'licence', files: null, text: '', createdAt: now() })
      if (file.kind === 'pdf') await db.insert(emailFiles).values({ id: uid(), docId, filename: `${reg.name}.pdf`, storageKey: key, size: file.buf.length, createdAt: now() })

      const rs = await db.select().from(rentals).where(and(eq(rentals.archived, false), eq(rentals.council, reg.council)))
      const lines = text.split('\n')
      const normLines = lines.map((l) => normText(l))
      const compactLines = lines.map((l) => l.toUpperCase().replace(/[^A-Z0-9]/g, ''))
      let found = 0
      for (const r of rs) {
        let hit: { line: string; f: ReturnType<typeof readRow> } | null = null
        const li = rowFor(r, normLines, compactLines)
        if (li >= 0) {
          // A row that wraps onto the next line: take that line too, but only when this one has no dates of its own.
          const line = (datesIn(lines[li]).length >= 1 || !lines[li + 1] ? lines[li] : `${lines[li]} ${lines[li + 1]}`).slice(0, 600)
          const f = readRow(line)
          // Rows on a register of one kind (e.g. Harrow's selective register) often don't say the kind.
          if (!f.licenceKind) f.licenceKind = /hmo/i.test(reg.name) ? 'additional_hmo' : /selective/i.test(reg.name) ? 'selective' : null
          hit = { line, f }
        }
        if (hit) found++
        await db.insert(registerHits).values({ rentalId: r.id, registerId: reg.id, found: !!hit, reference: hit?.f.number ?? null, kind: hit?.f.licenceKind ?? null, startsOn: hit?.f.startsOn ?? null, expiresOn: hit?.f.expiresOn ?? null, line: hit?.line ?? null, checkedAt: now() })
          .onConflictDoUpdate({ target: [registerHits.rentalId, registerHits.registerId], set: { found: !!hit, reference: hit?.f.number ?? null, kind: hit?.f.licenceKind ?? null, startsOn: hit?.f.startsOn ?? null, expiresOn: hit?.f.expiresOn ?? null, line: hit?.line ?? null, checkedAt: now() } })
        // Anything the register adds to what we hold becomes a suggestion, like the ones from emails.
        if (hit && (hit.f.number || hit.f.expiresOn)) {
          const mine = await db.select().from(licences).where(eq(licences.rentalId, r.id))
          const known = mine.some((l) => (hit!.f.number && l.number?.toUpperCase() === hit!.f.number) && (!hit!.f.expiresOn || l.expiresOn === hit!.f.expiresOn))
          if (!known) {
            const f: Found = { kind: 'licence', number: hit.f.number, licenceKind: hit.f.licenceKind ?? 'selective', council: reg.council === 'brent' || reg.council === 'harrow' ? reg.council : null, status: 'granted', startsOn: hit.f.startsOn, expiresOn: hit.f.expiresOn, confidence: hit.f.number && hit.f.expiresOn ? 'high' : 'medium', how: `Listed on the ${reg.name}${asOf ? ` as of ${asOf}` : ''}` }
            await db.insert(licenceSuggestions).values({ id: uid(), rentalId: r.id, docId, kind: 'licence', found: JSON.stringify(f), confidence: f.confidence, createdAt: now() }).onConflictDoNothing()
          }
        }
      }
      await db.update(councilRegisters).set({ lastFetchedAt: now(), lastOkAt: now(), lastError: null, asOf, entries: lines.length, fileKey: key, docId, url: reg.url, updatedAt: now() }).where(eq(councilRegisters.id, reg.id))
      results.push({ name: reg.name, ok: true, found, of: rs.length })
    } catch (e) {
      const error = (e as Error).message.slice(0, 300)
      await db.update(councilRegisters).set({ lastFetchedAt: now(), lastError: error, updatedAt: now() }).where(eq(councilRegisters.id, reg.id))
      results.push({ name: reg.name, ok: false, error })
    }
  }
  return { ran: true, results }
}

/** What each register said about a property at the last check. */
export async function hitsFor(rentalIds: string[]) {
  await ready()
  if (!rentalIds.length) return []
  return db.select({ h: registerHits, r: councilRegisters }).from(registerHits).innerJoin(councilRegisters, eq(councilRegisters.id, registerHits.registerId)).where(inArray(registerHits.rentalId, rentalIds))
}
