// The call script, personalised to one lead: their name, their home or the home they asked about, what we've
// already sent, their report, what they've already told us (so we never ask it twice) and two real free times
// from the diary. Staff tick through it, type the answers as they go, and finish the call from it.
// Kept free of server code so it's easy to test.

export type ScriptKind = 'valuation' | 'buyer' | 'tenant'

export type Slot = { date: string; time: string; label: string }

export type ScriptFacts = {
  kind: ScriptKind
  /** A rental valuation (landlord) rather than a sale. */
  letting: boolean
  /** Their first name ('' if we don't know it). */
  first: string
  /** The caller's first name. */
  me: string
  /** Their home (valuations). */
  address: string | null
  /** The home they asked about (buyers and tenants), e.g. "3 bed house, Kenton Road", and its price. */
  property: string | null
  price: string | null
  /** What we've sent them already. */
  sent: { email: boolean; whatsapp: boolean; letter: boolean; calls: number }
  /** Their property report: finalised (with the guide), being made, or not started. */
  report: { state: 'final' | 'draft' | 'none'; asking: number | null; low: number | null; high: number | null; views: number }
  /** What they've already told us, by question key (from their enquiry or an earlier call). */
  told: Record<string, string>
  /** Two real free times in the diary. */
  slots: Slot[]
  /** A visit or viewing already in the diary, e.g. "Tue 1 Dec at 11:00". */
  booked: string | null
}

export type Ask = { key: string; q: string; hint?: string; known?: string }
export type Step = { key: string; title: string; say?: string; tip?: string; asks?: Ask[] }
export type Script = {
  title: string
  goal: string
  /** Things to know before dialling (no figure yet, already booked, opened the report...). */
  heads: string[]
  steps: Step[]
  objections: { they: string; you: string }[]
  voicemail: string
  whatsapp: string
}

