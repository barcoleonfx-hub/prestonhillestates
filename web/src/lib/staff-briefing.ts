import 'server-only'
import { and, asc, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, getClient, ready } from '@/db/client'
import { admins, agentActions as logActionTable, appointments, calls, contacts, enquiries, enquiryNotes, followupLog, leadEvents, mailMessages, mailThreads, properties, reportGuides, tasks } from '@/db/schema'
import { agentSettings } from './ai-usage'
import { logAction } from './agents'
import { askClaude } from './staff-briefing-ai'
import { junkThreads } from './mail-triage'
import { readyDrafts } from './night-drafts'
import { promisesDue } from './promises'
import { mailPaused, noteMailError } from './mail-health'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { knownBase } from './property-email-data'
import { DEFAULT_PEOPLE, briefingEmail, checkSnapshot, checkView, isFor, plainSnapshot, plainView, signedBy, snapshotEmail, statsOf, unquoted, waitingLine, type Briefing, type BriefingView, type Item, type Person, type Snapshot, type SnapshotView } from './staff-briefing-rules'
import { addDays, londonToIso, todayLondon } from './time'

// The 10am staff briefing: one email per person (Fred to his own address, the rest to info@), from the office
// mailbox (inbox and sent items) and the portal (calls, notes, WhatsApps, callbacks, visits, leads).

const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const short = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const who = (m: { fromName?: string | null; fromAddr?: string | null }) => m.fromName?.trim() || m.fromAddr || 'someone'
const dueDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export async function briefingPeople(): Promise<Person[]> {
  const cfg = await agentSettings()
  const saved = cfg.briefings
  if (!saved?.length) return DEFAULT_PEOPLE
  // Saved before the Director's snapshot: Jamil is the director, and his goes to his own address.
  if (!saved.some((p) => p.director)) return saved.map((p) => (/^jamil$/i.test(p.name) ? { ...p, director: true, to: p.to === 'info@prestonhillestates.com' ? 'jamil.preston@hotmail.com' : p.to } : p))
  return saved
}

