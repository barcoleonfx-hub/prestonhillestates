// The Director's daily report: what it's made of, the check on its own commentary, and how the email looks.
// The numbers are always counted by code; Claude only writes the short "Director's view", and that is dropped if it
// quotes any number that isn't in the facts. Kept free of server code so it's easy to test.

export type LeadLine = { id: string; name: string; what: string; home: string | null; at: string; contacted: boolean; waitingHours: number }
export type DirectorFacts = {
  /** e.g. "Tuesday 24 November 2026" */
  day: string
  base: string
  leads: { valuations: number; other: number; list: LeadLine[] }
  valuations: { booked: number; today: { time: string; who: string; where: string }[] }
  guides: { missing: number; draft: number; finalised: number }
  letters: { prepared: number; toPrint: number; posted: number }
  emails: { sent: number; held: number; blocked: number }
  approvals: number
  whatsappsDue: number
  replies: number
  checks: { total: number; passed: number; held: number; blocked: number }
  week: { valuations: number; booked: number; replies: number; sent: number }
  spend: { yesterday: number; month: number; budget: number }
}
export type DirectorView = { headline: string; view: string; next: string[] }

/** Every number written in a piece of text (ignoring ones inside words and postcodes, like HA3). */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/(?<![A-Za-z\d])£?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![A-Za-z\d])/g)].map((m) => Number(m[1].replace(/,/g, '')))
}

/** The view may only use numbers the facts contain (or small counting words like "two"); null if it's fine. */
export function viewProblem(v: DirectorView, f: DirectorFacts): string | null {
  const allowed = new Set(numbersIn(JSON.stringify(f).replace(/"[a-z]+":/gi, ' ')))
  const used = numbersIn([v.headline, v.view, ...v.next].join(' '))
  const odd = used.filter((n) => !allowed.has(n))
  return odd.length ? `it quoted ${odd.join(', ')}, which isn’t in today’s figures` : null
}

export type Todo = { text: string; href: string; urgent?: boolean }
/** What a person has to do today, most urgent first. */
export function needsYou(f: DirectorFacts): Todo[] {
  const out: Todo[] = []
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  for (const l of f.leads.list.filter((l) => !l.contacted && l.waitingHours >= 2).slice(0, 5)) out.push({ text: `Call ${l.name} (${l.what}${l.home ? `, ${l.home}` : ''}): waiting ${l.waitingHours} hours with no reply from us`, href: `${f.base}/admin/enquiries/${l.id}`, urgent: true })
  if (f.guides.missing) out.push({ text: `Upload ${s(f.guides.missing, 'OnTheMarket guide')}: no report or letter can go without one`, href: `${f.base}/admin/agents#guides`, urgent: true })
  if (f.guides.draft) out.push({ text: `Finalise ${s(f.guides.draft, 'report')} (guide uploaded, price not confirmed)`, href: `${f.base}/admin/agents#guides` })
  if (f.letters.toPrint) out.push({ text: `Print and post ${s(f.letters.toPrint, 'valuation letter')}`, href: `${f.base}/admin/agents#letters` })
  if (f.approvals) out.push({ text: `Approve or reject ${s(f.approvals, 'email')} the sense-check held`, href: `${f.base}/admin/agents#approve` })
  if (f.whatsappsDue) out.push({ text: `Send ${s(f.whatsappsDue, 'follow-up WhatsApp')}`, href: `${f.base}/admin/follow-ups` })
  for (const v of f.valuations.today) out.push({ text: `Valuation at ${v.time}: ${v.who}${v.where ? `, ${v.where}` : ''}`, href: `${f.base}/admin/diary` })
  return out
}

