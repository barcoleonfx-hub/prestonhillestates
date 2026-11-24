// The sense-check every agent message passes before it goes: fixed rules about the person (asked to stop, too many
// messages, already booked) and about the wording (blanks, the wrong name, a price that isn't the finalised
// OnTheMarket guide, a report without one, links to strange sites). Kept free of server code so it's easy to test.
//
// The verdict: "block" — it must never go (a rule about the person, or a valuation figure without the guide);
// "hold" — a person looks first (it waits in Needs approval); "pass" — it goes.

export type Check = { name: string; ok: boolean; note?: string; /** A failed "block" check stops it for good; anything else holds it for a person. */ level?: 'block' | 'hold' }
export type Verdict = 'pass' | 'hold' | 'block'

export function verdictOf(checks: Check[]): Verdict {
  if (checks.some((c) => !c.ok && c.level === 'block')) return 'block'
  return checks.some((c) => !c.ok) ? 'hold' : 'pass'
}

export type DraftFacts = {
  /** The first name we'd greet them by ('' when we don't have a real one). */
  first: string
  postcode: string | null
  /** The finalised guide's figures (guide price, range, rent): the only prices a message may quote. */
  prices: number[]
  /** The report is finalised from an OnTheMarket guide under 3 months old. */
  reportFinal: boolean
  /** Our own website's host(s). */
  ourHosts: string[]
}

/** Sites a message may link to besides our own. */
const TRUSTED = ['prestonhillestates.com', 'onthemarket.com', 'g.page', 'google.com', 'goo.gl', 'wa.me', 'gov.uk']

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }
const trusted = (host: string, ours: string[]) => [...ours.map((h) => h.toLowerCase().replace(/^www\./, '')), ...TRUSTED].some((t) => host === t || host.endsWith(`.${t}`))

/** Every price in a message, in pounds: £475,000, £475k, £1.2m, £1,850 pcm. */
export function pricesIn(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/£\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|million)?\b/gi)) {
    let n = Number(m[1].replace(/,/g, ''))
    const unit = (m[2] ?? '').toLowerCase()
    if (unit === 'k') n *= 1e3
    else if (unit === 'm' || unit === 'million') n *= 1e6
    if (Number.isFinite(n)) out.push(Math.round(n))
  }
  return out
}

/** The name in "Hi Sam," / "Dear Sam," / "Hello Sam," on the first line, or null for "Hello," or no greeting. */
export function greetedAs(text: string): string | null {
  const first = text.replace(/\r/g, '').trim().split('\n')[0] ?? ''
  const m = first.match(/^(?:hi|hello|dear|good (?:morning|afternoon|evening))\s+([^,!\n]+)[,!]?\s*$/i)
  if (!m) return null
  const who = m[1].trim()
  return /^(there|all|everyone)$/i.test(who) ? null : who
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/** The wording checks, for an email or message an agent wants to send. */
export function contentChecks(d: { subject: string; text: string; channel: 'email' | 'whatsapp' }, f: DraftFacts): Check[] {
  const all = `${d.subject}\n${d.text}`
  const checks: Check[] = []

  const blank = all.match(/\{[^}\n]{1,30}\}|\[(?:name|first|address|price|sender|date|time)[^\]\n]{0,20}\]|\bundefined\b|\bnull\b|\bNaN\b|£\s?0(?![\d.,])|\bInvalid Date\b/i)
  checks.push({ name: 'No blanks or placeholders', ok: !blank, note: blank ? `“${blank[0]}”` : undefined })

  const greeted = greetedAs(d.text)
  const nameOk = !greeted || (!!f.first && norm(greeted.split(/\s+/)[0]) === norm(f.first))
  checks.push({ name: 'Greets them by their own name', ok: nameOk, note: greeted && !nameOk ? `says “${greeted}”${f.first ? `, they’re ${f.first}` : ''}` : undefined })

  const prices = pricesIn(all).filter((p) => p >= 50) // "£5 coffee" talk aside, a price is a price
  if (prices.length && !f.reportFinal) {
    checks.push({ name: 'No valuation figure without the finalised OnTheMarket guide', ok: false, level: 'block', note: prices.map((p) => `£${p.toLocaleString('en-GB')}`).join(', ') })
  } else {
    const wrong = prices.filter((p) => !f.prices.some((g) => Math.abs(g - p) <= Math.max(1, g * 0.005)))
    checks.push({ name: 'Prices match the finalised OnTheMarket guide', ok: !wrong.length, note: wrong.length ? wrong.map((p) => `£${p.toLocaleString('en-GB')}`).join(', ') : undefined })
  }

  const report = /\/report\/[a-z0-9_-]{6,}/i.test(all)
  checks.push({ name: 'A report link only with the finalised OnTheMarket guide', ok: !report || f.reportFinal, level: 'block' })

  const links = [...all.matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((m) => m[0])
  const odd = links.filter((u) => !trusted(hostOf(u), f.ourHosts))
  checks.push({ name: 'Links only to our site or trusted ones', ok: !odd.length, note: odd.length ? odd.slice(0, 3).join(' ') : undefined })

  const pcs = [...all.matchAll(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/g)].map((m) => `${m[1]} ${m[2]}`)
  const otherPc = f.postcode ? pcs.filter((p) => p !== f.postcode && p !== 'HA3 0PS') : [] // 271 Preston Road is ours
  checks.push({ name: 'About their own home', ok: !otherPc.length, note: otherPc.length ? `mentions ${otherPc.join(', ')}, theirs is ${f.postcode}` : undefined })

  const len = d.text.trim().length
  const longest = d.channel === 'email' ? 5000 : 1000
  checks.push({ name: 'A sensible length', ok: len >= 40 && len <= longest && (d.channel !== 'email' || (d.subject.trim().length >= 3 && d.subject.length <= 120)), note: `${len} characters` })

  if (d.channel === 'email') checks.push({ name: 'Says how to stop these emails', ok: /\bstop\b|unsubscribe/i.test(d.text) })
  return checks
}
