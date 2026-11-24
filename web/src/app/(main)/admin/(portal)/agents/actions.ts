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