/** The plain fallback when Claude can't write the view (or wrote one that failed its check). */
export function plainView(f: DirectorFacts): DirectorView {
  const todo = needsYou(f)
  const lead = f.leads.valuations ? `${f.leads.valuations} new valuation ${f.leads.valuations === 1 ? 'lead' : 'leads'}` : 'No new valuation leads'
  return {
    headline: `${lead}; ${todo.length ? `${todo.length} ${todo.length === 1 ? 'thing needs' : 'things need'} you today` : 'nothing waiting on you'}.`,
    view: [
      f.emails.sent ? `The agents sent ${f.emails.sent} follow-up ${f.emails.sent === 1 ? 'email' : 'emails'}, each sense-checked.` : 'No follow-up emails were due.',
      f.valuations.booked ? `${f.valuations.booked} ${f.valuations.booked === 1 ? 'valuation was' : 'valuations were'} booked.` : '',
      f.replies ? `${f.replies} ${f.replies === 1 ? 'person' : 'people'} replied.` : '',
    ].filter(Boolean).join(' '),
    next: todo.slice(0, 3).map((t) => t.text),
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const gbp = (n: number) => `£${n.toFixed(2)}`

/** The email itself: subject, plain text and HTML. */
export function directorEmail(f: DirectorFacts, v: DirectorView, note: string | null): { subject: string; text: string; html: string } {
  const todo = needsYou(f)
  const subject = `Daily report, ${f.day}: ${todo.length ? `${todo.length} for you today` : 'nothing waiting on you'}`
  const checkLine = f.checks.total
    ? `Sense-check: ${f.checks.total} agent ${f.checks.total === 1 ? 'action' : 'actions'} checked. ${f.checks.passed} passed, ${f.checks.held} held for approval, ${f.checks.blocked} blocked. Nothing went out unchecked.`
    : 'Sense-check: nothing needed checking.'
  const sections: { title: string; rows: [string, string | number][] }[] = [
    { title: 'Valuation agent', rows: [
      ['New valuation leads', f.leads.valuations], ['Valuations booked', f.valuations.booked], ['OnTheMarket guides finalised', f.guides.finalised],
      ['Guides still to upload', f.guides.missing], ['Valuation letters prepared', f.letters.prepared], ['Letters posted', f.letters.posted],
    ] },
    { title: 'Follow-ups', rows: [
      ['Other new enquiries', f.leads.other], ['Emails sent', f.emails.sent], ['Held for approval', f.emails.held], ['Blocked by the sense-check', f.emails.blocked], ['Replies from clients', f.replies],
    ] },
  ]
  const score: [string, number, number][] = [
    ['New valuation leads', f.leads.valuations, f.week.valuations], ['Valuations booked', f.valuations.booked, f.week.booked],
    ['Replies', f.replies, f.week.replies], ['Agent emails sent', f.emails.sent, f.week.sent],
  ]

  const text = [
    subject, '',
    v.headline, '', `DIRECTOR’S VIEW`, v.view, ...(v.next.length ? ['', 'Next:', ...v.next.map((n) => `- ${n}`)] : []), note ? `(${note})` : '', '',
    'NEEDS YOU TODAY', ...(todo.length ? todo.map((t) => `- ${t.text}: ${t.href}`) : ['- Nothing. Everything is up to date.']), '',
    ...sections.flatMap((s) => [s.title.toUpperCase(), ...s.rows.map(([k, n]) => `${k}: ${n}`), '']),
    'SCORECARD (last 24 hours / last 7 days)', ...score.map(([k, a, b]) => `${k}: ${a} / ${b}`), '',
    checkLine, '',
    `AI spend: ${gbp(f.spend.yesterday)} yesterday, ${gbp(f.spend.month)} of ${gbp(f.spend.budget)} this month.`,
    'Seller outreach and Marketing agents: not switched on yet.', '',
    `The agents’ desk: ${f.base}/admin/agents`,
  ].filter((l) => l !== null).join('\n')

  const td = 'padding:7px 0;border-bottom:1px solid #eee;font-size:14px'
  const h2 = 'font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#8a6d2b;margin:26px 0 8px'
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:620px;margin:0 auto;line-height:1.5">`
    + `<div style="border-bottom:3px solid #b08d3c;padding:0 0 12px"><div style="font-size:12px;color:#888;letter-spacing:.08em;text-transform:uppercase">Preston Hill Estates · Director’s daily report</div><div style="font-size:20px;font-weight:bold;margin-top:4px">${esc(f.day)}</div></div>`
    + `<p style="font-size:17px;font-weight:bold;margin:18px 0 6px">${esc(v.headline)}</p>`
    + `<div style="background:#faf6ec;border-radius:8px;padding:12px 16px"><div style="font-size:12px;color:#8a6d2b;font-weight:bold;text-transform:uppercase;letter-spacing:.06em">Director’s view</div><p style="margin:6px 0">${esc(v.view)}</p>`
    + (v.next.length ? `<ul style="margin:6px 0 0;padding-left:20px">${v.next.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '')
    + (note ? `<p style="font-size:12px;color:#888;margin:8px 0 0">${esc(note)}</p>` : '') + `</div>`
    + `<h2 style="${h2}">Needs you today</h2>`
    + (todo.length ? `<ol style="margin:0;padding-left:20px">${todo.map((t) => `<li style="margin:4px 0${t.urgent ? ';font-weight:bold' : ''}"><a href="${esc(t.href)}" style="color:#222">${esc(t.text)}</a></li>`).join('')}</ol>` : `<p style="margin:0">✓ Nothing. Everything is up to date.</p>`)
    + sections.map((s) => `<h2 style="${h2}">${esc(s.title)}</h2><table style="width:100%;border-collapse:collapse">${s.rows.map(([k, n]) => `<tr><td style="${td}">${esc(k)}</td><td style="${td};text-align:right;font-weight:bold">${n}</td></tr>`).join('')}</table>`).join('')
    + `<h2 style="${h2}">Scorecard</h2><table style="width:100%;border-collapse:collapse"><tr><td style="${td};color:#888"></td><td style="${td};color:#888;text-align:right">Last 24 hours</td><td style="${td};color:#888;text-align:right">Last 7 days</td></tr>`
    + score.map(([k, a, b]) => `<tr><td style="${td}">${esc(k)}</td><td style="${td};text-align:right;font-weight:bold">${a}</td><td style="${td};text-align:right">${b}</td></tr>`).join('') + `</table>`
    + `<p style="margin:22px 0 0;padding:10px 14px;background:#e7f3ec;border-radius:8px;font-size:13px;color:#24613f">${esc(checkLine)}</p>`
    + `<p style="font-size:12px;color:#888;margin:18px 0 0">AI spend: ${gbp(f.spend.yesterday)} yesterday, ${gbp(f.spend.month)} of ${gbp(f.spend.budget)} this month. Seller outreach and Marketing agents: not switched on yet.<br><a href="${esc(f.base)}/admin/agents" style="color:#8a6d2b">Open the agents’ desk</a></p></div>`
  return { subject, text, html }
}
