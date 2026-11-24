'use server'

import { revalidatePath } from 'next/cache'
import { approveHeld, rejectHeld } from '@/lib/agent-queue'
import { saveAgentSettings } from '@/lib/ai-usage'
import { sendReport } from '@/lib/director'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'

export type QueueResult = { ok: boolean; error?: string }

/** Sends a held email as it is, or as edited. */
export async function approveAction(id: string, edit?: { subject: string; text: string }): Promise<QueueResult> {
  const me = await requireAdmin()
  const r = await approveHeld(id, { id: me.id, name: me.name }, edit)
  // No page refresh: the card says what happened, and the list is up to date next time the page opens.
  if (r.ok) await audit(me.id, edit ? 'agent_email_edited_sent' : 'agent_email_approved', 'agent_action', id)
  return r
}

export async function rejectAction(id: string, why?: string): Promise<QueueResult> {
  const me = await requireAdmin()
  const r = await rejectHeld(id, { id: me.id, name: me.name }, why)
  if (r.ok) await audit(me.id, 'agent_email_rejected', 'agent_action', id, why)
  return r
}

/** The agents' monthly AI budget, in pounds (0 turns their AI off). */
export async function saveBudget(form: FormData): Promise<void> {
  const me = await requireAdmin()
  const n = Math.round(Number(String(form.get('budget') ?? '').replace(/[£,\s]/g, '')))
  if (!Number.isFinite(n) || n < 0 || n > 1000) return
  await saveAgentSettings({ budgetGbp: n })
  await audit(me.id, 'agent_budget_saved', 'setting', 'agents', `£${n}`)
  revalidatePath('/admin/agents')
}

/** Sends the Director's report now (e.g. after fixing the mailbox, or to see today's). */
export async function sendReportNow(): Promise<QueueResult> {
  const me = await requireAdmin()
  const r = await sendReport(me.id)
  if (r.ok) { await audit(me.id, 'director_report_sent', 'setting', 'agents', r.to); revalidatePath('/admin/agents') }
  return r
}

/** Where the daily report goes, and whether it's on. */
export async function saveDirector(form: FormData): Promise<void> {
  const me = await requireAdmin()
  const to = String(form.get('to') ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return
  await saveAgentSettings({ directorTo: to, directorOff: form.get('on') !== 'on' })
  await audit(me.id, 'director_settings_saved', 'setting', 'agents', `${to}${form.get('on') === 'on' ? '' : ' (off)'}`)
  revalidatePath('/admin/agents')
}

/** Puts recent valuation leads that were never followed up onto the Valuation agent's plan, from today. */
export async function startRecentPlans(): Promise<void> {
  const me = await requireAdmin()
  const { notStarted } = await import('@/lib/agent-status')
  const { startFollowups, followupSettings } = await import('@/lib/followups')
  const { logAction } = await import('@/lib/agents')
  if (!(await followupSettings()).on) return
  const leads = (await notStarted()).slice(0, 100)
  for (const e of leads) await startFollowups(e.id)
  if (leads.length) await logAction({ agent: 'valuation', kind: 'plan', status: 'done', title: `Valuation plan started for ${leads.length} recent lead${leads.length === 1 ? '' : 's'}`, detail: `Started by ${me.name}: each gets a call and a WhatsApp today, then the plan from day 1.`, by: me.id })
  await audit(me.id, 'valuation_plan_backfill', 'setting', 'followups', String(leads.length))
  revalidatePath('/admin/agents')
}

/** Moves recent valuation leads from the earlier follow-ups onto the Valuation agent's plan, at the day they've reached. */
export async function moveToPlan(): Promise<void> {
  const me = await requireAdmin()
  const { onOldPlan } = await import('@/lib/agent-status')
  const { moveToValuationPlan } = await import('@/lib/followups')
  const { logAction } = await import('@/lib/agents')
  let moved = 0
  for (const e of (await onOldPlan()).slice(0, 200)) if (await moveToValuationPlan(e.id)) moved++
  if (moved) await logAction({ agent: 'valuation', kind: 'plan', status: 'done', title: `${moved} lead${moved === 1 ? '' : 's'} moved onto the Valuation agent’s plan`, detail: `By ${me.name}: each carries on from the day it has reached (report email, calls, check-ins and letter).`, by: me.id })
  await audit(me.id, 'valuation_plan_moved', 'setting', 'followups', String(moved))
  revalidatePath('/admin/agents')
}

/** Sends one person's 10am briefing now. */
export async function sendBriefingNow(name: string): Promise<QueueResult> {
  const me = await requireAdmin()
  const { briefingPeople, sendBriefing } = await import('@/lib/staff-briefing')
  const p = (await briefingPeople()).find((x) => x.name === name)
  if (!p) return { ok: false, error: 'No briefing with that name.' }
  const r = await sendBriefing(p, me.id)
  if (r.ok) { await audit(me.id, 'briefing_sent', 'setting', 'agents', p.name); revalidatePath('/admin/agents') }
  return r
}

/** Who gets a 10am briefing, which names count as theirs, and where it goes. */
export async function saveBriefings(form: FormData): Promise<void> {
  const me = await requireAdmin()
  const people = [0, 1, 2, 3, 4, 5].map((i) => {
    const name = String(form.get(`name_${i}`) ?? '').trim().slice(0, 40)
    const aliases = String(form.get(`aliases_${i}`) ?? '').split(',').map((a) => a.trim()).filter((a) => a.length >= 2).slice(0, 6)
    const to = String(form.get(`to_${i}`) ?? '').trim().toLowerCase()
    return { name, aliases: aliases.length ? aliases : name ? [name] : [], to, off: form.get(`on_${i}`) !== 'on', director: form.get(`dir_${i}`) === 'on' }
  }).filter((p) => p.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.to))
  if (!people.length) return
  await saveAgentSettings({ briefings: people, briefingsOff: form.get('all') !== 'on' })
  await audit(me.id, 'briefings_saved', 'setting', 'agents', people.map((p) => `${p.name}→${p.to}`).join(', '))
  revalidatePath('/admin/agents')
}

