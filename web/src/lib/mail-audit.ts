import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { settings } from '@/db/schema'
import { openSavedMailbox } from '@/lib/mailbox'
import { now } from '@/lib/util'

// A one-off look across the whole mailbox: what kinds of email arrive, from whom, how many each month,
// and how quickly we reply. Reads only the envelope (sender, subject, date) and the first part of each
// email; nothing is changed in the mailbox and no email is stored, only the totals and a few subjects.

const KEY = 'mail_audit'
const MAX_PER_FOLDER = 40_000

export type Category = { id: string; label: string; hint: string }
export const CATEGORIES: Category[] = [
  { id: 'leads', label: 'Portal and website leads', hint: 'Zoopla, OnTheMarket, Rightmove, website forms' },
  { id: 'viewings', label: 'Viewings, offers and valuations', hint: 'Booking and feedback, offers, valuation requests' },
  { id: 'sales', label: 'Sales progression', hint: 'Solicitors, memorandums of sale, mortgages, surveys, searches, exchange and completion' },
  { id: 'repairs', label: 'Repairs and maintenance', hint: 'Tenants reporting problems, contractors, quotes for work' },
  { id: 'rent', label: 'Rent and arrears', hint: 'Rent payments, late rent, statements' },
  { id: 'tenancy', label: 'Tenancies and moves', hint: 'Agreements, renewals, notices, referencing, deposits, check-in and check-out' },
  { id: 'compliance', label: 'Safety certificates and licences', hint: 'Gas safety, EICR, EPC, alarms, HMO and council licences' },
  { id: 'landlords', label: 'Landlords', hint: 'Landlord updates, statements and instructions' },
  { id: 'accounts', label: 'Invoices, bills and banking', hint: 'Suppliers, invoices, receipts, bank and HMRC' },
  { id: 'official', label: 'Council, ombudsman and memberships', hint: 'Councils, gov.uk, TPO, PRS, safeagent, myDeposits' },
  { id: 'people', label: 'Other emails from people and businesses', hint: 'Real senders that didn’t fit a category above' },
  { id: 'automated', label: 'Newsletters and automated', hint: 'Marketing, notifications, no-reply senders' },
  { id: 'internal', label: 'From our own address', hint: 'Sent from @prestonhillestates' },
]

type Rule = { cat: string; from?: RegExp; text?: RegExp }
// First strong match wins; subject matches count double compared with the body.
// Matched against the sender's domain only (after the @), so a name like "someone" can't match "eon".
const RULES: Rule[] = [
  { cat: 'leads', from: /(^|\.)(zoopla|onthemarket|rightmove|primelocation|wix|wixforms|squarespace|jotform|typeform|openrent)\./ },
  { cat: 'official', from: /\.gov\.uk$|(^|\.)(tpos|theprs|safeagents?|mydeposits|depositprotection|tenancydepositscheme|propertymark|naea|arla)\.|council/ },
  { cat: 'accounts', from: /(^|\.)(hmrc|xero|quickbooks|intuit|sage|barclays|hsbc|natwest|lloydsbank|lloyds|santander|metrobank|tide|starlingbank|paypal|stripe|gocardless|amazon|vodafone|bt|o2|britishgas|octopus|edfenergy|eonnext|eonenergy|thameswater|affinitywater)\./ },
  { cat: 'tenancy', from: /(^|\.)(goodlord|homelet|vouch|letalliance|canopy|zerodeposit|reposit|inventorybase|nolettinggo)\./ },
]
const KEYWORDS: [string, RegExp][] = [
  ['repairs', /\b(repair|leak(ing)?|boiler|broken|damp|mou?ld|heating|hot water|plumb(er|ing)|electrician|contractor|maintenance|not working|blocked|pest|mice|rats|lock(ed)? out|window|roof|quote for (the )?works?|fault|tap|toilet|shower|washing machine|fridge|oven)\b/],
  ['rent', /\b(rent( is)? (due|late|overdue)|arrears|rent payment|standing order|rent statement|missed payment|payment reminder|outstanding (balance|rent)|rent increase)\b/],
  ['tenancy', /\b(tenancy agreement|renewal|renew(ing)? (the )?tenancy|section 21|section 8|notice to quit|move[- ]in|move[- ]out|check[- ](in|out)|inventory|referenc(e|ing)|guarantor|right to rent|deposit (return|protection|deduction)|end of tenancy|break clause)\b/],
  ['compliance', /\b(gas safety|cp12|eicr|electrical (installation|safety|certificate)|epc|energy performance|smoke alarm|carbon monoxide|fire (alarm|risk)|legionella|hmo|selective licen[cs]|additional licen[cs]|property licen[cs]|pat test)\b/],
  ['sales', /\b(solicitor|conveyanc|memorandum of sale|memo of sale|sales memo|mortgage (offer|valuation|in principle)|survey(or)?|searches|enquiries raised|ta6|ta10|draft contract|exchange(d)? (of )?contracts?|completion|completed|chain|aml|anti[- ]money|proof of funds|lender|title deeds?|leasehold pack|management pack)\b/],
  ['viewings', /\b(viewing|book(ed)? a view|offer (of|on|accepted|rejected)|(make|made) an offer|valuation|market appraisal|open house|second viewing|feedback)\b/],
  ['landlords', /\b(landlord|management fee|landlord statement|your property at|let only|fully managed|rent collection)\b/],
  ['accounts', /\b(invoice|receipt|bill|vat|payment received|remittance|direct debit|bank transfer|statement of account|quote\b|quotation)\b/],
]
export const PERSONAL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet|sky|virginmedia|ntlworld|talktalk|msn)\./
const OWN = /@prestonhillestates\.(com|co\.uk)$/
export const NO_REPLY = /no-?reply|do-?not-?reply|notifications?@|mailer|bounce|newsletter|marketing|info@.*(news|mail)/