/** Everything for one person's briefing, for the day before `today` (London). */
export async function buildBriefing(person: Person, today = todayLondon(), prefix = '', junk: Set<string> = new Set()): Promise<Briefing> {
  await ready()
  const day = addDays(today, -1)
  const from = londonToIso(day, '00:00')!, to = londonToIso(today, '00:00')!
  const endToday = londonToIso(addDays(today, 1), '00:00')!
  const base = await knownBase()
  const names = person.aliases.map((a) => a.toLowerCase())
  const staff = (await db.select({ id: admins.id, name: admins.name }).from(admins))
    .filter((a) => { const n = a.name.toLowerCase(); return names.some((x) => n === x || n.split(/\s+/).includes(x)) })
  const ids = staff.map((s) => s.id)
  const mine = (id: string | null | undefined) => !!id && ids.includes(id)
  const thread = (id: string) => `${base}/admin/mail/${id}`

  const [mailIn, mailOut] = await Promise.all([
    db.select().from(mailMessages).where(and(eq(mailMessages.direction, 'in'), gte(mailMessages.sentAt, from), lt(mailMessages.sentAt, to), eq(mailMessages.promo, false), ne(mailMessages.area, 'promo'))).orderBy(asc(mailMessages.sentAt)).limit(300),
    db.select().from(mailMessages).where(and(eq(mailMessages.direction, 'out'), gte(mailMessages.sentAt, from), lt(mailMessages.sentAt, to))).orderBy(asc(mailMessages.sentAt)).limit(300),
  ])
  let n = 0
  const ref = (p: string) => `${prefix}${p}${++n}`

  // What they sent: from the portal as them, or from Apple Mail signed with their name (not the agents' emails).
  const sent: Item[] = mailOut.filter((m) => mine(m.sentBy) || (m.via !== 'portal' && !m.sentBy && signedBy(m.body, person.aliases)))
    .map((m) => ({ ref: ref('S'), at: m.sentAt, title: `Emailed ${clip(m.toAddrs?.replace(/<[^>]*>/g, ''), 60) || 'someone'}: “${clip(m.subject, 70)}”`, detail: `${time(m.sentAt)} · ${clip(unquoted(m.body), 160)}`, href: thread(m.threadId) }))

  // What they did in the portal: calls, notes, WhatsApps, visit outcomes, follow-up calls.
  const [callRows, notes, was, visits, steps] = ids.length ? await Promise.all([
    db.select({ c: calls, name: contacts.name }).from(calls).leftJoin(contacts, eq(calls.contactId, contacts.id)).where(and(inArray(calls.createdBy, ids), gte(calls.createdAt, from), lt(calls.createdAt, to))),
    db.select({ n: enquiryNotes, name: enquiries.name }).from(enquiryNotes).leftJoin(enquiries, eq(enquiryNotes.enquiryId, enquiries.id)).where(and(inArray(enquiryNotes.createdBy, ids), gte(enquiryNotes.createdAt, from), lt(enquiryNotes.createdAt, to))),
    db.select({ ev: leadEvents, name: enquiries.name }).from(leadEvents).leftJoin(enquiries, eq(leadEvents.enquiryId, enquiries.id)).where(and(inArray(leadEvents.createdBy, ids), eq(leadEvents.kind, 'whatsapp'), gte(leadEvents.createdAt, from), lt(leadEvents.createdAt, to))),
    db.select().from(appointments).where(and(inArray(appointments.staffId, ids), gte(appointments.startsAt, from), lt(appointments.startsAt, to))),
    db.select({ l: followupLog, name: enquiries.name }).from(followupLog).leftJoin(enquiries, eq(followupLog.enquiryId, enquiries.id)).where(and(inArray(followupLog.createdBy, ids), eq(followupLog.channel, 'call'), gte(followupLog.createdAt, from), lt(followupLog.createdAt, to))),
  ]) : [[], [], [], [], []]
  const activity: Item[] = [
    ...callRows.map(({ c, name }) => ({ ref: ref('A'), at: c.createdAt, title: `${c.direction === 'out' ? 'Called' : 'Took a call from'} ${name ?? 'a contact'}`, detail: clip(c.notes, 160), href: `${base}/admin/contacts/${c.contactId}` })),
    ...steps.map(({ l, name }) => ({ ref: ref('A'), at: l.createdAt, title: `Follow-up call to ${name ?? 'a lead'}`, detail: clip(l.detail, 80), href: `${base}/admin/enquiries/${l.enquiryId}` })),
    ...was.map(({ ev, name }) => ({ ref: ref('A'), at: ev.createdAt, title: `WhatsApped ${name ?? 'a lead'}`, detail: clip((ev.detail ?? '').split('\n').slice(1).join(' '), 140), href: ev.enquiryId ? `${base}/admin/enquiries/${ev.enquiryId}` : `${base}/admin` })),
    ...notes.map(({ n: x, name }) => ({ ref: ref('A'), at: x.createdAt, title: `Note on ${name ?? 'a lead'}`, detail: clip(x.body, 160), href: `${base}/admin/enquiries/${x.enquiryId}` })),
    ...visits.map((a) => ({ ref: ref('A'), at: a.startsAt, title: `${a.kind === 'valuation' ? 'Valuation' : a.kind === 'viewing' ? 'Viewing' : 'Appointment'} with ${a.contactName ?? 'a client'}${a.address ? ` at ${clip(a.address, 50)}` : ''}`, detail: a.status === 'completed' ? clip(a.outcomeNotes ?? 'outcome recorded', 160) : a.status === 'cancelled' ? 'cancelled' : 'outcome not recorded yet', href: `${base}/admin/diary/${a.id}` })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1))

  // What came in: theirs, and everything.
  // Routine: automated, or no reply expected (notifications, receipts, newsletters). New leads always matter.
  const inItem = (m: typeof mailIn[number], p: string): Item => ({ ref: ref(p), at: m.sentAt, title: `${who(m)}: “${clip(m.subject, 80)}”`, detail: `${time(m.sentAt)} · ${clip(unquoted(m.body) || m.snippet, p === 'R' ? 220 : 140)}`, href: thread(m.threadId), routine: junk.has(m.threadId) || (!m.needsReply && m.area !== 'leads') })
  const received = mailIn.filter((m) => !junk.has(m.threadId) && isFor(m, person.aliases)).map((m) => inItem(m, 'R'))
  const inbox = mailIn.map((m) => inItem(m, 'I'))

  // Still outstanding for them, most urgent first.
  const now = new Date().toISOString()
  const [taskRows, todays, pending, leads] = await Promise.all([
    ids.length ? db.select({ t: tasks, name: contacts.name }).from(tasks).leftJoin(contacts, eq(tasks.contactId, contacts.id)).where(and(inArray(tasks.assignedTo, ids), isNull(tasks.doneAt), lt(tasks.dueAt, endToday))).orderBy(asc(tasks.dueAt)).limit(30) : Promise.resolve([]),
    ids.length ? db.select().from(appointments).where(and(inArray(appointments.staffId, ids), eq(appointments.status, 'scheduled'), gte(appointments.startsAt, to), lt(appointments.startsAt, endToday))).orderBy(asc(appointments.startsAt)) : Promise.resolve([]),
    db.select().from(mailThreads).where(and(eq(mailThreads.status, 'pending'), gte(mailThreads.lastAt, new Date(Date.now() - 14 * 864e5).toISOString()))).orderBy(asc(mailThreads.lastInAt)).limit(150),
    ids.length ? db.select().from(enquiries).where(and(inArray(enquiries.ownerId, ids), eq(enquiries.status, 'new'), isNull(enquiries.lastOutboundAt), gte(enquiries.createdAt, new Date(Date.now() - 14 * 864e5).toISOString()))).orderBy(asc(enquiries.createdAt)).limit(30) : Promise.resolve([]),
  ])
  // Emails waiting for a reply that are theirs (to them or naming them).
  const lastIns = pending.length ? await db.select().from(mailMessages).where(and(inArray(mailMessages.threadId, pending.map((t) => t.id)), eq(mailMessages.direction, 'in'))) : []
  const waitingFor = pending.filter((t) => !junk.has(t.id) && lastIns.some((m) => m.threadId === t.id && isFor(m, person.aliases)))
  const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : 0)
  // Promises they made in emails, due today or before; and replies drafted overnight for them.
  const [owed, drafts] = await Promise.all([promisesDue(today, person.name).catch(() => []), readyDrafts(person.name).catch(() => [])])
  const myDrafts = drafts.filter((d) => d.person === person.name)
  const outstanding: Item[] = [
    ...owed.map((p) => ({ ref: ref('T'), at: p.sentAt, title: `You promised ${p.toName ?? 'them'}: ${p.promise}`, detail: p.dueDate! < today ? `was due ${dueDay(p.dueDate!)}` : 'due today', href: thread(p.threadId), urgent: p.dueDate! < today, kind: 'promise' as const })),
    ...taskRows.filter(({ t }) => t.dueAt < now).map(({ t, name }) => ({ ref: ref('T'), at: t.dueAt, title: `Overdue: ${t.title}${name ? ` (${name})` : ''}`, detail: `was due ${short(t.dueAt)}`, href: `${base}/admin/my-day`, urgent: true, kind: 'callback' as const })),
    ...todays.map((a) => ({ ref: ref('T'), at: a.startsAt, title: `${a.kind === 'valuation' ? 'Valuation' : a.kind === 'viewing' ? 'Viewing' : 'Appointment'} at ${time(a.startsAt)} with ${a.contactName ?? 'a client'}`, detail: clip(a.address, 60), href: `${base}/admin/diary/${a.id}`, kind: 'appointment' as const })),
    ...leads.map((e) => ({ ref: ref('T'), at: e.createdAt, title: `Get back to ${e.name}: new lead, nobody has replied`, detail: `came in ${short(e.createdAt)}`, href: `${base}/admin/enquiries/${e.id}`, urgent: days(e.createdAt) >= 1, kind: 'lead' as const })),
    ...waitingFor.map((t) => ({ ref: ref('T'), at: t.lastInAt ?? t.lastAt, title: `Reply to ${t.counterpartName || t.counterpart || 'them'}: “${clip(t.subject, 70)}”`, detail: t.lastInAt ? `waiting since ${short(t.lastInAt)}` : 'waiting for a reply', href: thread(t.id), urgent: days(t.lastInAt) >= 2, kind: 'reply' as const })),
    ...taskRows.filter(({ t }) => t.dueAt >= now).map(({ t, name }) => ({ ref: ref('T'), at: t.dueAt, title: `${t.title}${name ? ` (${name})` : ''}`, detail: `due ${time(t.dueAt)} today`, href: `${base}/admin/my-day`, kind: 'callback' as const })),
    ...(myDrafts.length ? [{ ref: ref('T'), at: now, title: `Check and send the ${myDrafts.length === 1 ? 'reply' : `${myDrafts.length} replies`} drafted overnight`, detail: myDrafts.slice(0, 3).map((d) => d.from).join(', '), href: `${base}/admin/agents/drafts?who=${encodeURIComponent(person.name)}`, kind: 'drafts' as const, count: myDrafts.length }] : []),
  ]
  return { person, day: dayName(day), today: dayName(today), base, sent, activity, received, inbox, outstanding }
}

