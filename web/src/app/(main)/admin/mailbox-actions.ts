'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { auditState, markAuditStarting, runAudit } from '@/lib/mail-audit'
import { requireAdmin, requireRole } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { FASTHOSTS_IMAP, addSkippedEmail, checkMailbox, forgetSkipped, findMailServer, forgetMailbox, mailboxStatus, saveMailbox, setMailboxEnabled, testMailbox } from '@/lib/mailbox'

export type MailboxFormState = { ok?: boolean; error?: string; detail?: string; messages?: number; found?: number; host?: string; port?: number }

const str = (form: FormData, k: string, max = 300) => String(form.get(k) ?? '').trim().slice(0, max)

/** Tests the login, and if it works saves it, switches the mailbox on and checks for new enquiries straight away. */
export async function connectMailbox(_prev: MailboxFormState, form: FormData): Promise<MailboxFormState> {
  const me = await requireRole('admin')
  const user = str(form, 'user', 200)
  const typed = str(form, 'pass', 300)
  let host = str(form, 'host', 200).toLowerCase() || FASTHOSTS_IMAP
  let port = Number(str(form, 'port', 6)) || 993
  const includePeople = form.get('includePeople') === 'on'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) return { error: 'Enter the full email address of the mailbox, e.g. info@prestonhillestates.com.' }
  if (!/^[a-z0-9.-]+$/.test(host)) return { error: 'That server name doesn’t look right.' }
  const saved = await mailboxStatus()
  const keepOld = !typed && saved?.hasPassword && saved.user.toLowerCase() === user.toLowerCase()
  if (!typed && !keepOld) return { error: 'Enter the mailbox password.' }

  if (typed) {
    // Find a server that answers first (the one typed, then the usual ones for whoever runs this domain's email).
    const where = await findMailServer(user, host, port)
    const who = where.provider.name ? `Email for ${user.split('@')[1]} is run by ${where.provider.name}.` : where.provider.mx.length ? `Email for ${user.split('@')[1]} is handled by ${where.provider.mx.slice(0, 2).join(', ')}.` : ''
    if (!where.found) {
      return {
        error: where.provider.note ?? 'None of the usual mail servers answered for this mailbox.',
        detail: [who, `Tried: ${[...new Set(where.tried.map((t) => `${t.host}:${t.port}`))].join(', ')}.`, 'In Apple Mail, open Mail → Settings → Accounts → Server Settings, and copy the “Incoming Mail Server” name into the server box below (click Change).'].filter(Boolean).join(' '),
      }
    }
    host = where.found.host
    port = where.found.port
    const t = await testMailbox(host, port, user, typed)
    if (!t.ok) return { error: t.error, detail: [who, `Server: ${host}:${port}.`, where.provider.note].filter(Boolean).join(' '), host, port }
    await saveMailbox({ host, port, user, pass: typed, enabled: true, includePeople })
    await audit(me.id, 'mailbox_connect', 'settings', 'mailbox', `${user} via ${host}`)
    const r = await checkMailbox({ force: true })
    revalidatePath('/admin', 'layout')
    return { ok: true, messages: t.messages, found: r.found ?? 0, host, port }
  }
  await saveMailbox({ host, port, user, enabled: true, includePeople })
  revalidatePath('/admin', 'layout')
  return { ok: true, host }
}

export async function mailboxOnOff(form: FormData) {
  const me = await requireRole('admin')
  const on = form.get('on') === '1'
  await setMailboxEnabled(on)
  await audit(me.id, on ? 'mailbox_on' : 'mailbox_off', 'settings', 'mailbox', '')
  revalidatePath('/admin', 'layout')
}

/** Anyone signed in can ask for an immediate check (it's harmless, and handy on the dashboard). */
export async function mailboxCheckNow() {
  await requireAdmin()
  await checkMailbox({ force: true })
  revalidatePath('/admin', 'layout')
}

export async function mailboxForget() {
  const me = await requireRole('admin')
  await forgetMailbox()
  await audit(me.id, 'mailbox_forget', 'settings', 'mailbox', '')
  revalidatePath('/admin', 'layout')
}

/** Starts the inbox audit in the background; the audit page shows progress. */
export async function startMailAudit(form: FormData) {
  const me = await requireRole('admin')
  const months = [3, 6, 12].includes(Number(form.get('months'))) ? Number(form.get('months')) : 6
  if ((await auditState()).status === 'running') return
  await audit(me.id, 'mail_audit', 'settings', 'mail_audit', `${months} months`)
  await markAuditStarting()
  after(() => runAudit(months).catch((e) => console.error('mail audit failed', e)))
  revalidatePath('/admin/email-inbox/audit')
}

/** Adds an email the automatic check passed over, when staff say it is an enquiry. */
export async function mailboxAddSkipped(form: FormData) {
  const me = await requireAdmin()
  const folder = String(form.get('folder') || 'INBOX'), u = Number(form.get('uid'))
  if (!u) return
  const r = await addSkippedEmail(folder, u)
  await audit(me.id, 'mailbox_add_skipped', 'settings', 'mailbox', `${folder} ${u}: ${r.ok ? r.name : r.error}`)
  revalidatePath('/admin', 'layout')
}

/** Takes an email off the "not added" list without adding it. */
export async function mailboxDismissSkipped(form: FormData) {
  await requireAdmin()
  await forgetSkipped(Number(form.get('uid')), String(form.get('folder') || 'INBOX'))
  revalidatePath('/admin/email-inbox')
}