export function classify(from: string, subject: string, body: string, bulk: boolean): string {
  const f = from.toLowerCase()
  if (OWN.test(f)) return 'internal'
  const domain = f.split('@')[1] ?? ''
  for (const r of RULES) if (r.from && r.from.test(domain)) return r.cat
  const subj = subject.toLowerCase(), text = body.toLowerCase()
  let best = '', score = 0
  for (const [cat, re] of KEYWORDS) {
    const s = (re.test(subj) ? 2 : 0) + (re.test(text) ? 1 : 0)
    if (s > score) { best = cat; score = s }
  }
  if (bulk || NO_REPLY.test(f)) return score >= 2 ? best : 'automated'
  return best || 'people'
}

export type AuditResult = {
  months: number; from: string; to: string; mailbox: string
  inbox: number; sent: number
  byCategory: Record<string, { n: number; people: number; replied: number; months: Record<string, number>; samples: string[] }>
  topDomains: { domain: string; n: number; cat: string }[]
  byWeekday: number[]; byHour: number[]
  replyHoursMedian: number | null; repliedShare: number | null
}
export type AuditState = { status: 'idle' | 'running' | 'done' | 'error'; startedAt?: string; finishedAt?: string; done?: number; total?: number; error?: string; result?: AuditResult }

async function save(s: AuditState) {
  await db.insert(settings).values({ key: KEY, value: JSON.stringify(s), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(s), updatedAt: now() } })
}

export async function auditState(): Promise<AuditState> {
  await ready()
  const row = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  if (!row) return { status: 'idle' }
  try {
    const s = JSON.parse(row.value) as AuditState
    // A run that stopped reporting (e.g. the server restarted) shouldn't look busy forever.
    if (s.status === 'running' && Date.now() - new Date(row.updatedAt).getTime() > 10 * 60_000) return { ...s, status: 'error', error: 'The audit stopped part-way, probably because the portal restarted. Run it again.' }
    return s
  } catch { return { status: 'idle' } }
}