/** Conversations to leave out of everyone's briefing: pitches and spam (judged once each). */
export async function briefingJunk(today = todayLondon()): Promise<Set<string>> {
  await ready()
  const day = addDays(today, -1)
  const [pending, yIn] = await Promise.all([
    db.select({ id: mailThreads.id }).from(mailThreads).where(and(eq(mailThreads.status, 'pending'), gte(mailThreads.lastAt, new Date(Date.now() - 14 * 864e5).toISOString()))).limit(200),
    db.select({ id: mailMessages.threadId }).from(mailMessages).where(and(eq(mailMessages.direction, 'in'), gte(mailMessages.sentAt, londonToIso(day, '00:00')!), lt(mailMessages.sentAt, londonToIso(today, '00:00')!), eq(mailMessages.promo, false), eq(mailMessages.needsReply, true))).limit(200),
  ])
  return junkThreads([...pending.map((r) => r.id), ...yIn.map((r) => r.id)]).catch(() => new Set<string>())
}

const pointSchema = z.object({ text: z.string().describe('One short sentence'), why: z.string().describe('Why, in a few words (or empty)'), refs: z.array(z.string()).describe('The [ref] codes it comes from') })

const View = z.object({
  summary: z.string().describe('3 or 4 sentences, written to them: how things stand today, the most important thing to get done, and anything at risk (a deadline, a client waiting, money on the line).'),
  urgent: z.array(pointSchema).describe('Up to 5 actions for today, most urgent first. Each an instruction in plain words ("Call Mrs Begum back about her rental valuation"), not an email subject. "why": the reason it matters now.'),
  yesterday: z.string().describe('A short paragraph (2 to 4 sentences), written to them: what they actually got done yesterday and what came of it (offers put forward, valuations done, replies sent, problems sorted). If nothing was recorded, say so plainly in one sentence.'),
  waiting: z.string().describe('A short paragraph (2 or 3 sentences): what is still waiting on them beyond the urgent list, who has waited longest, and anything due soon. Describe it; don’t list email subjects.'),
  inbox: z.string().describe('2 or 3 sentences: what mattered in the office inbox yesterday for the business (new leads, offers, complaints, repairs, deadlines) and who needs to act. Leave out routine, automated, pitches and spam. Empty if nothing mattered.'),
})

