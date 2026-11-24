import { describe, expect, it } from 'vitest'
import { briefingEmail, checkSnapshot, checkView, isFor, plainSnapshot, signedBy, snapshotEmail, unquoted, type Briefing, type Snapshot } from './staff-briefing-rules'

const fred = ['Fred', 'Ferdous']

describe('whose email is it', () => {
  it('counts emails to their address, naming them, or greeting them', () => {
    expect(isFor({ toAddrs: 'fred@prestonhillestates.com', subject: 'Hello', body: 'Hi there' }, fred)).toBe(true)
    expect(isFor({ toAddrs: 'Ferdous Ali <ferdous.ali@prestonhillestates.com>', subject: 'x', body: 'y' }, fred)).toBe(true)
    expect(isFor({ toAddrs: 'info@prestonhillestates.com', subject: 'Viewing', body: 'Hi Ferdous, can we move it?' }, fred)).toBe(true)
    expect(isFor({ toAddrs: 'info@prestonhillestates.com', subject: 'Question for Fred', body: 'thanks' }, fred)).toBe(true)
  })
  it('doesn’t count other names, parts of words, or their name only in the quoted earlier email', () => {
    expect(isFor({ toAddrs: 'info@prestonhillestates.com', subject: 'Frederick Road viewing', body: 'Hi Moniba' }, fred)).toBe(false)
    expect(isFor({ toAddrs: 'info@prestonhillestates.com', subject: 'Re: viewing', body: 'Thanks, see you then.\n\nOn Mon 23 Nov 2026, Fred wrote:\n> Hi Sarah, booked for 2pm' }, fred)).toBe(false)
    expect(isFor({ toAddrs: 'info@prestonhillestates.com', subject: 'Re: viewing', body: 'Thanks!\n> Kind regards, Fred' }, fred)).toBe(false)
  })
  it('knows who signed an email sent from Apple Mail', () => {
    expect(signedBy('Hi Sarah,\n\nThat’s booked.\n\nKind regards,\nFerdous\nPreston Hill Estates', fred)).toBe(true)
    expect(signedBy('Hi Sarah,\n\nThat’s booked.\n\nBest wishes,\nMoniba\n\nOn Mon, Fred wrote:\n> earlier', fred)).toBe(false)
    expect(unquoted('New bit\n\n-----Original Message-----\nOld bit')).toBe('New bit')
  })
})

const b: Briefing = {
  person: { name: 'Fred', aliases: fred, to: 'fred@prestonhillestates.com' }, day: 'Monday 23 November', today: 'Tuesday 24 November', base: 'https://x',
  sent: [{ ref: 'S1', at: '', title: 'Emailed David: “Your offer on Flat 3”', detail: '15:10 · offer of £312,000', href: 'https://x/m/1' }],
  activity: [], received: [{ ref: 'R1', at: '', title: 'Sarah: “Viewing”', detail: '17:05 · could we make it 3pm?', href: 'https://x/m/2' }],
  inbox: [{ ref: 'I1', at: '', title: 'Sarah: “Viewing”', detail: '17:05 · could we make it 3pm?', href: 'https://x/m/2' }],
  outstanding: [{ ref: 'T1', at: '', title: 'Overdue: call back Mrs Begum', detail: 'was due Mon 23 Nov, 16:00', href: 'https://x/my-day', urgent: true, kind: 'callback' }],
}

describe('the sense-check on Claude’s summary', () => {
  it('keeps points that cite real items with real figures', () => {
    const { view, dropped } = checkView({ summary: 'You put David’s offer of £312,000 to the seller.', inbox: 'Sarah asked to move her viewing.', yesterday: 'You put the £312,000 offer to the seller.', waiting: 'Sarah is waiting on a new viewing time.', urgent: [{ text: 'Call back Mrs Begum', why: 'Overdue since 16:00 yesterday', refs: ['T1'] }] }, b)
    expect(dropped).toBe(0)
    expect(view.urgent).toHaveLength(1)
    expect(view.summary).toMatch(/312,000/)
  })
  it('drops points that cite nothing real or invent a figure', () => {
    const { view, dropped } = checkView({ summary: 'You agreed a sale at £350,000.', inbox: '', yesterday: 'You chased 7 solicitors.', waiting: '', urgent: [{ text: 'Call Mrs Begum', why: 'She’s waited 9 days', refs: ['T1'] }, { text: 'Reply to Sarah', why: 'Viewing', refs: [] }] }, b)
    expect(dropped).toBe(4)
    expect(view.summary).toBe('')
    expect(view.yesterday).toBe('')
    expect(view.urgent).toEqual([])
  })
  it('the email is a short summary, not lists of emails', () => {
    const m = briefingEmail(b, { summary: 'A quiet day.', urgent: [{ text: 'Call back Mrs Begum', why: 'Overdue', refs: ['T1'] }], yesterday: 'You put an offer to a seller.', waiting: '', inbox: '' }, null)
    expect(m.subject).toBe('Fred’s briefing, Tuesday 24 November: 1 to do first')
    expect(m.text).toContain('NEEDS ATTENTION NOW\n1. Call back Mrs Begum (Overdue) https://x/my-day')
    expect(m.text).toContain('YESTERDAY\nYou put an offer to a seller.')
    expect(m.text).toContain('STILL WAITING\n1 callback (1 overdue).')
    expect(m.text).not.toContain('could we make it 3pm')
    expect(m.html).not.toMatch(/undefined|NaN|null/)
  })
})

