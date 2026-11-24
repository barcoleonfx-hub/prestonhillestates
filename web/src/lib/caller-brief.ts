import 'server-only'
import { and, desc, eq, ne, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { appointments, bookletShares, contacts, enquiries, enquiryNotes } from '@/db/schema'
import { roleLabel } from './crm-options'
import { isBoilerplate } from './email-import'
import { enquiryLabel, isValuation } from './enquiry-labels'
import { detailLines } from './enquiry-workspace'
import { leadHistory } from './lead-history'
import { statusLabel } from './lead-rules'
import { reportStates } from './report-guide'

// The caller brief: what whoever makes the call should know first. What they asked for, whether they've been in
// touch before or been a client, notes, what we've already sent or said, and whether they've opened their report.

export type Brief = { lines: string[]; flags: string[] }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

export async function callerBrief(enquiryId: string): Promise<Brief> {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return { lines: [], flags: [] }
  const c = e.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : null
  const email = (e.email ?? c?.email ?? '').trim().toLowerCase()
  const [others, notes, history, report, share, visits] = await Promise.all([
    db.select().from(enquiries).where(and(ne(enquiries.id, e.id), or(e.contactId ? eq(enquiries.contactId, e.contactId) : undefined, email ? eq(enquiries.email, email) : undefined))).orderBy(desc(enquiries.createdAt)).limit(5),
    db.select().from(enquiryNotes).where(eq(enquiryNotes.enquiryId, e.id)).orderBy(desc(enquiryNotes.createdAt)).limit(2),
    leadHistory(e.id),
    reportStates([e.id]).then((m) => m.get(e.id)!),
    db.query.bookletShares.findFirst({ where: eq(bookletShares.bookletId, e.id) }),
    db.select().from(appointments).where(and(eq(appointments.enquiryId, e.id))).limit(3),
  ])
  const lines: string[] = []
  const flags: string[] = []

  // What they asked: the form's own answers (timing, reasons, what they're after), not the boilerplate.
  const said = detailLines(e.message).filter((l) => l.value && !isBoilerplate(l.value) && !/^(name|email|e-mail|phone|telephone|mobile|address|postcode|property|their address|about)$/i.test(l.label ?? ''))
    .slice(0, 4).map((l) => (l.label ? `${l.label}: ${l.value}` : l.value))
  lines.push(`Asked ${day(e.createdAt)} (${enquiryLabel(e)})${said.length ? `: ${clip(said.join(' · '), 260)}` : ''}`)

  // Known to us already?
  const roles = (c?.roles ?? '').split(',').map((r) => r.trim()).filter(Boolean)
  if (roles.length) flags.push(`On our books as ${roles.map((r) => roleLabel(r).toLowerCase()).join(' and ')}`)
  if (others.length) {
    flags.push(`${others.length} earlier enquir${others.length === 1 ? 'y' : 'ies'}`)
    lines.push(`Before: ${others.slice(0, 3).map((o) => `${enquiryLabel(o).toLowerCase()} ${day(o.createdAt)} (${statusLabel(o.status).toLowerCase()})`).join('; ')}`)
  }
  for (const v of visits.filter((a) => a.status !== 'cancelled')) lines.push(`${v.kind === 'valuation' ? 'Valuation' : 'Visit'} ${v.status === 'completed' ? 'done' : 'booked'} for ${day(v.startsAt)}${v.outcomeNotes ? `: ${clip(v.outcomeNotes, 140)}` : ''}`)

  // What's been done so far, by anyone, and what they've said back.
  const done = history.touches.slice(-3).map((t) => `${t.channel} from ${t.by === 'agent' ? 'the agent' : t.who ?? 'the office'} ${day(t.at)}${t.channel === 'email' ? ` (“${clip(t.text.split('\n')[0] ?? '', 60)}”)` : ''}`)
  lines.push(done.length ? `So far: ${done.join('; ')}` : 'So far: nobody has been in touch yet.')
  const reply = history.inbound[history.inbound.length - 1]
  if (reply) lines.push(`Their last email ${day(reply.at)}: “${clip(reply.text.split('\n').slice(1).join(' ') || reply.text, 180)}”`)
  for (const n of notes) lines.push(`Note ${day(n.createdAt)}: ${clip(n.body, 180)}`)

  // Their report (valuations only).
  if (!isValuation(e)) return { lines, flags }
  if (report.state === 'final' && report.asking) lines.push(`Report finalised: guide £${report.asking.toLocaleString('en-GB')}${share?.views ? `. They’ve opened it ${share.views} time${share.views === 1 ? '' : 's'}, last ${day(share.lastViewAt ?? share.firstViewAt ?? e.createdAt)}` : '. Not opened yet'}`)
  else lines.push(report.state === 'draft' ? 'Report: OnTheMarket guide uploaded, not finalised yet (don’t quote a figure)' : 'Report: OnTheMarket guide still to do (don’t quote a figure)')
  if (share?.views) flags.push(`Opened their report ${share.views}×`)
  return { lines, flags }
}

/** Briefs for several leads at once (the call list). */
export async function callerBriefs(ids: string[]): Promise<Map<string, Brief>> {
  const out = new Map<string, Brief>()
  await Promise.all(ids.map(async (id) => out.set(id, await callerBrief(id).catch(() => ({ lines: [], flags: [] })))))
  return out
}