const RULES = `Rules:
- Use only the items given. Every point cites its [ref] codes. Never invent a fact, name, figure, date or promise.
- Be brief. Leave out routine and generic things: automated notifications, receipts, newsletters, routine admin and everyday small jobs. Only what someone needs to know or act on.
- Urgent first: promises we made that are due or overdue, overdue callbacks, people waiting longest for a reply, new leads nobody has answered, money and deadlines (offers, instructions, renewals, complaints), today's appointments.
- Plain, direct British English. No filler, no praise, no exclamation marks.`

const SYSTEM = `You write the 10am daily briefing for one member of staff at Preston Hill Estates, an independent estate agent in Harrow, like a sharp office manager talking to them: descriptive, specific and short. They should read it in a minute and know what happened yesterday, what came of it, what's still waiting and exactly what to do first. Write in sentences, not lists of emails; only the actions are a list.

${RULES}`

const itemLines = (xs: Item[], n: number) => (xs.length ? xs.slice(0, n).map((i) => `[${i.ref}] ${i.title} — ${i.detail}`).join('\n') : '(none)')
const routineLines = (xs: Item[], n: number) => (xs.length ? xs.slice(0, n).map((i) => `[${i.ref}] ${i.title}`).join('\n') : '(none)')
const briefingInput = (b: Briefing) => [
  `Briefing for ${b.person.name} (also called ${b.person.aliases.join(', ')}), for ${b.today}, covering ${b.day}.`,
  `What they sent yesterday:\n${itemLines(b.sent, 40)}`,
  `What they did in the portal yesterday:\n${itemLines(b.activity, 40)}`,
  `Emails yesterday to them or naming them:\n${itemLines(b.received, 40)}`,
  `Other emails into the office yesterday that may matter:\n${itemLines(b.inbox.filter((i) => !i.routine && !b.received.some((r) => r.href === i.href && r.title === i.title)), 60)}`,
  `Routine or automated emails (subjects only; mention one only if it genuinely matters):\n${routineLines(b.inbox.filter((i) => i.routine), 40)}`,
  `Still outstanding for them:\n${itemLines(b.outstanding, 40)}`,
].join('\n\n')

