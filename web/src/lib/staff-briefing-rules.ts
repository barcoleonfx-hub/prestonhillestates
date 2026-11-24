// The 10am staff briefing: a short summary for each person of what they did yesterday, what's most urgent and
// what's still waiting, and what mattered in the inbox (routine and automated emails left out). The Director gets a
// snapshot of the whole team and where the high-value work sits. Which emails are a person's: ones
// addressed to them or mentioning them (by any of their names), and ones they sent (from the portal, or from Apple
// Mail signed with their name). Claude writes the short summaries; every point must point at real items, and any
// number it uses must be in them, or that point is dropped. Kept free of server code so it's easy to test.

import { numbersIn } from './director-rules'

export type Person = { name: string; aliases: string[]; to: string; off?: boolean; /** Gets the Director's snapshot of the whole team instead of a personal briefing. */ director?: boolean }
export const DEFAULT_PEOPLE: Person[] = [
  { name: 'Fred', aliases: ['Fred', 'Ferdous'], to: 'fred@prestonhillestates.com' },
  { name: 'Moniba', aliases: ['Moniba'], to: 'info@prestonhillestates.com' },
  { name: 'Rahman', aliases: ['Rahman'], to: 'info@prestonhillestates.com' },
  { name: 'Jamil', aliases: ['Jamil'], to: 'jamil.preston@hotmail.com', director: true },
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

export type Item = {
  ref: string; at: string; title: string; detail: string; href: string; urgent?: boolean
  /** Automated, no reply needed, or a pitch or spam: left out of the summaries. */ routine?: boolean
  /** £, for high-value items. */ value?: number
  /** What sort of to-do: a reply someone's waiting for, a callback, a new lead, an appointment. */ kind?: 'reply' | 'callback' | 'lead' | 'appointment'
}
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
export type Point = { text: string; why?: string; refs: string[] }
export type BriefingView = { summary: string; urgent: Point[]; done: Point[]; pending: Point[]; inbox: string }

const itemsOf = (b: Briefing) => [...b.sent, ...b.activity, ...b.received, ...b.inbox, ...b.outstanding]

/** The counts behind a person's day, worked out (never written by Claude). */
export function statsOf(b: Briefing) {
  const o = b.outstanding
  const of = (k: Item['kind']) => o.filter((i) => i.kind === k)
  const replies = of('reply')
  return {
    sent: b.sent.length, activity: b.activity.length,
    replies: replies.length, overdueReplies: replies.filter((i) => i.urgent).length, oldestReply: replies.map((i) => i.at).sort()[0] ?? null,
    callbacks: of('callback').length, overdueCallbacks: of('callback').filter((i) => i.urgent).length,
    leads: of('lead').length, today: of('appointment').length,
    important: b.inbox.filter((i) => !i.routine).length, routine: b.inbox.filter((i) => i.routine).length,
  }
}
export type Stats = ReturnType<typeof statsOf>

/** On track, busy or behind: from the counts. */
export function statusOf(st: Stats): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (st.overdueCallbacks) return { label: `${st.overdueCallbacks} overdue callback${st.overdueCallbacks === 1 ? '' : 's'}`, tone: 'bad' }
  if (st.overdueReplies >= 3) return { label: `${st.overdueReplies} replies over 2 days late`, tone: 'bad' }
  if (st.leads) return { label: `${st.leads} new lead${st.leads === 1 ? '' : 's'} waiting`, tone: 'warn' }
  if (st.replies || st.callbacks) return { label: 'Busy', tone: 'warn' }
  return { label: 'On top of it', tone: 'ok' }
}

