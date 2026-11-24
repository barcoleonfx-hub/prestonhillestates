import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { and, asc, eq, gte, inArray, isNull, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, getClient, ready } from '@/db/client'
import { admins, agentActions as logActionTable, appointments, calls, contacts, enquiries, enquiryNotes, followupLog, leadEvents, mailMessages, mailThreads, tasks } from '@/db/schema'
import { agentSettings, agentsMaySpend, recordUsage } from './ai-usage'
import { logAction } from './agents'
import { anthropicKey } from './anthropic-key'
import { mailPaused, noteMailError } from './mail-health'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { knownBase } from './property-email-data'
import { DEFAULT_PEOPLE, briefingEmail, checkView, isFor, plainView, signedBy, unquoted, type Briefing, type BriefingView, type Item, type Person } from './staff-briefing-rules'
import { addDays, londonToIso, todayLondon } from './time'

// The 10am staff briefing: one email per person (Fred to his own address, the rest to info@), from the office
// mailbox (inbox and sent items) and the portal (calls, notes, WhatsApps, callbacks, visits, leads).

const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const short = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const who = (m: { fromName?: string | null; fromAddr?: string | null }) => m.fromName?.trim() || m.fromAddr || 'someone'

export async function briefingPeople(): Promise<Person[]> {
  const cfg = await agentSettings()
  return cfg.briefings?.length ? cfg.briefings : DEFAULT_PEOPLE
}

/** Everything for one person's briefing, for the day before `today` (London). */
export async function buildBriefing(person: Person, today = todayLondon()): Promise<Briefing> {
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
  const ref = (p: string) => `${p}${++n}`

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
  const inItem = (m: typeof mailIn[number], p: string): Item => ({ ref: ref(p), at: m.sentAt, title: `${who(m)}: “${clip(m.subject, 80)}”`, detail: `${time(m.sentAt)} · ${clip(unquoted(m.body) || m.snippet, p === 'R' ? 220 : 140)}`, href: thread(m.threadId) })
  const received = mailIn.filter((m) => isFor(m, person.aliases)).map((m) => inItem(m, 'R'))
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
  const waitingFor = pending.filter((t) => lastIns.some((m) => m.threadId === t.id && isFor(m, person.aliases)))
  const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : 0)
  const outstanding: Item[] = [
    ...taskRows.filter(({ t }) => t.dueAt < now).map(({ t, name }) => ({ ref: ref('T'), at: t.dueAt, title: `Overdue: ${t.title}${name ? ` (${name})` : ''}`, detail: `was due ${short(t.dueAt)}`, href: `${base}/admin/my-day`, urgent: true })),
    ...todays.map((a) => ({ ref: ref('T'), at: a.startsAt, title: `${a.kind === 'valuation' ? 'Valuation' : a.kind === 'viewing' ? 'Viewing' : 'Appointment'} at ${time(a.startsAt)} with ${a.contactName ?? 'a client'}`, detail: clip(a.address, 60), href: `${base}/admin/diary/${a.id}` })),
    ...leads.map((e) => ({ ref: ref('T'), at: e.createdAt, title: `Get back to ${e.name}: new lead, nobody has replied`, detail: `came in ${short(e.createdAt)}`, href: `${base}/admin/enquiries/${e.id}`, urgent: days(e.createdAt) >= 1 })),
    ...waitingFor.map((t) => ({ ref: ref('T'), at: t.lastInAt ?? t.lastAt, title: `Reply to ${t.counterpartName || t.counterpart || 'them'}: “${clip(t.subject, 70)}”`, detail: t.lastInAt ? `waiting since ${short(t.lastInAt)}` : 'waiting for a reply', href: thread(t.id), urgent: days(t.lastInAt) >= 2 })),
    ...taskRows.filter(({ t }) => t.dueAt >= now).map(({ t, name }) => ({ ref: ref('T'), at: t.dueAt, title: `${t.title}${name ? ` (${name})` : ''}`, detail: `due ${time(t.dueAt)} today`, href: `${base}/admin/my-day` })),
  ]
  return { person, day: dayName(day), today: dayName(today), base, sent, activity, received, inbox, outstanding }
}

const View = z.object({
  yesterday: z.string().describe('At most 90 words: what this person sent, did and spoke about yesterday, in plain British English. Empty if nothing.'),
  discuss: z.array(z.object({ point: z.string().describe('One sentence: something important to talk about or follow up today'), refs: z.array(z.string()).describe('The [ref] codes of the items it comes from') })).describe('Up to 5, most important first'),
  inbox: z.string().describe('At most 110 words summarising everything that came into the office mailbox yesterday: the themes, anything urgent or unusual, who needs to act.'),
  priorities: z.array(z.object({ action: z.string().describe('What to do, e.g. "Reply to Sam Patel about the viewing"'), why: z.string().describe('Why now, in a few words'), refs: z.array(z.string()).describe('The [ref] codes it comes from') })).describe('Up to 6 things this person should do first today, most urgent first'),
})

