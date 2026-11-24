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

export type Item = { ref: string; at: string; title: string; detail: string; href: string; urgent?: boolean; /** Automated or no reply needed. */ routine?: boolean; /** £, for high-value items. */ value?: number }
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

export function checkView(v: BriefingView, b: Briefing): { view: BriefingView; dropped: number } {
  const items = itemsOf(b)
  const c = checker(items, [b.day, b.today, b.outstanding.length, b.sent.length, b.activity.length, b.received.length, b.inbox.length, b.inbox.filter((i) => !i.routine).length])
  const view = { summary: c.text(v.summary), urgent: c.points(v.urgent, 5), done: c.points(v.done, 6), pending: c.points(v.pending, 6), inbox: c.text(v.inbox) }
  return { view, dropped: c.dropped() }
}

/** Without Claude: the outstanding items as they are, most urgent first. */
export function plainView(b: Briefing): BriefingView {
  const o = b.outstanding.map((i) => ({ text: i.title, why: i.detail, refs: [i.ref] }))
  return { summary: '', urgent: o.slice(0, 5), done: [], pending: o.slice(5, 11), inbox: '' }
}

// ---------- the emails ----------

const H2 = 'font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:#8a6d2b;margin:22px 0 8px'
const head = (kicker: string, title: string) => `<div style="border-bottom:3px solid #b08d3c;padding:0 0 12px"><div style="font-size:12px;color:#888;letter-spacing:.08em;text-transform:uppercase">${esc(kicker)}</div><div style="font-size:20px;font-weight:bold;margin-top:4px">${esc(title)}</div></div>`
const shell = (inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;line-height:1.55;font-size:14px">${inner}</div>`
const foot = (s: string) => `<p style="font-size:12px;color:#888;margin:22px 0 0;border-top:1px solid #eee;padding-top:10px">${esc(s)}</p>`

function pointsHtml(xs: Point[], links: Map<string, Item>, ordered = false, bold = false): string {
  if (!xs.length) return ''
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag} style="margin:0;padding-left:20px">${xs.map((p) => {
    const href = links.get(p.refs[0])?.href
    const t = href ? `<a href="${esc(href)}" style="color:#222${bold ? ';font-weight:bold' : ''}">${esc(p.text)}</a>` : esc(p.text)
    return `<li style="margin:5px 0">${t}${p.why ? `<br><span style="color:#666">${esc(p.why)}</span>` : ''}</li>`
  }).join('')}</${tag}>`
}
const pointsText = (xs: Point[], links: Map<string, Item>, ordered = false) => xs.map((p, i) => `${ordered ? `${i + 1}.` : '-'} ${p.text}${p.why ? `: ${p.why}` : ''}${links.get(p.refs[0]) ? ` ${links.get(p.refs[0])!.href}` : ''}`)

const tally = (b: Briefing) => {
  const routine = b.inbox.filter((i) => i.routine).length
  return `From ${b.inbox.length} email${b.inbox.length === 1 ? '' : 's'} in${routine ? ` (${routine} routine or automated, left out)` : ''}, ${b.sent.length} sent by ${b.person.name} and ${b.activity.length} call${b.activity.length === 1 ? '' : 's'}, note${b.activity.length === 1 ? '' : 's'} and visit${b.activity.length === 1 ? '' : 's'}.`
}

export function briefingEmail(b: Briefing, v: BriefingView, note: string | null): { subject: string; text: string; html: string } {
  const links = new Map(itemsOf(b).map((i) => [i.ref, i]))
  const subject = `${b.person.name}’s briefing, ${b.today}: ${v.urgent.length ? `${v.urgent.length} urgent` : 'nothing urgent'}`
  const text = [
    subject, '', ...(v.summary ? [v.summary, ''] : []),
    'MOST URGENT', ...(v.urgent.length ? pointsText(v.urgent, links, true) : ['Nothing urgent.']), '',
    ...(v.done.length ? [`DONE YESTERDAY (${b.day})`, ...pointsText(v.done, links), ''] : []),
    ...(v.pending.length ? ['STILL WAITING', ...pointsText(v.pending, links), ''] : []),
    ...(v.inbox ? ['IN THE INBOX', v.inbox, ''] : []),
    ...(note ? [note, ''] : []), tally(b),
  ].join('\n')
  const html = shell(head('Preston Hill Estates · Daily briefing', `${b.person.name} · ${b.today}`)
    + (v.summary ? `<p style="font-size:15px;margin:16px 0 0">${esc(v.summary)}</p>` : '')
    + `<h2 style="${H2}">Most urgent</h2>` + (v.urgent.length ? pointsHtml(v.urgent, links, true, true) : '<p style="margin:0">✓ Nothing urgent.</p>')
    + (v.done.length ? `<h2 style="${H2}">Done yesterday</h2>${pointsHtml(v.done, links)}` : '')
    + (v.pending.length ? `<h2 style="${H2}">Still waiting</h2>${pointsHtml(v.pending, links)}` : '')
    + (v.inbox ? `<h2 style="${H2}">In the inbox</h2><p style="margin:0">${esc(v.inbox)}</p>` : '')
    + (note ? `<p style="font-size:12px;color:#888;margin:14px 0 0">${esc(note)}</p>` : '')
    + foot(tally(b)))
  return { subject, text, html }
}

// ---------- the Director's snapshot ----------

export type Snapshot = { me: Briefing; team: Briefing[]; highValue: Item[]; day: string; today: string; base: string }
export type SnapshotView = {
  summary: string
  urgent: Point[]
  team: { name: string; did: string; outstanding: string; refs: string[] }[]
  highValue: Point[]
  mine: Point[]
}
const snapItems = (s: Snapshot) => [...itemsOf(s.me), ...s.team.flatMap(itemsOf), ...s.highValue]

export function checkSnapshot(v: SnapshotView, s: Snapshot): { view: SnapshotView; dropped: number } {
  const counts = s.team.flatMap((b) => [b.outstanding.length, b.sent.length, b.activity.length, b.received.length, b.outstanding.filter((o) => o.urgent).length])
  const c = checker(snapItems(s), [s.day, s.today, ...counts, s.me.inbox.length, s.highValue.length])
  const names = new Set(s.team.map((b) => b.person.name))
  const team = v.team.filter((t) => names.has(t.name)).map((t) => ({ ...t, did: c.text(t.did), outstanding: c.text(t.outstanding), refs: t.refs.filter((r) => c.byRef.has(r)) }))
  return { view: { summary: c.text(v.summary), urgent: c.points(v.urgent, 5), team, highValue: c.points(v.highValue, 6), mine: c.points(v.mine, 5) }, dropped: c.dropped() }
}

/** Without Claude: counts and the top item for each person, and the high-value list by value. */
export function plainSnapshot(s: Snapshot): SnapshotView {
  return {
    summary: '',
    urgent: s.team.flatMap((b) => b.outstanding.filter((o) => o.urgent).map((o) => ({ text: `${b.person.name}: ${o.title}`, why: o.detail, refs: [o.ref] }))).slice(0, 5),
    team: s.team.map((b) => ({
      name: b.person.name,
      did: `${b.sent.length} email${b.sent.length === 1 ? '' : 's'} sent, ${b.activity.length} call${b.activity.length === 1 ? '' : 's'}, note${b.activity.length === 1 ? '' : 's'} or visit${b.activity.length === 1 ? '' : 's'}.`,
      outstanding: b.outstanding.length ? `${b.outstanding.length} outstanding, first: ${b.outstanding[0].title}.` : 'Nothing outstanding.',
      refs: b.outstanding[0] ? [b.outstanding[0].ref] : [],
    })),
    highValue: s.highValue.slice(0, 6).map((h) => ({ text: h.title, why: h.detail, refs: [h.ref] })),
    mine: s.me.outstanding.slice(0, 5).map((o) => ({ text: o.title, why: o.detail, refs: [o.ref] })),
  }
}

export function snapshotEmail(s: Snapshot, v: SnapshotView, note: string | null): { subject: string; text: string; html: string } {
  const links = new Map(snapItems(s).map((i) => [i.ref, i]))
  const subject = `Director’s snapshot, ${s.today}: ${v.urgent.length ? `${v.urgent.length} urgent across the team` : 'nothing urgent'}`
  const text = [
    subject, '', ...(v.summary ? [v.summary, ''] : []),
    'MOST URGENT', ...(v.urgent.length ? pointsText(v.urgent, links, true) : ['Nothing urgent.']), '',
    'THE TEAM', ...v.team.flatMap((t) => [`${t.name}: ${t.did}`, `  Outstanding: ${t.outstanding}`]), '',
    ...(v.highValue.length ? ['HIGH-VALUE ITEMS', ...pointsText(v.highValue, links), ''] : []),
    ...(v.mine.length ? ['YOUR OWN', ...pointsText(v.mine, links), ''] : []),
    ...(note ? [note, ''] : []),
    `Covers ${s.day}. Routine and automated emails left out.`,
  ].join('\n')
  const card = (t: SnapshotView['team'][number]) => {
    const href = t.refs[0] ? links.get(t.refs[0])?.href : undefined
    return `<div style="border:1px solid #eee;border-radius:8px;padding:10px 14px;margin:0 0 8px"><b style="font-size:15px">${esc(t.name)}</b><p style="margin:4px 0 0">${esc(t.did)}</p><p style="margin:4px 0 0;color:#555"><b style="color:#8a6d2b">Outstanding:</b> ${href ? `<a href="${esc(href)}" style="color:#555">${esc(t.outstanding)}</a>` : esc(t.outstanding)}</p></div>`
  }
  const html = shell(head('Preston Hill Estates · Director’s snapshot', s.today)
    + (v.summary ? `<p style="font-size:15px;margin:16px 0 0">${esc(v.summary)}</p>` : '')
    + `<h2 style="${H2}">Most urgent</h2>` + (v.urgent.length ? pointsHtml(v.urgent, links, true, true) : '<p style="margin:0">✓ Nothing urgent.</p>')
    + `<h2 style="${H2}">The team</h2>${v.team.map(card).join('')}`
    + (v.highValue.length ? `<h2 style="${H2}">High-value items</h2>${pointsHtml(v.highValue, links)}` : '')
    + (v.mine.length ? `<h2 style="${H2}">Your own</h2>${pointsHtml(v.mine, links)}` : '')
    + (note ? `<p style="font-size:12px;color:#888;margin:14px 0 0">${esc(note)}</p>` : '')
    + foot(`Covers ${s.day}. Routine and automated emails left out.`))
  return { subject, text, html }
}