const dm = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One line of what's waiting on someone, in words. */
export function waitingLine(st: Stats): string {
  const parts = [
    st.replies ? `${plural(st.replies, 'email')} to reply to${st.overdueReplies ? ` (${st.overdueReplies} over 2 days, oldest ${dm(st.oldestReply!)})` : ''}` : null,
    st.callbacks ? `${plural(st.callbacks, 'callback')}${st.overdueCallbacks ? ` (${st.overdueCallbacks} overdue)` : ''}` : null,
    st.leads ? `${plural(st.leads, 'new lead')} not answered` : null,
    st.today ? `${plural(st.today, 'appointment')} today` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'nothing waiting'
}

/** Checks Claude's wording against the items: points must cite real items, and numbers must come from them. */
export function checker(items: Item[], extra: (string | number)[] = []) {
  const byRef = new Map(items.map((i) => [i.ref, i]))
  const source = [...extra.map(String), ...items.flatMap((i) => [i.title, i.detail, i.value != null ? String(i.value) : ''])].join(' ')
  const allowed = new Set([...numbersIn(source), ...extra.filter((x): x is number => typeof x === 'number')])
  let dropped = 0
  const numbersOk = (s: string) => numbersIn(s).every((n) => allowed.has(n))
  const text = (s: string) => (numbersOk(s) ? s : (dropped++, ''))
  const points = (xs: Point[], max: number) => xs.filter((p) => (p.refs.length && p.refs.every((r) => byRef.has(r)) && numbersOk(`${p.text} ${p.why ?? ''}`) ? true : (dropped++, false))).slice(0, max)
  return { text, points, dropped: () => dropped, byRef }
}
const statNumbers = (st: Stats) => Object.values(st).filter((x): x is number => typeof x === 'number')

export function checkView(v: BriefingView, b: Briefing): { view: BriefingView; dropped: number } {
  const c = checker(itemsOf(b), [b.day, b.today, ...statNumbers(statsOf(b)), b.outstanding.length, b.inbox.length])
  const view = { summary: c.text(v.summary), urgent: c.points(v.urgent, 5), done: c.points(v.done, 5), pending: c.points(v.pending, 4), inbox: c.text(v.inbox) }
  return { view, dropped: c.dropped() }
}

/** Without Claude: counts in words and the most urgent few. */
export function plainView(b: Briefing): BriefingView {
  const st = statsOf(b)
  const urgentFirst = [...b.outstanding].sort((x, y) => Number(!!y.urgent) - Number(!!x.urgent))
  return {
    summary: `Yesterday you sent ${plural(st.sent, 'email')} and logged ${plural(st.activity, 'call, note or visit', 'calls, notes or visits')}. Waiting on you: ${waitingLine(st)}.`,
    urgent: urgentFirst.slice(0, 5).map((i) => ({ text: i.title, why: i.detail, refs: [i.ref] })),
    done: [], pending: [],
    inbox: st.important ? `${plural(st.important, 'email')} came in that may need someone${st.routine ? `, plus ${st.routine} routine` : ''}.` : '',
  }
}

// ---------- the emails ----------

const H2 = 'font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:#8a6d2b;margin:24px 0 8px'
const TONE = { ok: 'background:#e7f3ec;color:#24613f', warn: 'background:#fdf3e1;color:#7a5410', bad: 'background:#fbe3d8;color:#8a2f1c' }
const head = (kicker: string, title: string) => `<div style="border-bottom:3px solid #b08d3c;padding:0 0 12px"><div style="font-size:12px;color:#888;letter-spacing:.08em;text-transform:uppercase">${esc(kicker)}</div><div style="font-size:20px;font-weight:bold;margin-top:4px">${esc(title)}</div></div>`
const shell = (inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;line-height:1.55;font-size:14px">${inner}</div>`
const foot = (s: string) => `<p style="font-size:12px;color:#888;margin:24px 0 0;border-top:1px solid #eee;padding-top:10px">${esc(s)}</p>`
const lead = (s: string) => `<p style="font-size:15px;margin:16px 0 0;padding:12px 14px;background:#faf6ec;border-radius:8px">${esc(s)}</p>`

function pointsHtml(xs: Point[], links: Map<string, Item>, ordered = false, bold = false): string {
  if (!xs.length) return ''
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag} style="margin:0;padding-left:20px">${xs.map((p) => {
    const href = links.get(p.refs[0])?.href
    const t = href ? `<a href="${esc(href)}" style="color:#222${bold ? ';font-weight:bold' : ''};text-decoration:none;border-bottom:1px solid #d8c58f">${esc(p.text)}</a>` : `<span${bold ? ' style="font-weight:bold"' : ''}>${esc(p.text)}</span>`
    return `<li style="margin:6px 0">${t}${p.why ? `<br><span style="color:#666;font-size:13px">${esc(p.why)}</span>` : ''}</li>`
  }).join('')}</${tag}>`
}
const pointsText = (xs: Point[], links: Map<string, Item>, ordered = false) => xs.map((p, i) => `${ordered ? `${i + 1}.` : '-'} ${p.text}${p.why ? ` (${p.why})` : ''}${links.get(p.refs[0]) ? ` ${links.get(p.refs[0])!.href}` : ''}`)

export function briefingEmail(b: Briefing, v: BriefingView, note: string | null): { subject: string; text: string; html: string } {
  const links = new Map(itemsOf(b).map((i) => [i.ref, i]))
  const st = statsOf(b)
  const subject = `${b.person.name}’s briefing, ${b.today}: ${v.urgent.length ? `${v.urgent.length} urgent` : 'nothing urgent'}`
  const tallyLine = `Covers ${b.day}. ${st.routine ? `${plural(st.routine, 'routine or automated email')} and any sales pitches left out.` : 'Sales pitches and automated emails left out.'}`
  const text = [
    subject, '', ...(v.summary ? [v.summary, ''] : []),
    'MOST URGENT', ...(v.urgent.length ? pointsText(v.urgent, links, true) : ['Nothing urgent.']), '',
    ...(v.done.length ? ['DONE YESTERDAY', ...pointsText(v.done, links), ''] : []),
    ...(v.pending.length ? ['STILL WAITING', ...pointsText(v.pending, links), ''] : []),
    `Waiting on you: ${waitingLine(st)}.`, '',
    ...(v.inbox ? ['IN THE INBOX', v.inbox, ''] : []),
    ...(note ? [note, ''] : []), tallyLine,
  ].join('\n')
  const html = shell(head('Preston Hill Estates · Daily briefing', `${b.person.name} · ${b.today}`)
    + (v.summary ? lead(v.summary) : '')
    + `<h2 style="${H2}">Most urgent</h2>` + (v.urgent.length ? pointsHtml(v.urgent, links, true, true) : '<p style="margin:0">✓ Nothing urgent.</p>')
    + (v.done.length ? `<h2 style="${H2}">Done yesterday</h2>${pointsHtml(v.done, links)}` : '')
    + (v.pending.length ? `<h2 style="${H2}">Still waiting</h2>${pointsHtml(v.pending, links)}` : '')
    + `<p style="margin:14px 0 0;color:#555"><b>Waiting on you:</b> ${esc(waitingLine(st))}.</p>`
    + (v.inbox ? `<h2 style="${H2}">In the inbox</h2><p style="margin:0">${esc(v.inbox)}</p>` : '')
    + (note ? `<p style="font-size:12px;color:#888;margin:14px 0 0">${esc(note)}</p>` : '')
    + foot(tallyLine))
  return { subject, text, html }
}

// ---------- the Director's snapshot ----------

export type Snapshot = { me: Briefing; team: Briefing[]; highValue: Item[]; day: string; today: string; base: string }
export type TeamLine = { name: string; did: string; next: string[]; refs: string[] }
export type SnapshotView = { summary: string; urgent: Point[]; team: TeamLine[]; highValue: Point[]; mine: Point[] }
const snapItems = (s: Snapshot) => [...itemsOf(s.me), ...s.team.flatMap(itemsOf), ...s.highValue]

export function checkSnapshot(v: SnapshotView, s: Snapshot): { view: SnapshotView; dropped: number } {
  const c = checker(snapItems(s), [s.day, s.today, ...s.team.flatMap((b) => statNumbers(statsOf(b))), ...statNumbers(statsOf(s.me)), s.highValue.length])
  const names = new Set(s.team.map((b) => b.person.name))
  const team = v.team.filter((t) => names.has(t.name)).map((t) => ({ name: t.name, did: c.text(t.did), next: t.next.map((n) => c.text(n)).filter(Boolean).slice(0, 3), refs: t.refs.filter((r) => c.byRef.has(r)) }))
  return { view: { summary: c.text(v.summary), urgent: c.points(v.urgent, 5), team, highValue: c.points(v.highValue, 5), mine: c.points(v.mine, 4) }, dropped: c.dropped() }
}

/** Everything due today across the team (appointments and callbacks), soonest first. */
export function dueToday(s: Snapshot): { who: string; item: Item }[] {
  return [s.me, ...s.team].flatMap((b) => b.outstanding.filter((o) => o.kind === 'appointment' || (o.kind === 'callback' && !o.urgent)).map((item) => ({ who: b.person.name, item })))
    .sort((a, b) => (a.item.at < b.item.at ? -1 : 1)).slice(0, 8)
}

/** Without Claude: the picture in words from the counts, each person's line, and the biggest values. */
export function plainSnapshot(s: Snapshot): SnapshotView {
  const all = s.team.map((b) => ({ b, st: statsOf(b) }))
  const sum = (k: keyof Stats) => all.reduce((n, x) => n + (Number(x.st[k]) || 0), 0)
  const urgentItems = s.team.flatMap((b) => b.outstanding.filter((o) => o.urgent).map((o) => ({ b, o })))
    .sort((x, y) => ({ callback: 0, lead: 1, reply: 2, appointment: 3 }[x.o.kind ?? 'reply'] - { callback: 0, lead: 1, reply: 2, appointment: 3 }[y.o.kind ?? 'reply']) || (x.o.at < y.o.at ? -1 : 1))
  return {
    summary: `Across the team: ${plural(sum('replies'), 'email')} waiting for a reply (${sum('overdueReplies')} over 2 days), ${plural(sum('overdueCallbacks'), 'overdue callback')}, ${plural(sum('leads'), 'new lead')} not answered and ${plural(sum('today'), 'appointment')} today.${s.highValue.length ? ` ${plural(s.highValue.length, 'high-value item')} in play.` : ''}`,
    urgent: urgentItems.slice(0, 5).map(({ b, o }) => ({ text: `${b.person.name}: ${o.title}`, why: o.detail, refs: [o.ref] })),
    team: all.map(({ b, st }) => ({
      name: b.person.name,
      did: st.sent || st.activity ? `Sent ${plural(st.sent, 'email')} and logged ${plural(st.activity, 'call, note or visit', 'calls, notes or visits')} yesterday.` : 'Nothing recorded yesterday (no emails sent from the office mailbox, no calls or notes logged).',
      next: b.outstanding.slice(0, 2).map((o) => o.title),
      refs: b.outstanding.slice(0, 2).map((o) => o.ref),
    })),
    highValue: s.highValue.slice(0, 5).map((h) => ({ text: h.title, why: h.detail, refs: [h.ref] })),
    mine: s.me.outstanding.slice(0, 3).map((o) => ({ text: o.title, why: o.detail, refs: [o.ref] })),
  }
}

export function snapshotEmail(s: Snapshot, v: SnapshotView, note: string | null): { subject: string; text: string; html: string } {
  const links = new Map(snapItems(s).map((i) => [i.ref, i]))
  const due = dueToday(s)
  const subject = `Director’s snapshot, ${s.today}: ${v.urgent.length ? `${v.urgent.length} urgent across the team` : 'nothing urgent'}`
  const byName = new Map(s.team.map((b) => [b.person.name, b]))
  const text = [
    subject, '', ...(v.summary ? [v.summary, ''] : []),
    'NEEDS ATTENTION NOW', ...(v.urgent.length ? pointsText(v.urgent, links, true) : ['Nothing urgent.']), '',
    ...(due.length ? ['DUE TODAY', ...due.map((d) => `- ${d.who}: ${d.item.title}${d.item.detail ? ` (${d.item.detail})` : ''}`), ''] : []),
    'THE TEAM', ...v.team.flatMap((t) => { const st = statsOf(byName.get(t.name)!); return [`${t.name} [${statusOf(st).label}]`, `  Yesterday: ${t.did}`, ...t.next.map((n) => `  Next: ${n}`), `  Waiting on them: ${waitingLine(st)}.`] }), '',
    ...(v.highValue.length ? ['WHERE THE MONEY IS', ...pointsText(v.highValue, links), ''] : []),
    ...(v.mine.length ? ['FOR YOU', ...pointsText(v.mine, links), ''] : []),
    ...(note ? [note, ''] : []),
    `Covers ${s.day}. Sales pitches, spam and automated emails left out.`,
  ].join('\n')
  const card = (t: TeamLine) => {
    const b = byName.get(t.name)!
    const st = statsOf(b)
    const status = statusOf(st)
    return `<div style="border:1px solid #ece6d6;border-radius:10px;padding:12px 16px;margin:0 0 10px">`
      + `<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td style="font-size:16px;font-weight:bold">${esc(t.name)}</td><td align="right"><span style="font-size:12px;font-weight:bold;padding:3px 10px;border-radius:999px;${TONE[status.tone]}">${esc(status.label)}</span></td></tr></table>`
      + `<p style="margin:6px 0 0"><b style="color:#8a6d2b">Yesterday</b> ${esc(t.did)}</p>`
      + (t.next.length ? `<p style="margin:6px 0 2px"><b style="color:#8a6d2b">Next</b></p><ul style="margin:0;padding-left:20px">${t.next.map((n, i) => { const h = t.refs[i] ? links.get(t.refs[i])?.href : undefined; return `<li style="margin:2px 0">${h ? `<a href="${esc(h)}" style="color:#222;text-decoration:none;border-bottom:1px solid #d8c58f">${esc(n)}</a>` : esc(n)}</li>` }).join('')}</ul>` : '')
      + `<p style="margin:8px 0 0;font-size:12px;color:#777">Waiting on ${esc(t.name)}: ${esc(waitingLine(st))} · Yesterday: ${plural(st.sent, 'email')} sent, ${plural(st.activity, 'call or note', 'calls or notes')}</p></div>`
  }
  const html = shell(head('Preston Hill Estates · Director’s snapshot', s.today)
    + (v.summary ? lead(v.summary) : '')
    + `<h2 style="${H2}">Needs attention now</h2>` + (v.urgent.length ? pointsHtml(v.urgent, links, true, true) : '<p style="margin:0">✓ Nothing urgent.</p>')
    + (due.length ? `<h2 style="${H2}">Due today</h2><ul style="margin:0;padding-left:20px">${due.map((d) => `<li style="margin:3px 0"><b>${esc(d.who)}:</b> <a href="${esc(d.item.href)}" style="color:#222;text-decoration:none;border-bottom:1px solid #d8c58f">${esc(d.item.title)}</a>${d.item.detail ? ` <span style="color:#777">· ${esc(d.item.detail)}</span>` : ''}</li>`).join('')}</ul>` : '')
    + `<h2 style="${H2}">The team</h2>${v.team.map(card).join('')}`
    + (v.highValue.length ? `<h2 style="${H2}">Where the money is</h2>${pointsHtml(v.highValue, links)}` : '')
    + (v.mine.length ? `<h2 style="${H2}">For you</h2>${pointsHtml(v.mine, links)}` : '')
    + (note ? `<p style="font-size:12px;color:#888;margin:14px 0 0">${esc(note)}</p>` : '')
    + foot(`Covers ${s.day}. Sales pitches, spam and automated emails left out.`))
  return { subject, text, html }
}