const SYSTEM = `You write the 10am daily briefing for one member of staff at Preston Hill Estates, an independent estate agent in Harrow. Its job: make sure they're up to date with everything done yesterday and know exactly what to do first today, so nothing is missed or done twice.

Rules:
- Use only the items given. Refer to items by their [ref] codes in "refs". Never invent a fact, name, figure, date or promise.
- Priorities: overdue callbacks, people waiting for a reply (longest first), new leads nobody has answered, today's appointments, then anything in yesterday's emails that needs this person to act. Be specific: who, and what to do.
- "To discuss": things worth raising with the team (a complaint, a decision, an offer, a problem, something promised), not routine.
- Plain, direct British English. No filler, no praise, no exclamation marks.`

async function writeView(b: Briefing): Promise<{ view: BriefingView; note: string | null }> {
  const plain = (why: string) => ({ view: plainView(b), note: `The summaries are left out today: ${why}.` })
  if (!b.sent.length && !b.activity.length && !b.received.length && !b.inbox.length && !b.outstanding.length) return { view: plainView(b), note: null }
  const k = anthropicKey()
  if ('error' in k) return plain('the Claude API key isn’t set')
  if (!(await agentsMaySpend())) return plain('this month’s AI budget is used up')
  const section = (title: string, xs: Item[], n: number) => `${title}:\n${xs.length ? xs.slice(0, n).map((i) => `[${i.ref}] ${i.title} — ${i.detail}`).join('\n') : '(none)'}`
  const ask = [
    `Briefing for ${b.person.name} (also called ${b.person.aliases.join(', ')}), for ${b.today}, covering ${b.day}.`,
    section('What they sent yesterday', b.sent, 40), section('What they did in the portal yesterday', b.activity, 40),
    section('Emails yesterday addressed to them or naming them', b.received, 40), section('Everything that came into the office mailbox yesterday', b.inbox, 90),
    section('Still outstanding for them', b.outstanding, 40),
  ].join('\n\n')
  const model = 'claude-sonnet-5-5'
  try {
    const client = new Anthropic({ apiKey: k.key })
    const res = await client.beta.messages.parse({
      model, max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(View) }, messages: [{ role: 'user', content: ask }],
    })
    await recordUsage(model, res.usage, `staff briefing: ${b.person.name}`, true)
    if (res.stop_reason === 'refusal' || !res.parsed_output) return plain('Claude couldn’t write them')
    const { view, dropped } = checkView(res.parsed_output, b)
    // Nothing usable left in the priorities: fall back to the outstanding list itself.
    if (!view.priorities.length && b.outstanding.length) view.priorities = plainView(b).priorities
    return { view, note: dropped ? `The sense-check removed ${dropped} point${dropped === 1 ? '' : 's'} that didn’t match the emails and records.` : null }
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) console.error('staff briefing failed', e)
    return plain('Claude didn’t answer')
  }
}

/** The briefing as it would go now, without Claude (so a preview costs nothing). */
export async function previewBriefing(name: string) {
  const p = (await briefingPeople()).find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!p) return null
  const b = await buildBriefing(p)
  return { person: p, ...briefingEmail(b, plainView(b), 'Preview: Claude writes the summaries and the “Do first” order when it’s sent.') }
}

export async function sendBriefing(p: Person, by: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const b = await buildBriefing(p)
  const { view, note } = await writeView(b)
  const m = briefingEmail(b, view, note)
  const sent = await sendFromMailbox({ to: [p.to], subject: m.subject, text: m.text, html: m.html, by })
  if (!sent.ok) {
    noteMailError(sent.error)
    await logAction({ agent: 'director', kind: 'briefing', status: 'blocked', title: `${p.name}’s briefing not sent`, detail: sent.error.slice(0, 300) })
    return { ok: false, error: sent.error }
  }
  await logAction({ agent: 'director', kind: 'briefing', status: 'done', title: `${p.name}’s briefing sent to ${p.to}`, detail: `${b.received.length} emails for them, ${b.inbox.length} in all, ${b.outstanding.length} outstanding.${note ? ` ${note}` : ''}`, by })
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
  for (const p of (await briefingPeople()).filter((x) => !x.off && x.to)) {
    const key = `briefing-${p.name.toLowerCase()}-${todayLondon()}`
    const claim = await getClient().execute({ sql: `INSERT OR IGNORE INTO jobs (name, last_run_at) VALUES (?, ?)`, args: [key, at.toISOString()] })
    if (claim.rowsAffected !== 1) continue
    const r = await sendBriefing(p)
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
