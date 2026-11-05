import 'server-only'
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { admins, licenceReminders, licences, licensingSchemes, notifications, postcodeWards, rentals, type LicenceRow, type Rental } from '@/db/schema'
import { assess, councilLabel, dueReminders, fmtDay, isoDay, SEED_SCHEMES, type Assessment, type Council, type Licence, type Occupancy, type Scheme } from './licensing-rules'
import { bulkSender } from './mailbox'
import { sendMail } from './mailer'
import { knownBase } from './property-email-data'
import { now, uid } from './util'

// ---------- schemes ----------

export async function loadSchemes(): Promise<Scheme[]> {
  await ready()
  let rows = await db.select().from(licensingSchemes).orderBy(asc(licensingSchemes.council), asc(licensingSchemes.startsOn))
  if (!rows.length) {
    await db.insert(licensingSchemes).values(SEED_SCHEMES.map((s) => ({ ...s, id: uid(), wards: JSON.stringify(s.wards), updatedAt: now() })))
    rows = await db.select().from(licensingSchemes).orderBy(asc(licensingSchemes.council), asc(licensingSchemes.startsOn))
  }
  return rows.map((r) => ({ ...r, council: r.council as Council, kind: r.kind as Scheme['kind'], wards: safeList(r.wards) }))
}
const safeList = (s: string) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : [] } catch { return [] } }

// ---------- council and ward from the postcode ----------

export const fmtPostcode = (raw: string | null | undefined) => {
  const c = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(c) ? `${c.slice(0, -3)} ${c.slice(-3)}` : null
}
const COUNCIL_CODES: Record<string, Council> = { E09000005: 'brent', E09000015: 'harrow' }
const API = () => (process.env.POSTCODES_IO_URL || 'https://api.postcodes.io').replace(/\/$/, '')

/** Council and ward for a postcode, from postcodes.io (cached). Null when the look-up isn't possible right now. */
export async function areaFor(postcode: string): Promise<{ council: Council; district: string | null; ward: string | null } | null> {
  const pc = fmtPostcode(postcode)
  if (!pc) return null
  await ready()
  let row = await db.query.postcodeWards.findFirst({ where: eq(postcodeWards.postcode, pc) })
  if (!row) {
    try {
      const res = await fetch(`${API()}/postcodes/${encodeURIComponent(pc)}`, { signal: AbortSignal.timeout(5000) })
      if (res.status === 404) {
        // Terminated postcodes (common in older addresses) are still known to postcodes.io under /terminated_postcodes, without a ward.
        return null
      }
      if (!res.ok) return null
      const j = (await res.json()) as { result?: { admin_district?: string; admin_ward?: string; codes?: { admin_district?: string; admin_ward?: string } } }
      const r = j.result
      if (!r) return null
      row = { postcode: pc, district: r.admin_district ?? null, districtCode: r.codes?.admin_district ?? null, ward: r.admin_ward ?? null, wardCode: r.codes?.admin_ward ?? null, fetchedAt: now() }
      await db.insert(postcodeWards).values(row).onConflictDoNothing()
    } catch { return null }
  }
  // Brent and Harrow by their ONS codes; any other council by its name (e.g. 'ealing').
  const council = COUNCIL_CODES[row.districtCode ?? ''] ?? (row.district ? row.district.toLowerCase() : 'other')
  return { council, district: row.district, ward: row.ward }
}