describe('the Director’s snapshot', () => {
  const mo: Briefing = { ...b, person: { name: 'Moniba', aliases: ['Moniba'], to: 'info@x' }, sent: [], received: [], inbox: [], activity: [{ ref: 'P2-A1', at: '', title: 'Called Priya Shah', detail: 'wants a valuation', href: 'https://x/c' }], outstanding: [] }
  const s: Snapshot = { me: { ...b, person: { name: 'Jamil', aliases: ['Jamil'], to: 'jamil@x', director: true }, sent: [], activity: [], received: [], outstanding: [] }, team: [b, mo], highValue: [{ ref: 'H1', at: '', title: 'Valuation: Hughes, guide £1,250,000', detail: 'visit booked', href: 'https://x/e', value: 1250000 }], day: b.day, today: b.today, base: 'https://x' }
  it('keeps one card per person, fills in anyone missed, and checks the high-value figures', () => {
    expect(checkSnapshot({ summary: 'A £1.25m valuation is in play.', urgent: [], team: [], highValue: [], mine: [] }, s).view.summary).toBe('A £1.25m valuation is in play.')
    expect(checkSnapshot({ summary: 'A £1.4m valuation is in play.', urgent: [], team: [], highValue: [], mine: [] }, s).view.summary).toBe('')
    const { view, dropped } = checkSnapshot({ summary: 'Busy day.', urgent: [], team: [{ name: 'Fred', did: 'Put an offer of £312,000 forward.', next: ['Call back Mrs Begum'], refs: ['T1'] }, { name: 'Somebody', did: 'x', next: ['y'], refs: [] }], highValue: [{ text: 'Hughes valuation at £1,250,000', refs: ['H1'] }, { text: 'A £2m sale', refs: ['H9'] }], mine: [] }, s)
    expect(view.team.map((t) => t.name)).toEqual(['Fred'])
    expect(view.highValue).toHaveLength(1)
    expect(dropped).toBe(1)
    const plain = plainSnapshot(s)
    expect(plain.team.map((t) => t.name)).toEqual(['Fred', 'Moniba'])
    expect(plain.team[1].did).toBe('Sent 0 emails and logged 1 call, note or visit yesterday.')
    const m = snapshotEmail(s, plain, null)
    expect(m.subject).toBe('Director’s snapshot, Tuesday 24 November: 1 urgent across the team')
    for (const h of ['NEEDS ATTENTION NOW', 'THE TEAM', 'Fred [1 overdue callback]', 'Moniba [On top of it]', 'WHERE THE MONEY IS', 'Valuation: Hughes, guide £1,250,000']) expect(m.text).toContain(h)
  })
})

describe('promises and overnight drafts in the briefing', () => {
  it('counts them, flags overdue promises and says so in words', async () => {
    const { statsOf, statusOf, waitingLine } = await import('./staff-briefing-rules')
    const withThem: Briefing = { ...b, outstanding: [
      { ref: 'P1', at: '', title: 'You promised Sam: send the contract', detail: 'was due Mon 23 Nov', href: 'x', urgent: true, kind: 'promise' },
      { ref: 'P2', at: '', title: 'You promised Jo: call back', detail: 'due today', href: 'x', kind: 'promise' },
      { ref: 'D1', at: '', title: 'Check and send the 3 replies drafted overnight', detail: '', href: 'x', kind: 'drafts', count: 3 },
    ] }
    const st = statsOf(withThem)
    expect(st.promises).toBe(2)
    expect(st.overduePromises).toBe(1)
    expect(st.drafts).toBe(3)
    expect(statusOf(st)).toEqual({ label: '1 promise overdue', tone: 'bad' })
    expect(waitingLine(st)).toBe('2 promises due (1 overdue), 3 replies drafted overnight to check')
  })
})