const empty = (b: Briefing) => !b.sent.length && !b.activity.length && !b.received.length && !b.inbox.length && !b.outstanding.length

async function writeView(b: Briefing): Promise<{ view: BriefingView; note: string | null }> {
  if (empty(b)) return { view: plainView(b), note: null }
  const r = await askClaude('claude-sonnet-5-5', SYSTEM, View, briefingInput(b), `staff briefing: ${b.person.name}`)
  if ('why' in r) return { view: plainView(b), note: `Just the to-do list today: the summary couldn’t be written (${r.why}).` }
  const { view, dropped } = checkView(r.out, b)
  const plain = plainView(b)
  if (!view.urgent.length && b.outstanding.some((o) => o.urgent)) view.urgent = plain.urgent
  if (!view.summary) view.summary = plain.summary
  if (!view.yesterday) view.yesterday = plain.yesterday
  return { view, note: dropped ? `The sense-check removed ${dropped} point${dropped === 1 ? '' : 's'} that didn’t match the emails and records.` : null }
}

// ---------- the Director's snapshot ----------

/** Where the money is: live valuations with a guide price, buyers on our listings, offers, and big figures in yesterday's emails. */
async function highValueItems(day: { from: string; to: string }, base: string, junk: Set<string>): Promise<Item[]> {
  const since = new Date(Date.now() - 60 * 864e5).toISOString()
  const [guides, onListings, mail] = await Promise.all([
    db.select({ e: enquiries, g: reportGuides }).from(enquiries).innerJoin(reportGuides, eq(reportGuides.bookletId, enquiries.id))
      .where(and(gte(enquiries.createdAt, since), inArray(enquiries.status, ['new', 'contacted', 'engaged', 'viewing', 'offer']))).limit(100),
    db.select({ e: enquiries, p: properties }).from(enquiries).innerJoin(properties, eq(enquiries.propertyId, properties.id))
      .where(and(gte(enquiries.createdAt, new Date(Date.now() - 21 * 864e5).toISOString()), inArray(enquiries.status, ['engaged', 'viewing', 'offer']))).limit(100),
    db.select().from(mailMessages).where(and(gte(mailMessages.sentAt, day.from), lt(mailMessages.sentAt, day.to), eq(mailMessages.promo, false))).limit(300),
  ])
  const out: Item[] = []
  let n = 0
  const ref = () => `H${++n}`
  const status = (s: string) => ({ new: 'new lead', contacted: 'contacted', engaged: 'talking to us', viewing: 'visit booked', offer: 'offer stage' } as Record<string, string>)[s] ?? s
  for (const { e, g } of guides) {
    if (!g.asking) continue
    const rent = g.priceFor === 'lettings'
    out.push({ ref: ref(), at: e.createdAt, title: `${rent ? 'Rental valuation' : 'Valuation'}: ${e.name}, guide £${g.asking.toLocaleString('en-GB')}${rent ? ' pcm' : ''}`, detail: status(e.status), href: `${base}/admin/enquiries/${e.id}`, value: rent ? g.asking * 12 : g.asking })
  }
  for (const { e, p } of onListings) {
    if (!p.price) continue
    const rent = p.channel === 'let'
    out.push({ ref: ref(), at: e.createdAt, title: `${e.name} on ${p.displayAddress ?? 'one of our homes'} (£${p.price.toLocaleString('en-GB')}${rent ? ' pcm' : ''})`, detail: status(e.status), href: `${base}/admin/enquiries/${e.id}`, value: rent ? p.price * 12 : p.price })
  }
  // Offers and big figures mentioned in yesterday's emails.
  for (const m of mail) {
    // Real people only: not automated or bulk (portal reports), not pitches or spam, and from us only what staff wrote
    // about an offer (never the agents' or marketing emails, which quote local prices).
    if (junk.has(m.threadId)) continue
    if (m.direction === 'in' && (!m.needsReply || m.area === 'promo' || m.promo)) continue
    if (m.direction === 'out' && m.via === 'portal' && !m.sentBy) continue
    const t = `${m.subject ?? ''} ${unquoted(m.body)}`
    const offer = /\boffer(s|ed)?\b|\bagreed\b|\binstruct/i.test(t)
    if (m.direction === 'out' && !offer) continue
    const big = Math.max(0, ...[...t.matchAll(/£\s?(\d{1,3}(?:,\d{3})+|\d{5,})/g)].map((x) => Number(x[1].replace(/,/g, ''))))
    if (big < 150_000 && !offer) continue
    out.push({ ref: ref(), at: m.sentAt, title: `${m.direction === 'in' ? `From ${who(m)}` : 'We sent'}: “${clip(m.subject, 70)}”${big ? ` (mentions £${big.toLocaleString('en-GB')})` : ''}`, detail: clip(unquoted(m.body), 140), href: `${base}/admin/mail/${m.threadId}`, value: big || undefined })
  }
  return out.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 15)
}

