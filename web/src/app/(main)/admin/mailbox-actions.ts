'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { FASTHOSTS_IMAP, checkMailbox, forgetMailbox, mailboxStatus, saveMailbox, setMailboxEnabled, testMailbox } from '@/lib/mailbox'

export type MailboxFormState = { ok?: boolean; error?: string; messages?: number; found?: number; host?: string }

const str = (form: FormData, k: string, max = 300) => String(form.get(k) ?? '').trim().slice(0, max)

/** Tests the login, and if it works saves it, switches the mailbox on and checks for new enquiries straight away. */
export async function connectMailbox(_prev: MailboxFormState, form: FormData): Promise<MailboxFormState> {
  const me = await requireRole('admin')
  const user = str(form, 'user', 200)
  const typed = str(form, 'pass', 300)
  let host = str(form, 'host', 200).toLowerCase() || FASTHOSTS_IMAP
  const port = Number(str(form, 'port', 6)) || 993
  const includePeople = form.get('includePeople') === 'on'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) return { error: 'Enter the full email address of the mailbox, e.g. info@prestonhillestates.com.' }
  if (!/^[a-z0-9.-]+$/.test(host)) return { error: 'That server name doesn’t look right.' }
  const saved = await mailboxStatus()
  const keepOld = !typed && saved?.hasPassword && saved.user.toLowerCase() === user.toLowerCase()
  if (!typed && !keepOld) return { error: 'Enter the mailbox password.' }

  if (typed) {
    let t = await testMailbox(host, port, user, typed)
    // Fasthosts mailboxes answer on either name; try the other one if the first can't be reached.
    if (!t.ok && host === FASTHOSTS_IMAP && /could not be found|did not answer/.test(t.error)) {
      const alt = await testMailbox('mail.livemail.co.uk', port, user, typed)
      if (alt.ok) { t = alt; host = 'mail.livemail.co.uk' }
    }
    if (!t.ok) return { error: t.error, host }
    await saveMailbox({ host, port, user, pass: typed, enabled: true, includePeople })
    await audit(me.id, 'mailbox_connect', 'settings', 'mailbox', `${user} via ${host}`)
    const r = await checkMailbox({ force: true })
    revalidatePath('/admin', 'layout')
    return { ok: true, messages: t.messages, found: r.found ?? 0, host }
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

export async function mailboxCheckNow() {
  await requireRole('admin')
  await checkMailbox({ force: true })
  revalidatePath('/admin', 'layout')
}

export async function mailboxForget() {
  const me = await requireRole('admin')
  await forgetMailbox()
  await audit(me.id, 'mailbox_forget', 'settings', 'mailbox', '')
  revalidatePath('/admin', 'layout')
}
