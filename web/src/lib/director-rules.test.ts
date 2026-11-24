import { describe, expect, it } from 'vitest'
import { directorEmail, needsYou, numbersIn, plainView, viewProblem, type DirectorFacts } from './director-rules'

const facts = (over: Partial<DirectorFacts> = {}): DirectorFacts => ({
  day: 'Tuesday 24 November 2026', base: 'https://www.prestonhillestates.com',
  leads: { valuations: 3, other: 5, list: [
    { id: 'a', name: 'Grace Agent', what: 'valuation request', home: '12 Gordon Avenue', at: '2026-11-24T06:00:00Z', contacted: false, waitingHours: 4 },
    { id: 'b', name: 'Jo Tester', what: 'valuation request', home: null, at: '2026-11-24T07:00:00Z', contacted: true, waitingHours: 0 },
  ] },
  valuations: { booked: 2, today: [{ time: '11:00', who: 'Kanti Patel', where: 'HA3 0PS' }] },
  guides: { missing: 1, draft: 0, finalised: 2 },
  letters: { prepared: 2, toPrint: 2, posted: 1 },
  emails: { sent: 6, held: 1, blocked: 1 },
  approvals: 1, whatsappsDue: 4, callsDue: 3, replies: 2,
  checks: { total: 10, passed: 8, held: 1, blocked: 1 },
  week: { valuations: 14, booked: 6, replies: 9, sent: 31 },
  spend: { yesterday: 0.42, month: 7.1, budget: 40 },
  ...over,
})

describe('the Director checks its own numbers', () => {
  it('reads numbers but not postcodes', () => {
    expect(numbersIn('3 leads, £1,250 and 7.1, near HA3 0PS, 24 hours')).toEqual([3, 1250, 7.1, 24])
  })
  it('accepts a view that only uses today’s figures', () => {
    expect(viewProblem({ headline: '3 new valuation leads, 2 booked.', view: 'Grace has waited 4 hours. 6 emails went, 1 was blocked.', next: ['Call Grace Agent now'] }, facts())).toBeNull()
  })
  it('drops a view that invents a number', () => {
    expect(viewProblem({ headline: '3 new valuation leads.', view: 'Conversion is up 37% this week.', next: [] }, facts())).toMatch(/37/)
  })
})

describe('needs you today', () => {
  it('puts waiting leads and missing guides first, and links each to the portal', () => {
    const t = needsYou(facts())
    expect(t[0].text).toMatch(/^Call Grace Agent .*waiting 4 hours/)
    expect(t[0].urgent).toBe(true)
    expect(t[1].text).toMatch(/Upload 1 OnTheMarket guide:/)
    expect(t.map((x) => x.text)).toEqual(expect.arrayContaining([expect.stringMatching(/Print and post 2 valuation letters/), expect.stringMatching(/Send 4 follow-up WhatsApps/), 'Valuation at 11:00: Kanti Patel, HA3 0PS']))
    expect(t.every((x) => x.href.startsWith('https://www.prestonhillestates.com/admin/'))).toBe(true)
  })
  it('is empty on a quiet day', () => {
    const quiet = facts({ leads: { valuations: 0, other: 0, list: [] }, valuations: { booked: 0, today: [] }, guides: { missing: 0, draft: 0, finalised: 0 }, letters: { prepared: 0, toPrint: 0, posted: 0 }, approvals: 0, whatsappsDue: 0, callsDue: 0 })
    expect(needsYou(quiet)).toEqual([])
    expect(directorEmail(quiet, plainView(quiet), null).subject).toBe('Daily report, Tuesday 24 November 2026: nothing waiting on you')
  })
})

describe('the email', () => {
  it('has the sense-check line, the scorecard and the plain view’s numbers all from the facts', () => {
    const f = facts()
    const v = plainView(f)
    expect(viewProblem(v, f)).toBeNull()
    const m = directorEmail(f, v, null)
    expect(m.subject).toBe('Daily report, Tuesday 24 November 2026: 7 for you today')
    expect(m.text).toContain('Sense-check: 10 agent actions checked. 8 passed, 1 held for approval, 1 blocked.')
    expect(m.text).toContain('New valuation leads: 3 / 14')
    expect(m.html).toContain('Director’s view')
    expect(m.html).not.toMatch(/undefined|NaN|null/)
  })
})