/** Looks up many postcodes at once (postcodes.io takes 100 per request) and caches them. */
async function cacheAreas(pcs: string[]) {
  const have = new Set((pcs.length ? await db.select({ p: postcodeWards.postcode }).from(postcodeWards).where(inArray(postcodeWards.postcode, pcs)) : []).map((r) => r.p))
  const want = [...new Set(pcs)].filter((p) => !have.has(p))
  for (let i = 0; i < want.length; i += 100) {
    try {
      const res = await fetch(`${API()}/postcodes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: want.slice(i, i + 100) }), signal: AbortSignal.timeout(15000) })
      if (!res.ok) return
      const j = (await res.json()) as { result?: { query: string; result: { admin_district?: string; admin_ward?: string; codes?: { admin_district?: string; admin_ward?: string } } | null }[] }
      const rows = (j.result ?? []).filter((x) => x.result).map((x) => ({ postcode: fmtPostcode(x.query)!, district: x.result!.admin_district ?? null, districtCode: x.result!.codes?.admin_district ?? null, ward: x.result!.admin_ward ?? null, wardCode: x.result!.codes?.admin_ward ?? null, fetchedAt: now() }))
      if (rows.length) await db.insert(postcodeWards).values(rows).onConflictDoNothing()
    } catch { return }
  }
}

/**
 * Postcodes for rentals that don't have one: the Land Registry address list first (instant, matches
 * shortened and misspelt streets), then a map look-up for the rest (one a second). Each is labelled with how
 * it was found, for staff to check. Failed ones are tried again after a week.
 */
export async function fillPostcodes(opts: { seconds?: number; online?: boolean } = {}): Promise<{ found: number; tried: number }> {
  await ready()
  const { guessPostcode } = await import('./address-match')
  const { geocodePostcode } = await import('./geocode')
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const todo = (await db.select().from(rentals).where(and(eq(rentals.archived, false), isNull(rentals.postcode)))).filter((r) => !r.postcodeTriedAt || r.postcodeTriedAt < weekAgo)
  const started = Date.now()
  let found = 0, tried = 0
  for (const r of todo) {
    if (Date.now() - started > (opts.seconds ?? 60) * 1000) break
    tried++
    const council = r.council && r.council !== 'other' ? r.council : null
    let pc: string | null = null, source = '', note = '', resolved: string | null = null
    const g = await guessPostcode(r.address, council, { wait: true }).catch(() => null)
    if (g) { pc = g.postcode; source = 'land_registry'; note = `Found from the ${g.how}`; resolved = g.resolved }
    else if (opts.online !== false) {
      const o = await geocodePostcode(r.address, council)
      if (o) { pc = o.postcode; source = 'online'; note = `Found by ${o.how}`; resolved = o.resolved }
    }
    if (pc) {
      found++
      await db.update(rentals).set({ postcode: pc, postcodeSource: source, postcodeNote: note, resolvedAddress: resolved, postcodeTriedAt: now(), updatedAt: now() }).where(eq(rentals.id, r.id))
      await refreshArea({ ...r, postcode: pc }).catch(() => false)
    } else await db.update(rentals).set({ postcodeTriedAt: now(), postcodeNote: 'Postcode not found automatically: add it by hand' }).where(eq(rentals.id, r.id))
  }
  return { found, tried }
}

/** Council and ward for every rental that's missing them (unless chosen by hand). */
export async function fillAreas(limit = 200): Promise<number> {
  await ready()
  const missing = await db.select().from(rentals).where(and(eq(rentals.archived, false), or(isNull(rentals.ward), isNull(rentals.council)), sql`${rentals.postcode} is not null`, or(isNull(rentals.wardSource), eq(rentals.wardSource, 'auto')))).limit(limit)
  await cacheAreas(missing.map((r) => fmtPostcode(r.postcode)).filter(Boolean) as string[])
  let n = 0
  for (const r of missing) if (await refreshArea(r).catch(() => false)) n++
  return n
}

/** Fills in council and ward for a rental from its postcode, unless staff chose them by hand. */
export async function refreshArea(r: Rental): Promise<boolean> {
  if (r.wardSource === 'manual' || !r.postcode) return false
  const a = await areaFor(r.postcode)
  if (!a) return false
  if (a.council === r.council && a.ward === r.ward && r.wardSource === 'auto') return false
  await db.update(rentals).set({ council: a.council, ward: a.ward, wardSource: 'auto', updatedAt: now() }).where(eq(rentals.id, r.id))
  return true
}

// ---------- the register ----------

const toLicence = (l: LicenceRow): Licence => ({ id: l.id, kind: l.kind as Licence['kind'], council: l.council, number: l.number, status: l.status as Licence['status'], appliedOn: l.appliedOn, startsOn: l.startsOn, expiresOn: l.expiresOn })
export const factsOf = (r: Rental) => ({
  council: (r.council as Council | null) ?? null, ward: r.ward, occupancy: (r.occupancy as Occupancy) ?? 'single', noLicenceNeeded: r.noLicenceNeeded,
  gasExpires: r.gasExpires, eicrExpires: r.eicrExpires, epcExpires: r.epcExpires, epcRating: r.epcRating,
})

export type RentalView = Rental & { licences: LicenceRow[]; a: Assessment }

export async function rentalRegister(opts: { archived?: boolean } = {}): Promise<{ rows: RentalView[]; schemes: Scheme[] }> {
  await ready()
  const [schemes, rs, ls] = await Promise.all([
    loadSchemes(),
    db.select().from(rentals).where(eq(rentals.archived, !!opts.archived)).orderBy(asc(rentals.address)),
    db.select().from(licences),
  ])
  const by = new Map<string, LicenceRow[]>()
  for (const l of ls) by.set(l.rentalId, [...(by.get(l.rentalId) ?? []), l])
  const today = isoDay(new Date())
  const rows = rs.map((r) => {
    const mine = (by.get(r.id) ?? []).sort((a, b) => (b.expiresOn ?? b.appliedOn ?? '').localeCompare(a.expiresOn ?? a.appliedOn ?? ''))
    return { ...r, licences: mine, a: assess(factsOf(r), mine.map(toLicence), schemes, today) }
  })
  rows.sort((x, y) => x.a.urgency - y.a.urgency)
  return { rows, schemes }
}

export async function rentalView(id: string): Promise<{ row: RentalView; schemes: Scheme[] } | null> {
  await ready()
  const r = await db.query.rentals.findFirst({ where: eq(rentals.id, id) })
  if (!r) return null
  const [schemes, ls] = await Promise.all([loadSchemes(), db.select().from(licences).where(eq(licences.rentalId, id))])
  ls.sort((a, b) => (b.expiresOn ?? b.appliedOn ?? '').localeCompare(a.expiresOn ?? a.appliedOn ?? ''))
  return { row: { ...r, licences: ls, a: assess(factsOf(r), ls.map(toLicence), schemes) }, schemes }
}

/** Counts for the dashboard card and the menu badge. */
export async function licensingCounts() {
  const { rows } = await rentalRegister()
  const n = (b: string[]) => rows.filter((r) => b.includes(r.a.bucket)).length
  return {
    total: rows.length,
    urgent: n(['unlicensed', 'expired', 'due30']),
    soon: n(['due90', 'upcoming']),
    certs: rows.filter((r) => r.a.certs.some((c) => c.state === 'expired' || c.state === 'due30')).length,
  }
}

// ---------- the scheduled check ----------

async function claim(): Promise<boolean> {
  const t = new Date().toISOString(), before = new Date(Date.now() - 3 * 3600_000).toISOString()
  const r = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('licensing', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [t, before] })
  return r.rowsAffected === 1
}

/**
 * Every few hours: fill in any missing wards, then send each reminder that has come due (90, 60, 30, 14, 7 and 1
 * days before a licence ends, weekly while a property is unlicensed or expired, and for gas, EICR and EPC dates)
 * as a pop-up in the portal and one summary email to the admins.
 */
export async function runLicensingChecks(opts: { force?: boolean } = {}): Promise<{ ran: boolean; reminders?: number; areas?: number }> {
  await ready()
  if (!opts.force && !(await claim())) return { ran: false }
  await fillPostcodes({ seconds: 70 }).catch((e) => console.error('postcode finding failed', e))
  const areas = await fillAreas(200)

  const { rows } = await rentalRegister()
  const today = isoDay(new Date())
  const fresh: { rental: RentalView; title: string; body: string; urgent: boolean }[] = []
  for (const r of rows) {
    for (const d of dueReminders(r.a, { id: r.id, address: r.address }, today)) {
      const ins = await db.insert(licenceReminders).values({ rentalId: r.id, key: d.key, sentAt: now() }).onConflictDoNothing()
      if (ins.rowsAffected === 1) fresh.push({ rental: r, ...d })
    }
  }
  if (!fresh.length) return { ran: true, reminders: 0, areas }

  // Pop-ups for everyone in the office.
  for (const f of fresh.slice(0, 40)) {
    await db.insert(notifications).values({ id: uid(), kind: 'licence', appointmentId: null, taskId: null, targetAdminId: null, title: f.title, body: `${f.body}\n/admin/licensing/${f.rental.id}`, createdBy: null, createdAt: now() })
  }
  // One summary email to the admins.
  const base = await knownBase()
  const portalUrl = (p: string) => `${base}${p}`
  const to = (await db.select({ email: admins.email }).from(admins).where(eq(admins.role, 'admin'))).map((a) => a.email).filter(Boolean)
  if (to.length) {
    const urgent = fresh.filter((f) => f.urgent)
    const subject = `Licensing: ${urgent.length ? `${urgent.length} need action now` : `${fresh.length} coming up`}`
    const line = (f: (typeof fresh)[number]) => `<tr><td style="padding:10px 0;border-top:1px solid #E7E3D6;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#23211A;"><b>${esc(f.title)}</b><br/><span style="color:#59554A;">${esc(f.body)}</span><br/><a href="${portalUrl(`/admin/licensing/${f.rental.id}`)}" style="color:#A47B1D;">Open in the portal</a></td></tr>`
    const html = `<div style="background:#F1EFE8;padding:24px;"><table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#fff;border-radius:14px;padding:24px;"><tr><td style="font-family:Georgia,serif;font-size:24px;color:#23211A;padding-bottom:6px;">Licensing reminders</td></tr>
<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#59554A;padding-bottom:10px;">${fresh.length} reminder${fresh.length === 1 ? '' : 's'} from the portal on ${fmtDay(today)}.</td></tr>
${[...urgent, ...fresh.filter((f) => !f.urgent)].map(line).join('')}
<tr><td style="padding-top:16px;"><a href="${portalUrl('/admin/licensing')}" style="display:inline-block;background:#C4972F;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:13px;">Open the licensing register</a></td></tr></table></div>`
    const text = [`Licensing reminders, ${fmtDay(today)}`, '', ...fresh.map((f) => `- ${f.title}\n  ${f.body}\n  ${portalUrl(`/admin/licensing/${f.rental.id}`)}`), '', portalUrl('/admin/licensing')].join('\n')
    const tx = await bulkSender()
    if ('error' in tx) await sendMail({ to, subject, text, html })
    else { try { for (const t of to) await tx.send({ to: t, subject, text, html }) } finally { tx.close() } }
  }
  return { ran: true, reminders: fresh.length, areas }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export { councilLabel }
