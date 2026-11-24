import { describe, expect, it } from 'vitest'
import { briefingEmail, checkView, isFor, plainView, signedBy, unquoted, type Briefing } from './staff-briefing-rules'

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
  outstanding: [{ ref: 'T1', at: '', title: 'Overdue: call back Mrs Begum', detail: 'was due Mon 23 Nov, 16:00', href: 'https://x/my-day', urgent: true }],
}

describe('the sense-check on Claude’s summary', () => {
  it('keeps points that cite real items with real figures', () => {
    const { view, dropped } = checkView({ yesterday: 'You put David’s offer of £312,000 to the seller.', inbox: '1 email came in.', discuss: [{ point: 'Sarah wants 3pm', refs: ['R1'] }], priorities: [{ action: 'Call back Mrs Begum', why: 'Overdue since 16:00 yesterday', refs: ['T1'] }] }, b)
    expect(dropped).toBe(0)
    expect(view.priorities).toHaveLength(1)
    expect(view.yesterday).toMatch(/312,000/)
  })
  it('drops points that cite nothing real or invent a figure', () => {
    const { view, dropped } = checkView({ yesterday: 'You agreed a sale at £350,000.', inbox: '', discuss: [{ point: 'Chase the solicitor', refs: ['X9'] }], priorities: [{ action: 'Call Mrs Begum', why: 'She’s waited 9 days', refs: ['T1'] }, { action: 'Reply to Sarah', why: 'Viewing', refs: [] }] }, b)
    expect(dropped).toBe(4)
    expect(view.yesterday).toBe('')
    expect(view.discuss).toEqual([])
    expect(view.priorities).toEqual([])
  })
  it('the email has the subject, the sections and nothing broken', () => {
    const m = briefingEmail(b, plainView(b), null)
    expect(m.subject).toBe('Fred’s briefing, Tuesday 24 November: 1 thing to do first')
    for (const h of ['DO FIRST', 'YESTERDAY (Monday 23 November)', 'Emails for you (1):', 'EVERYTHING THAT CAME IN (1)', 'STILL OUTSTANDING (1)']) expect(m.text).toContain(h)
    expect(m.html).not.toMatch(/undefined|NaN|null/)
  })
})
