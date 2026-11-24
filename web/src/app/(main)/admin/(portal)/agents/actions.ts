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