const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`
const PHONE = '020 8904 9005'

/** "an email and a WhatsApp", "a letter", or '' when nothing's gone yet. */
export function sentPhrase(s: ScriptFacts['sent']): string {
  const parts = [s.email ? 'an email' : null, s.whatsapp ? 'a WhatsApp' : null, s.letter ? 'a letter' : null].filter(Boolean) as string[]
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Tuesday 1 December at 11:00 or Wednesday 2 December at 5:30pm", or the blanks to fill. */
export function choices(slots: Slot[]): string {
  return slots.length >= 2 ? `${slots[0].label} or ${slots[1].label}` : slots.length === 1 ? `${slots[0].label} or [another day and time]` : '[day] at [time] or [day] at [time]'
}

// Which of their form's answers fill which question. The label of a form line is matched; the first match wins.
const TOLD_FROM_FORM: { key: string; label: RegExp }[] = [
  { key: 'when', label: /\b(when|timescale|time ?frame|timing|move date|moving date|how soon|available from)\b/i },
  { key: 'why', label: /\b(reason|why)\b/i },
  { key: 'where', label: /\b(moving to|where.*(go|move))\b/i },
  { key: 'home', label: /\b(bed(room)?s?|property type|type of property|type)\b/i },
  { key: 'agents', label: /\bagents?\b/i },
  { key: 'money', label: /\b(mortgage|finance|cash|funding)\b/i },
  { key: 'sell', label: /\b(position|home to sell|chain|currently)\b/i },
  { key: 'budget', label: /\b(budget|price range|max(imum)? price|rent range)\b/i },
  { key: 'areas', label: /\b(areas?|location)\b/i },
  { key: 'household', label: /\b(occupants|people|household|adults|children)\b/i },
  { key: 'pets', label: /\bpets?\b/i },
]

/** Their enquiry form's answers, put against the questions they answer. */
export function toldFromForm(lines: { label: string | null; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of lines) {
    if (!l.label || !l.value.trim() || /^(n\/?a|none|-|no answer)$/i.test(l.value.trim())) continue
    const hit = TOLD_FROM_FORM.find((t) => t.label.test(l.label!))
    if (!hit) continue
    const v = `${l.label}: ${l.value.trim()}`.slice(0, 200)
    out[hit.key] = out[hit.key] ? `${out[hit.key]}; ${v}` : v
  }
  return out
}

const ask = (f: ScriptFacts, key: string, q: string, hint?: string): Ask => ({ key, q, ...(hint ? { hint } : {}), ...(f.told[key] ? { known: f.told[key] } : {}) })

function hello(f: ScriptFacts, about: string): string {
  const who = f.first ? `Hi, is that ${f.first}?` : 'Hi, is that [their name]?'
  const sent = sentPhrase(f.sent)
  const after = sent ? ` I sent you ${sent}, and I wanted to say hello properly.` : ' I wanted to call you personally about it.'
  return `${who} It’s ${f.me || '[your name]'} from Preston Hill Estates on Preston Road. You asked us about ${about}.${after} Is now an OK time for a couple of minutes?`
}

function valuationScript(f: ScriptFacts): Script {
  const sell = f.letting ? 'letting' : 'selling'
  const home = f.address ?? 'your home'
  const final = f.report.state === 'final' && !!f.report.asking
  const guide = final ? `${gbp(f.report.asking!)}${f.report.low && f.report.high ? ` (range ${gbp(f.report.low)} to ${gbp(f.report.high)})` : ''}${f.letting ? ' a month' : ''}` : null
  const heads: string[] = []
  if (f.booked) heads.push(`A visit is already booked for ${f.booked}. This call is to confirm it and answer questions, not to book another.`)
  heads.push(final ? `Their report is finalised. If they ask, the guide from it is ${guide}.` : `Don’t quote a figure: their report ${f.report.state === 'draft' ? 'isn’t finalised yet' : 'hasn’t been made yet (the OnTheMarket guide is still to do)'}.`)
  if (final && f.report.views) heads.push(`They’ve opened their report ${f.report.views === 1 ? 'once' : `${f.report.views} times`}: ask what they thought (don’t say we can see it).`)
  if (f.sent.calls) heads.push(`We’ve called ${f.sent.calls === 1 ? 'once' : `${f.sent.calls} times`} before: check the earlier notes below.`)

  const steps: Step[] = [
    { key: 'open', title: 'Open warmly', say: hello(f, `valuing ${home}`), tip: 'Not a good time? “No problem, when’s better, later today or tomorrow?” Then finish the call as a call back, at exactly that time.' },
    { key: 'thanks', title: 'Thank them', say: 'Thanks for thinking of us. We’ve been on Preston Road since 2004, so we know your area really well.' },
  ]
  if (final) steps.push({ key: 'report', title: 'Their report', say: 'Did you get a chance to look at your property report? What did you think?', asks: [ask(f, 'report', 'What they thought of the report')] })
  steps.push({
    key: 'ask', title: 'Ask, then listen', tip: 'One at a time. Type what they say as they say it. If we already know, just check it’s still right.',
    asks: [
      ask(f, 'why', `“What’s got you thinking about ${sell}?”`),
      ask(f, 'when', `“When would you ideally like to ${f.letting ? 'have it let' : 'move, or have it on the market'}?”`),
      ...(f.letting ? [ask(f, 'tenants', '“Is it empty now, or is someone living there?”')] : [ask(f, 'where', '“Where are you hoping to move to? Have you found somewhere yet?”')]),
      ask(f, 'home', '“Tell me a bit about the home: how many bedrooms, and have you done any work to it?”'),
      ask(f, 'agents', '“Have you spoken to any other agents yet?”', 'Ask it lightly: it tells you how fast to move.'),
    ],
  })
  if (!f.booked) {
    steps.push(
      { key: 'offer', title: 'What we offer', say: `What I’d suggest is a quick visit, about 30 minutes, completely free and no obligation. We’ll look at what makes your home special, talk you through what similar homes nearby have actually ${f.letting ? 'let' : 'sold'} for, and how we’d ${f.letting ? 'let' : 'market'} it.${final ? '' : ' You’ll also get your personal property report.'}` },
      { key: 'book', title: 'Book it: two choices', say: `Would ${choices(f.slots)} suit you better?`, tip: f.slots.length ? 'These two times are free in your diary.' : 'Offer two real times from the diary, never “when are you free?”' },
    )
  }
  steps.push({ key: 'close', title: 'Confirm and close', say: `So that’s [day] at [time], at ${home}. You’ll get a confirmation email, and a reminder the day before. If anything changes, just call us on ${PHONE}.` })

  return {
    title: f.letting ? 'Rental valuation call' : 'Valuation call',
    goal: f.booked ? 'Confirm their visit and answer any questions.' : 'A booked visit. Failing that, the next step and a date for it.',
    heads, steps,
    objections: [
      { they: '“Just tell me roughly what it’s worth.”', you: final ? `“Your report puts the guide at ${guide}. The visit lets us firm that up, because condition and any work you’ve done make a real difference. Shall we find a time?”` : '“I’d rather not guess and give you the wrong number. Your report and a 30-minute visit give you a figure based on your actual home. Shall we find a time?”' },
      { they: '“An online valuation said £…”', you: '“Those are averages for the area. Things like condition, extensions and the layout can make a big difference, which is why seeing it matters.”' },
      { they: '“I’m not ready yet.”', you: '“That’s fine, there’s no rush. A lot of people like to know where they stand early so they can plan. Would a visit in a few weeks suit you better?” If still no: “Can I check in with you in a month?” (finish as Not ready yet).' },
      { they: '“We’ve already spoken to other agents.”', you: '“That makes sense. How did you find it? A second opinion costs you nothing, and we know your road well.”' },
      { they: '“What are your fees?”', you: '“It depends on the service that suits you, so I’ll talk you through it properly at the visit, with no obligation.”' },
      { they: '“Just email me something.”', you: '“Of course, I’ll send it now. Shall I also pencil in a visit? You can always move it.”' },
      { they: `“We’re not ${sell} any more.”`, you: '“Thanks for letting me know. Can I ask what changed?” Note the reason and finish as Not interested.' },
      { they: '“Please don’t call me again.”', you: '“I’m sorry to have bothered you. I’ll make sure we don’t.” Finish as Do not contact.' },
    ],
    voicemail: `Hi ${f.first || '[their name]'}, it’s ${f.me || '[your name]'} from Preston Hill Estates on Preston Road. I’m calling about valuing ${home}. I’ll send you a quick WhatsApp too. You can reach me on ${PHONE}. Thanks, speak soon.`,
    whatsapp: `Hi ${f.first || 'there'}, it’s ${f.me || 'the team'} from Preston Hill Estates. I just tried to call about valuing ${home}. Would a free 30-minute visit on ${choices(f.slots)} suit you? Or let me know a better time to call.`,
  }
}

function buyerScript(f: ScriptFacts): Script {
  const it = f.property ?? 'one of our homes'
  const heads: string[] = []
  if (f.booked) heads.push(`A viewing is already booked for ${f.booked}. This call is to confirm it and find out their position.`)
  if (f.price) heads.push(`${f.property ? `${f.property}: ` : ''}${f.price}.`)
  if (f.sent.calls) heads.push(`We’ve called ${f.sent.calls === 1 ? 'once' : `${f.sent.calls} times`} before: check the earlier notes below.`)
  const sent = sentPhrase(f.sent)
  const steps: Step[] = [
    { key: 'open', title: 'Open', say: `${f.first ? `Hi, is that ${f.first}?` : 'Hi, is that [their name]?'} It’s ${f.me || '[your name]'} from Preston Hill Estates. You asked about ${it}${sent ? `, and I sent you ${sent}. Have you had a chance to look?` : '. Is now an OK time for a couple of minutes?'}`, tip: 'Not a good time? Ask when’s better and finish the call as a call back.' },
    { key: 'after', title: 'What they’re after', asks: [ask(f, 'like', '“What do you like about it?”'), ask(f, 'budget', '“What are you looking for overall: area, bedrooms, budget?”')] },
    {
      key: 'position', title: 'Their position', tip: 'Ask each one politely and note the answer.',
      asks: [
        ask(f, 'money', '“Are you buying with a mortgage or cash?”'),
        ask(f, 'aip', '“Do you have a mortgage agreement in principle yet?”'),
        ask(f, 'sell', '“Do you have a home to sell, or are you renting at the moment?”', 'A home to sell is a valuation for us: see the next step.'),
      ],
    },
    { key: 'valuation', title: 'If they have a home to sell', say: '“Have you had it valued yet? We’d be happy to do that for free, and it puts you in a much stronger position when you make an offer.”', tip: 'Offer two times, and tick “They have a home to sell” when you finish, so it’s logged as a valuation lead.' },
  ]
  if (!f.booked) steps.push({ key: 'book', title: 'Book the viewing: two choices', say: `I can show you round on ${choices(f.slots)}. Which is better?`, tip: f.slots.length ? 'These two times are free in your diary.' : undefined })
  steps.push(
    { key: 'other', title: 'If this one isn’t right', say: '“No problem. Shall I let you know first when something that fits comes on?”', tip: 'Their budget, areas and bedrooms above are saved on their record for matching.' },
    { key: 'close', title: 'Confirm', say: `So that’s [day] at [time] at ${it}. You’ll get a confirmation, and if anything changes just call us on ${PHONE}.` },
  )
  return {
    title: 'Buyer call', goal: f.booked ? 'Confirm the viewing and learn their position.' : 'A booked viewing, and whether they have a home to sell.', heads, steps,
    objections: [
      { they: '“I’ll call you when I’m ready.”', you: '“Of course. Shall I send you new homes that fit what you’re after in the meantime?” Their requirements are saved when you finish.' },
      { they: '“Is the price negotiable?”', you: '“The seller will consider any serious offer. The best thing is to see it first; then I can talk you through how to put an offer in.”' },
      { they: '“Just email me the details.”', you: '“Of course, I’ll send them now. Shall I also pencil in a viewing? You can always move it.”' },
      { they: '“Please don’t call me again.”', you: '“I’m sorry to have bothered you. I’ll make sure we don’t.” Finish as Do not contact.' },
    ],
    voicemail: `Hi ${f.first || '[their name]'}, it’s ${f.me || '[your name]'} from Preston Hill Estates, about ${it}. I’d love to arrange a viewing for you. I’ll WhatsApp you some times, or call me on ${PHONE}. Thanks.`,
    whatsapp: `Hi ${f.first || 'there'}, it’s ${f.me || 'the team'} from Preston Hill Estates. I just tried to call about ${it}. I can show you round on ${choices(f.slots)}. Would either work?`,
  }
}

function tenantScript(f: ScriptFacts): Script {
  const it = f.property ?? 'one of our homes to rent'
  const heads: string[] = []
  if (f.booked) heads.push(`A viewing is already booked for ${f.booked}. This call is to confirm it and check they’re a good fit.`)
  if (f.price) heads.push(`${f.property ? `${f.property}: ` : ''}${f.price}.`)
  if (f.sent.calls) heads.push(`We’ve called ${f.sent.calls === 1 ? 'once' : `${f.sent.calls} times`} before: check the earlier notes below.`)
  const sent = sentPhrase(f.sent)
  const steps: Step[] = [
    { key: 'open', title: 'Open', say: `${f.first ? `Hi, is that ${f.first}?` : 'Hi, is that [their name]?'} It’s ${f.me || '[your name]'} from Preston Hill Estates. You asked about renting ${it}${sent ? `, and I sent you ${sent}. Have you had a chance to look?` : '. Is now an OK time for a couple of minutes?'}`, tip: 'Not a good time? Ask when’s better and finish the call as a call back.' },
    {
      key: 'after', title: 'What they need', asks: [
        ask(f, 'when', '“When are you looking to move in?”'),
        ask(f, 'budget', '“What’s your budget a month, and which areas suit you?”'),
        ask(f, 'household', '“Who would be living there with you?”'),
      ],
    },
    {
      key: 'position', title: 'Are they a good fit', tip: 'Polite and matter-of-fact: the landlord will ask, and it saves everyone a wasted viewing.',
      asks: [
        ask(f, 'work', '“Are you working at the moment? The referencing checks income, so it helps to know early.”'),
        ask(f, 'pets', '“Any pets?”'),
        ask(f, 'now', '“Are you renting now? Have you given notice yet?”'),
      ],
    },
  ]
  if (!f.booked) steps.push({ key: 'book', title: 'Book the viewing: two choices', say: `I can show you round on ${choices(f.slots)}. Which is better?`, tip: f.slots.length ? 'These two times are free in your diary.' : undefined })
  steps.push(
    { key: 'other', title: 'If this one isn’t right', say: '“No problem. Shall I let you know first when something that fits comes on?”', tip: 'Their budget and areas above are saved on their record for matching.' },
    { key: 'close', title: 'Confirm', say: `So that’s [day] at [time] at ${it}. You’ll get a confirmation, and if anything changes just call us on ${PHONE}.` },
  )
  return {
    title: 'Tenant call', goal: f.booked ? 'Confirm the viewing and check they’re a good fit.' : 'A booked viewing with someone who can pass referencing.', heads, steps,
    objections: [
      { they: '“Can the rent come down?”', you: '“I can put any offer to the landlord. The best thing is to see it first, then we can talk about it.”' },
      { they: '“What are the fees?”', you: '“There are no tenant fees. You’d pay a holding deposit of up to a week’s rent to reserve it, and a deposit of up to five weeks’ rent (six if the rent is over £50,000 a year), which is protected in a government scheme.”' },
      { they: '“Just email me the details.”', you: '“Of course, I’ll send them now. Shall I also pencil in a viewing? You can always move it.”' },
      { they: '“Please don’t call me again.”', you: '“I’m sorry to have bothered you. I’ll make sure we don’t.” Finish as Do not contact.' },
    ],
    voicemail: `Hi ${f.first || '[their name]'}, it’s ${f.me || '[your name]'} from Preston Hill Estates, about renting ${it}. I’d love to arrange a viewing for you. I’ll WhatsApp you some times, or call me on ${PHONE}. Thanks.`,
    whatsapp: `Hi ${f.first || 'there'}, it’s ${f.me || 'the team'} from Preston Hill Estates. I just tried to call about ${it}. I can show you round on ${choices(f.slots)}. Would either work?`,
  }
}

export function buildScript(f: ScriptFacts): Script {
  return f.kind === 'valuation' ? valuationScript(f) : f.kind === 'buyer' ? buyerScript(f) : tenantScript(f)
}

// ---------- After the call ----------

export const CALL_OUTCOMES = [
  { value: 'booked', label: 'Booked a visit or viewing' },
  { value: 'callback', label: 'Call them back' },
  { value: 'later', label: 'Not ready yet: check in later' },
  { value: 'spoke', label: 'Spoke to them, nothing to book' },
  { value: 'no-answer', label: 'No answer' },
  { value: 'lost', label: 'Not interested' },
  { value: 'dnc', label: 'Do not contact' },
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]['value']
export const isCallOutcome = (v: unknown): v is CallOutcome => CALL_OUTCOMES.some((o) => o.value === v)
export const outcomeLabel = (v: string | null | undefined) => CALL_OUTCOMES.find((o) => o.value === v)?.label ?? ''

/** The call's notes for the call log and timeline: each answer against its question, then the notes. */
export function callNotes(s: Script, answers: Record<string, string>, notes: string, outcome: CallOutcome, extra?: string): string {
  const qs = s.steps.flatMap((st) => st.asks ?? [])
  const lines = qs.filter((q) => answers[q.key]?.trim()).map((q) => `${q.q.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim()} ${answers[q.key].trim()}`)
  return [`${s.title}: ${outcomeLabel(outcome).toLowerCase()}${extra ? ` (${extra})` : ''}`, ...lines, notes.trim() ? `Notes: ${notes.trim()}` : ''].filter(Boolean).join('\n').slice(0, 4000)
}

/** The diary times to offer: the first free ones on working days (Monday to Saturday), from tomorrow, on two different days where possible. */
export function pickSlots(free: (date: string, time: string) => boolean, today: string, dayName: (date: string) => number, label: (date: string, time: string) => string, n = 2): Slot[] {
  const TIMES = ['10:00', '11:30', '14:00', '16:00', '17:30']
  const out: Slot[] = []
  const add = (d: string, k: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + k)).toISOString().slice(0, 10) }
  for (let i = 1; i <= 10 && out.length < n; i++) {
    const date = add(today, i)
    if (dayName(date) === 0) continue // Sunday
    // One per day, alternating morning and afternoon so the two choices feel different.
    const order = out.length % 2 === 0 ? TIMES : [...TIMES].reverse()
    const time = order.find((t) => free(date, t))
    if (time) out.push({ date, time, label: label(date, time) })
  }
  return out
}
