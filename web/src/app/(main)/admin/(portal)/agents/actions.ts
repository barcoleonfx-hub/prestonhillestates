'use server'

import { revalidatePath } from 'next/cache'
import { approveHeld, rejectHeld } from '@/lib/agent-queue'
import { saveAgentSettings } from '@/lib/ai-usage'
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
