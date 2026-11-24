// The 10am staff briefing: for each person, what they sent and did yesterday, what came in for them, everything
// that came into the office mailbox, and what's outstanding, most urgent first. Which emails are a person's: ones
// addressed to them or mentioning them (by any of their names), and ones they sent (from the portal, or from Apple
// Mail signed with their name). Claude writes the short summaries; every point must point at real items, and any
// number it uses must be in them, or that point is dropped. Kept free of server code so it's easy to test.

import { numbersIn } from './director-rules'

export type Person = { name: string; aliases: string[]; to: string; off?: boolean }
export const DEFAULT_PEOPLE: Person[] = [
  { name: 'Fred', aliases: ['Fred', 'Ferdous'], to: 'fred@prestonhillestates.com' },
  { name: 'Moniba', aliases: ['Moniba'], to: 'info@prestonhillestates.com' },
  { name: 'Rahman', aliases: ['Rahman'], to: 'info@prestonhillestates.com' },
  { name: 'Jamil', aliases: ['Jamil'], to: 'info@prestonhillestates.com' },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nameRe = (aliases: string[]) => new RegExp(`(?<![\\p{L}\\d])(${aliases.filter(Boolean).map(reEsc).join('|')})(?![\\p{L}\\d])`, 'iu')

/** The new part of an email: everything before the quoted earlier message. */
export function unquoted(body: string | null | undefined): string {
  const t = (body ?? '').replace(/\r/g, '')
  const cut = t.search(/\n\s*(On .{4,120} wrote:|-{2,}\s*Original Message|From:\s.+\n\s*(Sent|Date):|_{8,})/i)
  return (cut >= 0 ? t.slice(0, cut) : t).split('\n').filter((l) => !l.trim().startsWith('>')).join('\n').trim()
}

/** Signed with one of their names (the last few lines of the new part). */
export function signedBy(body: string | null | undefined, aliases: string[]): boolean {
  const t = unquoted(body)
  return nameRe(aliases).test(t.slice(-260))
}

/** An email that's theirs to know about: to their address (fred@…), or naming them in the subject or new part. */
export function isFor(m: { toAddrs?: string | null; ccAddrs?: string | null; subject?: string | null; body?: string | null }, aliases: string[]): boolean {
  const re = nameRe(aliases)
  const addrs = `${m.toAddrs ?? ''} ${m.ccAddrs ?? ''}`
  const local = addrs.toLowerCase().match(/[^\s<>,;"']+(?=@)/g) ?? []
  if (local.some((l) => aliases.some((a) => l.split(/[._-]/).includes(a.toLowerCase())))) return true
  if (/[A-Za-z]/.test(addrs) && re.test(addrs.replace(/<[^>]*>/g, ''))) return true
  return re.test(m.subject ?? '') || re.test(unquoted(m.body))
}

export type Item = { ref: string; at: string; title: string; detail: string; href: string; urgent?: boolean }
export type Briefing = {
  person: Person
  /** e.g. "Monday 23 November" (the day it covers). */
  day: string
  /** e.g. "Tuesday 24 November" (the day it's for). */
  today: string
  base: string
  sent: Item[]
  activity: Item[]
  received: Item[]
  inbox: Item[]
  outstanding: Item[]
}
export type BriefingView = {
  yesterday: string
  discuss: { point: string; refs: string[] }[]
  inbox: string
  priorities: { action: string; why: string; refs: string[] }[]
}

const all = (b: Briefing) => [...b.sent, ...b.activity, ...b.received, ...b.inbox, ...b.outstanding]

/**
 * The sense-check on Claude's summary: each point must cite real items, and every number in it must appear in what
 * it was given. Points that fail are dropped (and counted); summaries that fail are replaced by a plain line.
 */
export function checkView(v: BriefingView, b: Briefing): { view: BriefingView; dropped: number } {
  const items = new Map(all(b).map((i) => [i.ref, i]))
  const source = [b.day, b.today, ...all(b).flatMap((i) => [i.title, i.detail, i.at])].join(' ')
  const allowed = new Set([...numbersIn(source), b.outstanding.length, b.received.length, b.inbox.length, b.sent.length, b.activity.length])
  const numbersOk = (s: string) => numbersIn(s).every((n) => allowed.has(n))
  const refsOk = (refs: string[]) => refs.length > 0 && refs.every((r) => items.has(r))
  let dropped = 0
  const keep = <T,>(xs: T[], ok: (x: T) => boolean) => xs.filter((x) => (ok(x) ? true : (dropped++, false)))
  const view: BriefingView = {
    yesterday: numbersOk(v.yesterday) ? v.yesterday : (dropped++, ''),
    inbox: numbersOk(v.inbox) ? v.inbox : (dropped++, ''),
    discuss: keep(v.discuss, (d) => refsOk(d.refs) && numbersOk(d.point)).slice(0, 5),
    priorities: keep(v.priorities, (p) => refsOk(p.refs) && numbersOk(`${p.action} ${p.why}`)).slice(0, 6),
  }
  return { view, dropped }
}

/** Without Claude: the outstanding items as they are, most urgent first. */
export function plainView(b: Briefing): BriefingView {
  return {
    yesterday: '', inbox: '', discuss: [],
    priorities: b.outstanding.slice(0, 6).map((o) => ({ action: o.title, why: o.detail, refs: [o.ref] })),
  }
}

export function briefingEmail(b: Briefing, v: BriefingView, note: string | null): { subject: string; text: string; html: string } {
  const items = new Map(all(b).map((i) => [i.ref, i]))
  const first = v.priorities.length
  const subject = `${b.person.name}’s briefing, ${b.today}: ${first ? `${first} thing${first === 1 ? '' : 's'} to do first` : 'nothing outstanding'}`
  const link = (refs: string[]) => items.get(refs[0])?.href ?? `${b.base}/admin`
  const list = (xs: Item[], empty: string) => (xs.length ? xs.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ''}`) : [`- ${empty}`])
  const text = [
    subject, '',
    'DO FIRST', ...(v.priorities.length ? v.priorities.map((p, n) => `${n + 1}. ${p.action}${p.why ? `: ${p.why}` : ''} ${link(p.refs)}`) : ['Nothing outstanding.']), '',
    `YESTERDAY (${b.day})`, ...(v.yesterday ? [v.yesterday, ''] : []),
    ...(v.discuss.length ? ['To discuss:', ...v.discuss.map((d) => `- ${d.point}`), ''] : []),
    'You sent and did:', ...list([...b.sent, ...b.activity], 'Nothing recorded.'), '',
    `Emails for you (${b.received.length}):`, ...list(b.received, 'None.'), '',
    `EVERYTHING THAT CAME IN (${b.inbox.length})`, ...(v.inbox ? [v.inbox, ''] : []), ...list(b.inbox.slice(0, 30), 'Nothing came in.'), '',
    `STILL OUTSTANDING (${b.outstanding.length})`, ...list(b.outstanding, 'Nothing.'), '',
    ...(note ? [note, ''] : []),
    'Made by the agents from the office mailbox and the portal. Calls that weren’t logged and WhatsApps from personal phones aren’t included.',
  ].join('\n')

  const h2 = 'font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#8a6d2b;margin:24px 0 8px'
  const li = (i: Item) => `<li style="margin:4px 0${i.urgent ? ';font-weight:bold' : ''}"><a href="${esc(i.href)}" style="color:#222">${esc(i.title)}</a>${i.detail ? ` <span style="color:#777">· ${esc(i.detail)}</span>` : ''}</li>`
  const ul = (xs: Item[], empty: string) => (xs.length ? `<ul style="margin:0;padding-left:20px">${xs.map(li).join('')}</ul>` : `<p style="margin:0;color:#777">${esc(empty)}</p>`)
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;margin:0 auto;line-height:1.5;font-size:14px">`
    + `<div style="border-bottom:3px solid #b08d3c;padding:0 0 12px"><div style="font-size:12px;color:#888;letter-spacing:.08em;text-transform:uppercase">Preston Hill Estates · Daily briefing</div><div style="font-size:20px;font-weight:bold;margin-top:4px">${esc(b.person.name)} · ${esc(b.today)}</div></div>`
    + `<h2 style="${h2}">Do first</h2>`
    + (v.priorities.length ? `<ol style="margin:0;padding-left:20px">${v.priorities.map((p) => `<li style="margin:6px 0"><a href="${esc(link(p.refs))}" style="color:#222;font-weight:bold">${esc(p.action)}</a>${p.why ? `<br><span style="color:#555">${esc(p.why)}</span>` : ''}</li>`).join('')}</ol>` : '<p style="margin:0">✓ Nothing outstanding.</p>')
    + `<h2 style="${h2}">Yesterday · ${esc(b.day)}</h2>`
    + (v.yesterday ? `<p style="margin:0 0 8px">${esc(v.yesterday)}</p>` : '')
    + (v.discuss.length ? `<div style="background:#faf6ec;border-radius:8px;padding:10px 14px;margin:8px 0"><b style="font-size:12px;color:#8a6d2b;text-transform:uppercase;letter-spacing:.06em">To discuss</b><ul style="margin:6px 0 0;padding-left:20px">${v.discuss.map((d) => `<li><a href="${esc(link(d.refs))}" style="color:#222">${esc(d.point)}</a></li>`).join('')}</ul></div>` : '')
    + `<p style="margin:10px 0 4px;font-weight:bold">You sent and did</p>${ul([...b.sent, ...b.activity], 'Nothing recorded.')}`
    + `<p style="margin:10px 0 4px;font-weight:bold">Emails for you (${b.received.length})</p>${ul(b.received, 'None.')}`
    + `<h2 style="${h2}">Everything that came in (${b.inbox.length})</h2>`
    + (v.inbox ? `<p style="margin:0 0 8px">${esc(v.inbox)}</p>` : '')
    + ul(b.inbox.slice(0, 30), 'Nothing came in.') + (b.inbox.length > 30 ? `<p style="color:#777;margin:4px 0 0">…and ${b.inbox.length - 30} more in the inbox.</p>` : '')
    + `<h2 style="${h2}">Still outstanding (${b.outstanding.length})</h2>${ul(b.outstanding, 'Nothing.')}`
    + (note ? `<p style="font-size:12px;color:#888;margin:16px 0 0">${esc(note)}</p>` : '')
    + `<p style="font-size:12px;color:#888;margin:18px 0 0">Made by the agents from the office mailbox and the portal. Calls that weren’t logged and WhatsApps from personal phones aren’t included.</p></div>`
  return { subject, text, html }
}
