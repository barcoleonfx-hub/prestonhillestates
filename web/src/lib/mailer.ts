import 'server-only'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { db } from '@/db/client'
import { emailLog } from '@/db/schema'
import { now, uid } from './util'

export type Mail = {
  to: string[]
  subject: string
  text: string
  html: string
  ics?: { filename: string; content: string; method?: 'PUBLISH' | 'CANCEL' }
  appointmentId?: string
}

let transport: Transporter | null | undefined

/** SMTP when SMTP_HOST is set (Office 365, Google Workspace, SendGrid…); otherwise mail is saved to data/outbox for testing. */
function smtp(): Transporter | null {
  if (transport !== undefined) return transport
  const host = process.env.SMTP_HOST
  if (!host) return (transport = null)
  const port = Number(process.env.SMTP_PORT || 587)
  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  })
  return transport
}

const from = () => process.env.MAIL_FROM || 'Preston Hill Estates <info@prestonhillestates.com>'

async function log(to: string, mail: Mail, status: string, error?: string) {
  await db.insert(emailLog).values({
    id: uid(), toAddr: to, subject: mail.subject, status, error: error ?? null, appointmentId: mail.appointmentId ?? null, createdAt: now(),
  }).catch(() => {})
}

/** Sends one message per recipient so a bad address doesn't stop the rest. Never throws. */
export async function sendMail(mail: Mail): Promise<void> {
  const recipients = [...new Set(mail.to.filter(Boolean))]
  if (recipients.length === 0) return
  const t = smtp()
  const attachments = mail.ics
    ? [{ filename: mail.ics.filename, content: mail.ics.content, contentType: `text/calendar; charset=utf-8; method=${mail.ics.method ?? 'PUBLISH'}` }]
    : undefined

  for (const to of recipients) {
    try {
      if (t) {
        await t.sendMail({ from: from(), to, subject: mail.subject, text: mail.text, html: mail.html, attachments })
        await log(to, mail, 'sent')
      } else {
        const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.OUTBOX_DIR || 'data/outbox')
        await mkdir(dir, { recursive: true })
        const raw = await new Promise<Buffer>((resolve, reject) => {
          nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail(
            { from: from(), to, subject: mail.subject, text: mail.text, html: mail.html, attachments },
            (err, info) => (err ? reject(err) : resolve(info.message as Buffer)),
          )
        })
        const safe = to.replace(/[^a-z0-9@.]+/gi, '_')
        await writeFile(path.join(/* turbopackIgnore: true */ dir, `${Date.now()}-${safe}.eml`), raw)
        await log(to, mail, 'outbox')
      }
    } catch (e) {
      await log(to, mail, 'failed', e instanceof Error ? e.message : String(e))
    }
  }
}

export const portalUrl = (p = '') => `${(process.env.PORTAL_URL || 'http://localhost:3000').replace(/\/$/, '')}${p}`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Branded HTML wrapper for staff emails. Rows are label/value pairs. */
export function staffEmailHtml(opts: { kicker: string; heading: string; rows: [string, string][]; note?: string; button?: { label: string; href: string } }) {
  const rows = opts.rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:7px 14px 7px 0;color:#8E8975;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;color:#23211A;font-size:15px">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#F6F5F0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F5F0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #EAE6DA;border-radius:14px">
<tr><td style="padding:22px 26px 0"><img src="${portalUrl('/img/logo-mark.png')}" width="34" height="34" alt="Preston Hill Estates" style="display:block;width:34px;height:34px;margin:0 0 12px"/><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#A47B1D;font-weight:700">${esc(opts.kicker)}</div>
<h1 style="margin:8px 0 14px;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#23211A">${esc(opts.heading)}</h1></td></tr>
<tr><td style="padding:0 26px"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
${opts.note ? `<tr><td style="padding:14px 26px 0;color:#59554A;font-size:14px">${esc(opts.note)}</td></tr>` : ''}
${opts.button ? `<tr><td style="padding:20px 26px 0"><a href="${esc(opts.button.href)}" style="display:inline-block;background:#C4972F;color:#FFFDF6;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:999px">${esc(opts.button.label)}</a></td></tr>` : ''}
<tr><td style="padding:22px 26px 22px;color:#8E8975;font-size:12px;border-top:1px solid #F1EEE4;margin-top:20px">Preston Hill Estates staff portal · 271 Preston Road, Harrow HA3 0PS</td></tr>
</table></td></tr></table></body></html>`
}

const icsDate = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)

/** Minimal iCalendar event so staff can add the appointment to Outlook / Google / Apple calendars in one tap. */
export function icsEvent(opts: { uid: string; start: string; end: string; summary: string; location: string; description: string; sequence: number; cancel?: boolean }) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Preston Hill Estates//Portal//EN', `METHOD:${opts.cancel ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${opts.uid}@prestonhillestates.com`,
    `SEQUENCE:${opts.sequence}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(opts.start)}`,
    `DTEND:${icsDate(opts.end)}`,
    `SUMMARY:${icsText(opts.summary)}`,
    `LOCATION:${icsText(opts.location)}`,
    `DESCRIPTION:${icsText(opts.description)}`,
    `STATUS:${opts.cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(opts.cancel ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(opts.summary)}`, 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}