export async function buildSnapshot(director: Person, today = todayLondon(), junk?: Set<string>): Promise<Snapshot> {
  const people = (await briefingPeople()).filter((p) => !p.director)
  const j = junk ?? await briefingJunk(today)
  const [me, ...team] = await Promise.all([buildBriefing(director, today, 'J-', j), ...people.map((p, i) => buildBriefing(p, today, `P${i + 1}-`, j))])
  const day = addDays(today, -1)
  const highValue = await highValueItems({ from: londonToIso(day, '00:00')!, to: londonToIso(today, '00:00')! }, me.base, j)
  return { me, team, highValue, day: me.day, today: me.today, base: me.base }
}

const SnapView = z.object({
  summary: z.string().describe('3 or 4 sentences for the owner: how things stand, what went well or badly yesterday, the biggest risk today and the biggest opportunity. Like a sharp operations director talking to the owner.'),
  urgent: z.array(pointSchema).describe('Up to 5 things that need attention now across the team, most important first. Start each with who should act, and say what to do (not just the email subject). "why": the reason it matters.'),
  team: z.array(z.object({
    name: z.string().describe('The person’s name exactly as given'),
    did: z.string().describe('One sentence in plain words: what they actually got done yesterday that matters. If nothing was recorded, say so plainly.'),
    next: z.array(z.string()).describe('Their 2 most important next actions, each a short instruction (e.g. "Call Mrs Begum back about her rental valuation")'),
    refs: z.array(z.string()).describe('The [ref] codes for those next actions, in the same order'),
  })).describe('One entry per team member, in the order given'),
  highValue: z.array(pointSchema).describe('Up to 5 high-value items, biggest first. "text": what it is and the figure; "why": where it stands and the next step (who, what).'),
  mine: z.array(pointSchema).describe('Up to 4 things for the owner himself: decisions, people to call, things only he can do.'),
})