const textOf = (b?: Buffer) => (b ? b.toString('latin1').replace(/=\r?\n/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').slice(0, 2500) : '')
const domainOf = (addr: string) => addr.split('@')[1]?.toLowerCase() ?? ''

/** Marks the audit as started straight away, so the page shows progress before the work begins. */
export async function markAuditStarting() {
  await ready()
  await save({ status: 'running', startedAt: now(), done: 0, total: 0 })
}

/** Runs the audit over the last `months` months. Takes a few minutes for a busy mailbox; progress is saved as it goes. */
export async function runAudit(months: number) {
  await ready()
  const since = new Date(); since.setMonth(since.getMonth() - months)
  const state: AuditState = { status: 'running', startedAt: now(), done: 0, total: 0 }
  await save(state)
  let c: Awaited<ReturnType<typeof openSavedMailbox>> | null = null
  try {
    c = await openSavedMailbox()
    const boxes = await c.list()
    const sentBox = boxes.find((b) => b.specialUse === '\\Sent') ?? boxes.find((b) => /^(sent|sent items|sent messages)$/i.test(b.name))
    const byCategory: AuditResult['byCategory'] = Object.fromEntries(CATEGORIES.map((k) => [k.id, { n: 0, people: 0, replied: 0, months: {}, samples: [] }]))
    const domains = new Map<string, { n: number; cats: Map<string, number> }>()
    const byWeekday = Array(7).fill(0), byHour = Array(24).fill(0)
    const inboxById = new Map<string, { cat: string; at: number }>()
    const seenShapes = new Set<string>()

    // Inbox
    await c.mailboxOpen('INBOX', { readOnly: true })
    const uids = (((await c.search({ since }, { uid: true })) || []) as number[]).slice(-MAX_PER_FOLDER)
    state.total = uids.length
    for (let i = 0; i < uids.length; i += 400) {
      const chunk = uids.slice(i, i + 400)
      for await (const m of c.fetch(chunk.join(','), { uid: true, envelope: true, headers: ['list-unsubscribe', 'precedence', 'auto-submitted'], bodyParts: [{ key: 'TEXT', maxLength: 2500 }] }, { uid: true })) {
        const env = m.envelope
        const from = (env?.from?.[0]?.address ?? '').toLowerCase()
        const subject = env?.subject ?? ''
        const hdr = m.headers?.toString('latin1').toLowerCase() ?? ''
        const bulk = /list-unsubscribe|precedence:\s*(bulk|list|junk)|auto-submitted:\s*auto-/.test(hdr)
        const cat = classify(from, subject, textOf(m.bodyParts?.get('TEXT') ?? m.bodyParts?.get('text')), bulk)
        const at = env?.date ? new Date(env.date) : new Date()
        const b = byCategory[cat]
        b.n++
        if (PERSONAL.test(from)) b.people++
        const month = at.toISOString().slice(0, 7)
        b.months[month] = (b.months[month] ?? 0) + 1
        // Distinct examples only: "Boiler not working at 78 Kenton Road" and "...at 110..." count as one.
        const shape = subject.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
        if (b.samples.length < 12 && subject && !/^(re|fw|fwd):/i.test(subject) && !seenShapes.has(shape)) { seenShapes.add(shape); b.samples.push(subject.slice(0, 110)) }
        const d = PERSONAL.test(from) ? 'people (personal addresses)' : domainOf(from)
        if (d) { const x = domains.get(d) ?? { n: 0, cats: new Map() }; x.n++; x.cats.set(cat, (x.cats.get(cat) ?? 0) + 1); domains.set(d, x) }
        byWeekday[at.getDay()]++; byHour[Number(at.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/London' })) % 24]++
        if (env?.messageId) inboxById.set(env.messageId, { cat, at: at.getTime() })
      }
      state.done = Math.min(uids.length, i + 400)
      await save(state)
    }

    // Sent: which emails got a reply, and how fast
    let sent = 0
    const delays: number[] = []
    if (sentBox) {
      await c.mailboxOpen(sentBox.path, { readOnly: true })
      const sUids = (((await c.search({ since }, { uid: true })) || []) as number[]).slice(-MAX_PER_FOLDER)
      const repliedTo = new Set<string>()
      for (let i = 0; i < sUids.length; i += 800) {
        for await (const m of c.fetch(sUids.slice(i, i + 800).join(','), { uid: true, envelope: true }, { uid: true })) {
          sent++
          const r = m.envelope?.inReplyTo
          const orig = r ? inboxById.get(r) : undefined
          if (r && orig && !repliedTo.has(r)) {
            repliedTo.add(r)
            byCategory[orig.cat].replied++
            const t = m.envelope?.date ? new Date(m.envelope.date).getTime() : 0
            if (t > orig.at) delays.push((t - orig.at) / 3600000)
          }
        }
      }
    }
    await c.logout().catch(() => c?.close())
    delays.sort((a, b) => a - b)
    const answerable = CATEGORIES.filter((k) => !['automated', 'internal', 'leads'].includes(k.id)).reduce((t, k) => t + byCategory[k.id].n, 0)
    const repliedTotal = CATEGORIES.filter((k) => !['automated', 'internal', 'leads'].includes(k.id)).reduce((t, k) => t + byCategory[k.id].replied, 0)
    const result: AuditResult = {
      months, from: since.toISOString(), to: now(), mailbox: 'INBOX', inbox: uids.length, sent,
      byCategory,
      topDomains: [...domains.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)
        .map(([domain, x]) => ({ domain, n: x.n, cat: [...x.cats.entries()].sort((a, b) => b[1] - a[1])[0][0] })),
      byWeekday, byHour,
      replyHoursMedian: delays.length ? Math.round(delays[Math.floor(delays.length / 2)] * 10) / 10 : null,
      repliedShare: sentBox && answerable ? Math.round((repliedTotal / answerable) * 100) : null,
    }
    await save({ status: 'done', startedAt: state.startedAt, finishedAt: now(), done: uids.length, total: uids.length, result })
  } catch (e) {
    await c?.logout().catch(() => c?.close())
    await save({ ...state, status: 'error', error: e instanceof Error ? e.message.slice(0, 200) : 'The audit failed.' })
  }
}

/** A summary safe to share: categories, monthly totals and sender domains, without names, addresses or subjects. */
export function auditCsv(r: AuditResult): string {
  const monthsList = [...new Set(Object.values(r.byCategory).flatMap((b) => Object.keys(b.months)))].sort()
  const rows = [['Category', 'Emails', 'From personal addresses', 'We replied', ...monthsList]]
  for (const k of CATEGORIES) {
    const b = r.byCategory[k.id]
    rows.push([k.label, String(b.n), String(b.people), String(b.replied), ...monthsList.map((m) => String(b.months[m] ?? 0))])
  }
  rows.push([], ['Sender domain', 'Emails', 'Mostly'])
  for (const d of r.topDomains) rows.push([d.domain, String(d.n), CATEGORIES.find((k) => k.id === d.cat)?.label ?? d.cat])
  rows.push([], ['Inbox emails', String(r.inbox)], ['Sent emails', String(r.sent)], ['Median reply time (hours)', String(r.replyHoursMedian ?? '')], ['Share replied (excluding leads/automated)', r.repliedShare == null ? '' : `${r.repliedShare}%`])
  return rows.map((row) => row.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n')
}
