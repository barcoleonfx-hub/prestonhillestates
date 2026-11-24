// Before an agent does a step, it looks at everything already done for that person, by anyone, on any channel
// (emails from the portal or Apple Mail, WhatsApps, calls, letters), so it never repeats what a colleague has
// already done. Kept free of server code so it's easy to test.

export type Touch = {
  at: string
  channel: 'email' | 'whatsapp' | 'call' | 'letter'
  /** "agent" for the agents' own automatic work; "staff" for anything a person did. */
  by: 'agent' | 'staff'
  who?: string | null
  /** Subject and wording, where we have it (to see what was already sent). */
  text: string
}
export type Decision = { do: 'go' } | { do: 'skip' | 'done'; why: string } | { do: 'wait'; until: string; why: string }

const HOUR = 3600e3
const DAY = 24 * HOUR
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })
const byWho = (t: Touch) => (t.by === 'agent' ? 'the agent' : t.who || 'the office')

/** A personal property report link (by email or WhatsApp). */
export const SENT_REPORT = /\/report\/[\w-]{6,}/
/** The sold-prices page or a list of sold prices. */
export const SENT_SOLD = /\/sold-prices|have (actually )?sold for|recent(ly)? sold/i

/** A person (not the agents) has been in touch this recently: the agents' emails wait so nobody gets two at once. */
export const STAFF_GAP_HOURS = 48
/** If staff keep being in touch for this long past the step's day, the agent leaves the step to them. */
export const GIVE_WAY_DAYS = 7

export function alreadyDone(step: { key: string; channel: string }, touches: Touch[], o: { at: Date; dueAt: string; startedAt: string }): Decision {
  const since = (iso: string) => touches.filter((t) => t.at >= iso)
  const latest = (ts: Touch[]) => ts.sort((a, b) => (a.at < b.at ? 1 : -1))[0]

  if (step.channel === 'whatsapp') {
    const from = new Date(Math.max(Date.parse(o.startedAt), Date.parse(o.dueAt) - 3 * DAY)).toISOString()
    const wa = latest(since(from).filter((t) => t.channel === 'whatsapp'))
    return wa ? { do: 'done', why: `Already sent on WhatsApp by ${byWho(wa)} on ${day(wa.at)}` } : { do: 'go' }
  }
  if (step.channel === 'call') {
    const from = new Date(Math.max(Date.parse(o.startedAt), Date.parse(o.dueAt) - DAY)).toISOString()
    const call = latest(since(from).filter((t) => t.channel === 'call'))
    return call ? { do: 'done', why: `Already called by ${byWho(call)} on ${day(call.at)}` } : { do: 'go' }
  }
  if (step.channel === 'letter') {
    const letter = latest(touches.filter((t) => t.channel === 'letter' && o.at.getTime() - Date.parse(t.at) < 10 * DAY))
    return letter ? { do: 'skip', why: `A letter already went on ${day(letter.at)}` } : { do: 'go' }
  }

  // Emails: what's already been sent, then whether a person is in touch right now.
  if (step.key === 'rp1') {
    const r = latest(touches.filter((t) => SENT_REPORT.test(t.text)))
    if (r) return { do: 'skip', why: `Their report was already sent by ${byWho(r)} on ${day(r.at)}` }
  }
  if (step.key === 'em4' || step.key === 'em5') {
    const s = latest(touches.filter((t) => t.channel !== 'letter' && SENT_SOLD.test(t.text)))
    if (s) return { do: 'skip', why: `Sold prices were already sent by ${byWho(s)} on ${day(s.at)}` }
  }
  const staff = latest(touches.filter((t) => t.by === 'staff' && t.channel !== 'letter'))
  if (staff && o.at.getTime() - Date.parse(staff.at) < STAFF_GAP_HOURS * HOUR) {
    if (o.at.getTime() - Date.parse(o.dueAt) > GIVE_WAY_DAYS * DAY) return { do: 'skip', why: `${byWho(staff)} ${staff.by === 'staff' ? 'is' : 'was'} in touch with them, so the agent left this one` }
    return { do: 'wait', until: new Date(Date.parse(staff.at) + STAFF_GAP_HOURS * HOUR).toISOString(), why: `${byWho(staff)} was in touch by ${staff.channel} on ${day(staff.at)}: waiting 2 days so they don’t get two at once` }
  }
  return { do: 'go' }
}
