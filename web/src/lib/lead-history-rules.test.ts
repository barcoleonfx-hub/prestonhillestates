import { describe, expect, it } from 'vitest'
import { alreadyDone, type Touch } from './lead-history-rules'

const at = new Date('2026-11-20T10:00:00Z')
const o = { at, dueAt: '2026-11-20T10:00:00.000Z', startedAt: '2026-11-16T15:00:00Z' }
const t = (p: Partial<Touch>): Touch => ({ at: '2026-11-17T12:00:00Z', channel: 'email', by: 'staff', who: 'Sara', text: '', ...p })
const email = (key: string) => ({ key, channel: 'email' })

describe('the agents never repeat what’s been done', () => {
  it('skips the report email if anyone already sent the report, by email or WhatsApp', () => {
    expect(alreadyDone(email('rp1'), [t({ text: 'Your report https://www.prestonhillestates.com/report/abcdefgh1234' })], o)).toMatchObject({ do: 'skip', why: expect.stringMatching(/already sent by Sara on 17 Nov/) })
    expect(alreadyDone(email('rp1'), [t({ channel: 'whatsapp', text: 'WhatsApp sent: report\nhttps://x/report/abcdefgh1234' })], o)).toMatchObject({ do: 'skip' })
    expect(alreadyDone(email('rp1'), [], o)).toEqual({ do: 'go' })
  })
  it('skips the sold-prices email if sold prices were already sent', () => {
    expect(alreadyDone(email('em4'), [t({ text: 'Here’s what homes near you have sold for: https://www.prestonhillestates.com/sold-prices?postcode=HA3' })], o)).toMatchObject({ do: 'skip' })
  })
  it('waits 2 days after a colleague was in touch, then leaves it to them if they keep going', () => {
    const d = alreadyDone(email('em7'), [t({ at: '2026-11-19T16:00:00Z', channel: 'call' })], o)
    expect(d).toMatchObject({ do: 'wait', until: '2026-11-21T16:00:00.000Z', why: expect.stringMatching(/Sara was in touch by call/) })
    const late = { ...o, dueAt: '2026-11-10T10:00:00.000Z' }
    expect(alreadyDone(email('em7'), [t({ at: '2026-11-19T16:00:00Z' })], late)).toMatchObject({ do: 'skip' })
    // The agent's own emails don't hold it up (the usual day gap handles those).
    expect(alreadyDone(email('em7'), [t({ at: '2026-11-19T16:00:00Z', by: 'agent' })], o)).toEqual({ do: 'go' })
    // Nor does a letter in the post.
    expect(alreadyDone(email('em7'), [t({ at: '2026-11-19T16:00:00Z', channel: 'letter' })], o)).toEqual({ do: 'go' })
  })
  it('ticks off a WhatsApp or call already done by hand', () => {
    expect(alreadyDone({ key: 'wa0', channel: 'whatsapp' }, [t({ channel: 'whatsapp', at: '2026-11-16T16:00:00Z' })], { ...o, dueAt: '2026-11-16T10:00:00.000Z' })).toMatchObject({ do: 'done' })
    expect(alreadyDone({ key: 'call2', channel: 'call' }, [t({ channel: 'call', at: '2026-11-19T15:00:00Z' })], o)).toMatchObject({ do: 'done', why: expect.stringMatching(/Already called by Sara/) })
    // A call long before this step doesn't count for it.
    expect(alreadyDone({ key: 'call2', channel: 'call' }, [t({ channel: 'call', at: '2026-11-16T16:00:00Z' })], o)).toEqual({ do: 'go' })
  })
  it('skips a letter if one went in the last 10 days', () => {
    expect(alreadyDone({ key: 'lt14', channel: 'letter' }, [t({ channel: 'letter', at: '2026-11-17T09:00:00Z' })], o)).toMatchObject({ do: 'skip' })
    expect(alreadyDone({ key: 'lt14', channel: 'letter' }, [t({ channel: 'letter', at: '2026-11-01T09:00:00Z' })], o)).toEqual({ do: 'go' })
  })
})