/** Sends every briefing that's switched on, now (each still goes to its own address). */
export async function sendAllBriefingsNow(): Promise<QueueResult & { sent?: string[] }> {
  const me = await requireAdmin()
  const { briefingPeople, sendBriefing } = await import('@/lib/staff-briefing')
  const sent: string[] = []
  for (const p of (await briefingPeople()).filter((x) => !x.off && x.to)) {
    const r = await sendBriefing(p, me.id)
    if (!r.ok) return { ok: false, error: `${sent.length ? `Sent ${sent.join(', ')}; then ` : ''}${p.name}’s couldn’t be sent: ${r.error}`, sent }
    sent.push(p.name)
  }
  await audit(me.id, 'briefings_sent_all', 'setting', 'agents', sent.join(', '))
  revalidatePath('/admin/agents')
  return { ok: true, sent }
}

/** Sends a reply drafted overnight (as edited), in the same conversation, signed by whoever sends it. */
export async function sendDraft(id: string, body: string): Promise<QueueResult> {
  const me = await requireAdmin()
  const { db, ready } = await import('@/db/client')
  const { replyDrafts, mailThreads, mailMessages } = await import('@/db/schema')
  const { and, desc, eq } = await import('drizzle-orm')
  const { sendFromMailbox } = await import('@/lib/mailbox')
  const { BLANK } = await import('@/lib/night-drafts')
  const { now } = await import('@/lib/util')
  await ready()
  const d = await db.query.replyDrafts.findFirst({ where: eq(replyDrafts.id, id) })
  if (!d || d.status !== 'ready') return { ok: false, error: 'That draft has already been dealt with.' }
  const text = body.replace(/\r/g, '').trim()
  if (text.length < 5) return { ok: false, error: 'Write the reply first.' }
  const blank = text.match(BLANK)
  if (blank) return { ok: false, error: `Fill in ${blank[0]} first (or take it out).` }
  const t = await db.query.mailThreads.findFirst({ where: eq(mailThreads.id, d.threadId) })
  const last = (await db.select().from(mailMessages).where(and(eq(mailMessages.threadId, d.threadId), eq(mailMessages.direction, 'in'))).orderBy(desc(mailMessages.sentAt)).limit(1))[0]
  if (!t || !last) return { ok: false, error: 'That conversation no longer exists.' }
  if (last.messageId !== d.forMessageId) return { ok: false, error: 'They’ve written again since this was drafted: open the conversation and reply to their latest email.' }
  // Claim it so a double click can't send it twice.
  const claim = await db.update(replyDrafts).set({ status: 'sending' }).where(and(eq(replyDrafts.id, id), eq(replyDrafts.status, 'ready')))
  if (!claim.rowsAffected) return { ok: false, error: 'That draft has already been dealt with.' }
  const to = (last.replyTo || last.fromAddr || '').trim()
  const references = [...(last.refs ? last.refs.split(/\s+/) : []), last.messageId].slice(-20)
  const quoted = last.body ? `\n\nOn ${new Date(last.sentAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}, ${last.fromName || last.fromAddr} wrote:\n${last.body.split('\n').slice(0, 60).map((l) => `> ${l}`).join('\n')}` : ''
  const r = await sendFromMailbox({ to: [to], subject: d.subject, text: `${text}\n\n${me.name}\nPreston Hill Estates · 271 Preston Road, Harrow HA3 0PS · 020 8904 9005${quoted}`, inReplyTo: last.messageId, references, by: me.id })
  if (!r.ok) { await db.update(replyDrafts).set({ status: 'ready' }).where(eq(replyDrafts.id, id)); return { ok: false, error: r.error } }
  await db.update(replyDrafts).set({ status: 'sent', body: text, doneAt: now(), doneBy: me.id }).where(eq(replyDrafts.id, id))
  await audit(me.id, 'draft_sent', 'mail_thread', d.threadId, d.subject.slice(0, 80))
  return { ok: true }
}

/** Bins a reply drafted overnight. */
export async function dismissDraft(id: string): Promise<QueueResult> {
  const me = await requireAdmin()
  const { db, ready } = await import('@/db/client')
  const { replyDrafts } = await import('@/db/schema')
  const { and, eq } = await import('drizzle-orm')
  const { now } = await import('@/lib/util')
  await ready()
  const r = await db.update(replyDrafts).set({ status: 'dismissed', doneAt: now(), doneBy: me.id }).where(and(eq(replyDrafts.id, id), eq(replyDrafts.status, 'ready')))
  return r.rowsAffected ? { ok: true } : { ok: false, error: 'That draft has already been dealt with.' }
}