const SNAP_SYSTEM = `You write the 10am Director's snapshot for the owner of Preston Hill Estates, an independent estate agent in Harrow. In a minute he should see what each member of staff did yesterday, what's outstanding for each, the most urgent things across the team, and where the high-value work sits (big guide prices, offers, buyers on expensive homes), so nothing valuable slips.

${RULES}`

async function writeSnapshot(s: Snapshot): Promise<{ view: SnapshotView; note: string | null }> {
  const content = [
    `Director's snapshot for ${s.today}, covering ${s.day}.`,
    ...s.team.map((b) => `=== ${b.person.name} ===\nWaiting on them: ${waitingLine(statsOf(b))}.\n\n${briefingInput(b).split('\n\n').slice(1).filter((x) => !x.startsWith('Other emails') && !x.startsWith('Routine')).join('\n\n')}`),
    `=== Everything that came into the office yesterday that may matter ===\n${itemLines(s.me.inbox.filter((i) => !i.routine), 60)}`,
    `=== High-value items (biggest first) ===\n${itemLines(s.highValue, 15)}`,
    `=== The owner's own ===\n${briefingInput(s.me).split('\n\n').filter((x) => /^(What they sent|What they did|Emails yesterday to them|Still outstanding)/.test(x)).join('\n\n')}`,
  ].join('\n\n')
  const r = await askClaude('claude-opus-5-5', SNAP_SYSTEM, SnapView, content, 'director snapshot')
  if ('why' in r) return { view: plainSnapshot(s), note: `The counts and lists only today: the summary couldn’t be written (${r.why}).` }
  const { view, dropped } = checkSnapshot(r.out, s)
  // Anyone Claude missed (or whose lines were dropped) gets the plain line.
  const plain = plainSnapshot(s)
  view.team = s.team.map((b) => { const t = view.team.find((x) => x.name === b.person.name); const p = plain.team.find((x) => x.name === b.person.name)!; return t && t.did ? { ...t, next: t.next.length ? t.next : p.next, refs: t.next.length ? t.refs : p.refs } : p })
  if (!view.summary) view.summary = plain.summary
  if (!view.highValue.length && s.highValue.length) view.highValue = plain.highValue
  return { view, note: dropped ? `The sense-check removed ${dropped} point${dropped === 1 ? '' : 's'} that didn’t match the emails and records.` : null }
}

// ---------- sending ----------

const previews = new Map<string, { at: number; m: { subject: string; text: string; html: string } }>()

