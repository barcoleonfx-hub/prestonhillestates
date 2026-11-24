import 'server-only'
import { and, desc, eq, gte } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { agentActions, enquiries, followupLog, notifications } from '@/db/schema'
import { logAction, type AgentName } from './agents'
import { recordOutgoing } from './enquiry-thread'
import { sendFromMailbox } from './mailbox'
import { ruleChecks, type Draft } from './sense-check'
import type { Check } from './sense-check-rules'
import { now, uid } from './util'

/** A check's name inside a sentence: “Not asked to stop” → “not asked to stop”, keeping OnTheMarket and Claude. */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// Needs approval: what the sense-check held. Each item keeps exactly what would have been sent; staff approve it as it
// is, edit it and send, or reject it. The rules about the person and the never-without-the-guide rules still apply
// when a person approves: those can't be overridden.

export type HeldEmail = {
  channel: 'email'
  to: string
  subject: string
  text: string
  html?: string
  headers?: Record<string, string>
  purpose: string
  template: boolean
  chase?: boolean
  /** The follow-up step it belongs to, so the Follow-ups log shows what happened. */
  followupStep?: string
}

/** Held items older than this are out of date: rejected rather than sent late. */
export const HOLD_DAYS = 5

export async function holdForApproval(a: { agent: AgentName; enquiryId: string; title: string; payload: HeldEmail; checks: Check[]; summary: string }) {
  await ready()
  const id = uid()
  await db.insert(agentActions).values({ id, agent: a.agent, enquiryId: a.enquiryId, kind: 'email', status: 'held', title: a.title, detail: `Held: ${a.summary}`, checks: JSON.stringify(a.checks), payload: JSON.stringify(a.payload), createdAt: now() })
  await db.insert(notifications).values({ id: uid(), kind: 'approval', appointmentId: null, enquiryId: a.enquiryId, title: `Needs approval: ${a.title}`, body: `The sense-check held it: ${a.summary}. Approve, edit or reject it on the Agents page.`, createdBy: null, createdAt: now() })
  return id
}

export type HeldRow = { id: string; agent: string; enquiryId: string | null; name: string | null; title: string; detail: string | null; checks: Check[]; payload: HeldEmail; createdAt: string; expired: boolean }

export async function heldItems(): Promise<HeldRow[]> {
  await ready()
  const rows = await db.select({ a: agentActions, name: enquiries.name }).from(agentActions).leftJoin(enquiries, eq(agentActions.enquiryId, enquiries.id))
    .where(and(eq(agentActions.status, 'held'), eq(agentActions.kind, 'email'), gte(agentActions.createdAt, new Date(Date.now() - 30 * 864e5).toISOString()))).orderBy(desc(agentActions.createdAt)).limit(60)
  return rows.flatMap(({ a, name }) => {
    if (!a.payload) return []
    try {
      return [{ id: a.id, agent: a.agent, enquiryId: a.enquiryId, name, title: a.title, detail: a.detail, checks: a.checks ? JSON.parse(a.checks) : [], payload: JSON.parse(a.payload) as HeldEmail, createdAt: a.createdAt, expired: Date.now() - Date.parse(a.createdAt) > HOLD_DAYS * 864e5 }]
    } catch { return [] }
  })
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Plain text as a simple email: a paragraph per blank line, links clickable. */
export const textToHtml = (t: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:600px">`
  + t.replace(/\r/g, '').trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`).join('') + '</div>'

async function followupNote(enquiryId: string, step: string | undefined, status: string, detail: string, by: string) {
  if (!step) return
  await db.insert(followupLog).values({ id: uid(), enquiryId, step, channel: 'email', status, detail, createdBy: by, createdAt: now() })
}

/** Sends a held email, as it is or as staff edited it. */
export async function approveHeld(id: string, by: { id: string; name: string }, edit?: { subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  await ready()
  const a = await db.query.agentActions.findFirst({ where: eq(agentActions.id, id) })
  if (!a || a.status !== 'held' || !a.payload || !a.enquiryId) return { ok: false, error: 'That’s already been dealt with.' }
  if (Date.now() - Date.parse(a.createdAt) > HOLD_DAYS * 864e5) return { ok: false, error: `It was held over ${HOLD_DAYS} days ago, so it’s out of date. Reject it, and write to them yourself if it’s still right to.` }
  const p = JSON.parse(a.payload) as HeldEmail
  const subject = (edit?.subject ?? p.subject).trim()
  const text = (edit?.text ?? p.text).replace(/\r/g, '').trim()
  if (!subject || text.length < 20) return { ok: false, error: 'Give it a subject and a message.' }
  // Claim it first, so a double click can't send it twice.
  const claim = await db.update(agentActions).set({ status: 'sending' }).where(and(eq(agentActions.id, id), eq(agentActions.status, 'held')))
  if (!claim.rowsAffected) return { ok: false, error: 'That’s already been dealt with.' }
  const draft: Draft = { agent: a.agent as Draft['agent'], enquiryId: a.enquiryId, channel: 'email', to: p.to, subject, text, purpose: p.purpose, template: !edit && p.template, chase: p.chase }
  const { checks } = await ruleChecks(draft)
  const never = checks.filter((c) => !c.ok && c.level === 'block')
  if (never.length) {
    await db.update(agentActions).set({ status: 'held' }).where(eq(agentActions.id, id))
    return { ok: false, error: `It can’t go: ${never.map((c) => lc(c.name) + (c.note ? ` (${c.note})` : '')).join('; ')}.` }
  }
  const sent = await sendFromMailbox({ to: [p.to], subject, text, html: edit ? textToHtml(text) : p.html ?? textToHtml(text), headers: p.headers, by: by.id })
  if (!sent.ok) {
    await db.update(agentActions).set({ status: 'held' }).where(eq(agentActions.id, id))
    return { ok: false, error: sent.error }
  }
  await recordOutgoing(a.enquiryId, { messageId: sent.messageId, subject, body: text, by: by.id, via: 'followup' })
  const soft = checks.filter((c) => !c.ok).map((c) => lc(c.name))
  await db.update(agentActions).set({ status: 'done', doneAt: now(), doneBy: by.id, detail: `${edit ? 'Edited and sent' : 'Approved and sent'} by ${by.name}.${soft.length ? ` They accepted: ${soft.join('; ')}.` : ''}`, payload: JSON.stringify({ ...p, subject, text }) }).where(eq(agentActions.id, id))
  await followupNote(a.enquiryId, p.followupStep, 'sent', `${subject} (approved by ${by.name})`, by.id)
  return { ok: true }
}

export async function rejectHeld(id: string, by: { id: string; name: string }, why?: string): Promise<{ ok: boolean; error?: string }> {
  await ready()
  const a = await db.query.agentActions.findFirst({ where: eq(agentActions.id, id) })
  if (!a || a.status !== 'held') return { ok: false, error: 'That’s already been dealt with.' }
  await db.update(agentActions).set({ status: 'rejected', doneAt: now(), doneBy: by.id, detail: `Rejected by ${by.name}${why?.trim() ? `: ${why.trim().slice(0, 300)}` : '.'}` }).where(eq(agentActions.id, id))
  let step: string | undefined
  try { step = a.payload ? (JSON.parse(a.payload) as HeldEmail).followupStep : undefined } catch { /* none */ }
  if (a.enquiryId) await followupNote(a.enquiryId, step, 'skipped', `Rejected at approval by ${by.name}`, by.id)
  return { ok: true }
}

export { logAction }