/** A briefing exactly as it would go now, with Claude's summary (kept for 30 minutes, so looking again costs nothing). */
export async function previewBriefing(name: string, fresh = false) {
  const p = (await briefingPeople()).find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!p) return null
  const key = `${p.name}|${todayLondon()}`
  const hit = previews.get(key)
  if (hit && !fresh && Date.now() - hit.at < 30 * 60e3) return { person: p, ...hit.m }
  const m = await composeBriefing(p)
  previews.set(key, { at: Date.now(), m })
  return { person: p, ...m }
}

async function composeBriefing(p: Person, junk?: Set<string>): Promise<{ subject: string; text: string; html: string; detail: string }> {
  const j = junk ?? await briefingJunk()
  if (p.director) {
    const s = await buildSnapshot(p, todayLondon(), j)
    const { view, note } = await writeSnapshot(s)
    return { ...snapshotEmail(s, view, note), detail: `Snapshot of ${s.team.map((b) => b.person.name).join(', ')}; ${s.highValue.length} high-value items.${note ? ` ${note}` : ''}` }
  }
  const b = await buildBriefing(p, todayLondon(), '', j)
  const { view, note } = await writeView(b)
  return { ...briefingEmail(b, view, note), detail: `${view.urgent.length} to do first, ${b.outstanding.length} outstanding, ${b.inbox.length} emails in.${note ? ` ${note}` : ''}` }
}

export async function sendBriefing(p: Person, by: string | null = null, junk?: Set<string>): Promise<{ ok: boolean; error?: string }> {
  const { detail, ...m } = await composeBriefing(p, junk)
  const sent = await sendFromMailbox({ to: [p.to], subject: m.subject, text: m.text, html: m.html, by })
  if (!sent.ok) {
    noteMailError(sent.error)
    await logAction({ agent: 'director', kind: 'briefing', status: 'blocked', title: `${p.name}’s briefing not sent`, detail: sent.error.slice(0, 300) })
    return { ok: false, error: sent.error }
  }
  await logAction({ agent: 'director', kind: 'briefing', status: 'done', title: `${p.name}’s briefing sent to ${p.to}`, detail, by })
  return { ok: true }
}

/** From the background job: each person's briefing once a day, from 10am London. */
export async function runBriefings(at = new Date()): Promise<{ sent: number }> {
  const cfg = await agentSettings()
  if (cfg.briefingsOff || mailPaused(at.getTime())) return { sent: 0 }
  const hm = at.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (hm < '10:00' || hm >= '13:00') return { sent: 0 }
  await ready()
  const box = await mailboxStatus().catch(() => null)
  if (!box?.hasPassword) return { sent: 0 }
  let sent = 0
  const junk = await briefingJunk()
  for (const p of (await briefingPeople()).filter((x) => !x.off && x.to)) {
    const key = `briefing-${p.name.toLowerCase()}-${todayLondon()}`
    const claim = await getClient().execute({ sql: `INSERT OR IGNORE INTO jobs (name, last_run_at) VALUES (?, ?)`, args: [key, at.toISOString()] })
    if (claim.rowsAffected !== 1) continue
    const r = await sendBriefing(p, null, junk)
    if (r.ok) sent++
    else if (mailPaused()) { await getClient().execute({ sql: `DELETE FROM jobs WHERE name = ?`, args: [key] }); break }
  }
  return { sent }
}

/** When each person's last briefing went, for the Agents page. */
export async function lastBriefings(): Promise<Map<string, { at: string; ok: boolean; detail: string | null }>> {
  await ready()
  const rows = await db.select().from(logActionTable).where(and(eq(logActionTable.agent, 'director'), eq(logActionTable.kind, 'briefing'), gte(logActionTable.createdAt, new Date(Date.now() - 8 * 864e5).toISOString()))).orderBy(asc(logActionTable.createdAt))
  const out = new Map<string, { at: string; ok: boolean; detail: string | null }>()
  for (const r of rows) { const name = r.title.split('’s briefing')[0]; out.set(name, { at: r.createdAt, ok: r.status === 'done', detail: r.detail }) }
  return out
}
