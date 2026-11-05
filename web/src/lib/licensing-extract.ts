// Reading licence and certificate details out of emails and their PDF attachments. Pure functions (no server
// imports) so they can be tested on their own. Everything found is a suggestion for staff to accept, never a fact.

export type DocKind = 'licence' | 'gas' | 'eicr' | 'epc'
export type Found = {
  kind: DocKind
  number?: string | null // licence number
  licenceKind?: 'selective' | 'additional_hmo' | 'mandatory_hmo' | null
  status?: 'granted' | 'applied' | null
  council?: 'brent' | 'harrow' | null
  startsOn?: string | null
  expiresOn?: string | null
  inspectedOn?: string | null
  rating?: string | null
  confidence: 'high' | 'medium' | 'low'
  how: string // in plain English, how the date was worked out
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => y >= 1995 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
const iso = (y: number, m: number, d: number) => (valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null)
const yr = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s))

// "12/03/2025", "12.03.25", "12-03-2025", "2025-03-12", "12 March 2025", "12th Mar 2025", "March 12, 2025"
const DATE = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/gi

export function datesIn(text: string): { iso: string; at: number }[] {
  const out: { iso: string; at: number }[] = []
  for (const m of text.matchAll(DATE)) {
    let v: string | null = null
    if (m[1]) v = iso(+m[1], +m[2], +m[3])
    else if (m[4]) v = iso(yr(m[6]), +m[5], +m[4]) // UK order: day first
    else if (m[7]) v = iso(+m[9], MONTHS.indexOf(m[8].slice(0, 3).toLowerCase()) + 1, +m[7])
    else if (m[10]) v = iso(+m[12], MONTHS.indexOf(m[10].slice(0, 3).toLowerCase()) + 1, +m[11])
    if (v) out.push({ iso: v, at: m.index ?? 0 })
  }
  return out
}

/** The first date within `reach` characters after a label like "expiry date". */
function dateAfter(text: string, label: RegExp, reach = 60): string | null {
  for (const m of text.matchAll(new RegExp(label.source, 'gi'))) {
    const from = (m.index ?? 0) + m[0].length
    const d = datesIn(text.slice(from, from + reach))[0]
    if (d) return d.iso
  }
  return null
}
const addYears = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + n); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }

// ---------- addresses ----------

const ABBR: [RegExp, string][] = [[/\b(rd)\b/g, 'road'], [/\b(ave|av)\b/g, 'avenue'], [/\b(st)\b/g, 'street'], [/\b(cres|cresc)\b/g, 'crescent'], [/\b(gdns)\b/g, 'gardens'], [/\b(cl)\b/g, 'close'], [/\b(dr)\b/g, 'drive'], [/\b(ln)\b/g, 'lane'], [/\b(ct)\b/g, 'court'], [/\b(pk)\b/g, 'park'], [/\b(sq)\b/g, 'square'], [/\b(tce|terr)\b/g, 'terrace'], [/\b(pl)\b/g, 'place'], [/\b(hse)\b/g, 'house']]
export const normText = (s: string) => {
  let t = ` ${s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ')} `
  for (const [re, w] of ABBR) t = t.replace(re, w)
  return t.replace(/\s+/g, ' ')
}
export const normPostcode = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export type AddressKey = { id: string; key: string; flat: string | null; postcode: string }
/** "Flat 2, 10 High Road, Harlesden" → key " 10 high road ", flat "2". */
export function addressKey(id: string, address: string, postcode: string | null): AddressKey | null {
  const a = normText(address)
  const flat = /\b(?:flat|apartment|apt|unit)\s+([0-9]+[a-z]?)\b/.exec(a)?.[1] ?? null
  const rest = flat ? a.replace(/\b(?:flat|apartment|apt|unit)\s+[0-9]+[a-z]?\b/, ' ') : a
  const m = /\b(\d+[a-z]?)\s+((?:[a-z]+\s){0,3}?(?:road|avenue|street|crescent|gardens|close|drive|lane|court|park|square|terrace|place|way|grove|walk|rise|hill|mews|view|parade|green|row|gate|vale|end|house|mansions))\b/.exec(rest)
  if (!m) return null
  return { id, key: ` ${m[1]} ${m[2].trim()} `, flat, postcode: normPostcode(postcode) }
}

/** Where in the text a property is mentioned: by number and street, checked against the postcode or the flat number. */
export function findMention(norm: string, k: AddressKey): number {
  let at = norm.indexOf(k.key)
  while (at >= 0) {
    const around = norm.slice(Math.max(0, at - 120), at + k.key.length + 160)
    const pcOk = !k.postcode || around.replace(/\s/g, '').toUpperCase().includes(k.postcode) || !/\b[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}\b/.test(around)
    const flatOk = !k.flat || new RegExp(`\\b(flat|apartment|apt|unit)\\s+${k.flat}\\b`).test(norm.slice(Math.max(0, at - 60), at + 10))
    if (pcOk && flatOk) return at
    at = norm.indexOf(k.key, at + 1)
  }
  return -1
}

// ---------- what kind of document ----------

export function classify(subject: string, from: string, text: string): DocKind[] {
  const s = `${subject}\n${text.slice(0, 20000)}`.toLowerCase()
  const kinds: DocKind[] = []
  const council = /@(?:[a-z.]*\.)?(brent|harrow)\.gov\.uk/i.test(from) || /\b(brent|harrow) council\b/.test(s)
  if (/\b(selective licen[cs]e|selective licensing|hmo licen[cs]e|property licen[cs]e|licen[cs]e (number|no\.?|ref)|licensing scheme|house in multiple occupation)\b/.test(s) && (council || /\blicen[cs]e (number|no\.?|holder|ref)/.test(s))) kinds.push('licence')
  if (/\b(gas safety (record|certificate|check|inspection)|landlord gas safety|cp12|lgsr)\b/.test(s)) kinds.push('gas')
  if (/\b(electrical installation condition report|eicr)\b/.test(s)) kinds.push('eicr')
  if (/\b(energy performance certificate|epc rating|energy efficiency rating|current energy rating)\b/.test(s)) kinds.push('epc')
  return kinds
}

// ---------- reading the details ----------

const LICENCE_NO = /\b(?:licen[cs]e|application|reference|ref)\s*(?:number|no\.?|ref(?:erence)?|#)?\s*(?:is\s+)?[:.]?\s*([A-Z]{0,6}[/-]?[A-Z0-9]{2,}(?:[/-][A-Z0-9]+){0,4})\b/gi

/** Details of one kind of document, from the part of the text that mentions the property (or all of it). */
export function extract(kind: DocKind, text: string, sentOn: string, from = ''): Found | null {
  const t = text.replace(/\s+/g, ' ')
  const low = t.toLowerCase()
  if (kind === 'licence') {
    const applied = /\b(application (has been )?(received|submitted|acknowledged)|thank you for (your|submitting) (an )?application|we have received your application)\b/.test(low)
    const granted = /\b(licen[cs]e (has been )?(granted|issued)|final licen[cs]e|grant of (a )?licen[cs]e|licen[cs]e certificate)\b/.test(low)
    let number: string | null = null
    for (const m of t.matchAll(LICENCE_NO)) { const v = m[1]; if (/\d/.test(v) && v.length >= 4 && !/^(19|20)\d\d$/.test(v)) { number = v.toUpperCase(); break } }
    const expiresOn = dateAfter(t, /\b(expiry date|expires?( on)?|valid (until|to)|end date|ending on|licen[cs]e period[^.]{0,40}?to|until)\b/)
    const startsOn = dateAfter(t, /\b(start date|commencement date|valid from|starts? on|effective from|from)\b/)
    const council = /brent/i.test(from) || /\bbrent\b/.test(low) ? 'brent' : /harrow/i.test(from) || /\bharrow\b/.test(low) ? 'harrow' : null
    const licenceKind = /\bmandatory\b/.test(low) ? 'mandatory_hmo' : /\b(additional (hmo )?licen|additional licensing|small hmo)\b/.test(low) ? 'additional_hmo' : /\bhmo\b/.test(low) && !/\bselective\b/.test(low) ? 'additional_hmo' : 'selective'
    if (!number && !expiresOn && !applied) return null
    const status = granted || expiresOn ? 'granted' : applied ? 'applied' : null
    return {
      kind, number, licenceKind, council, status, startsOn: startsOn ?? (status === 'applied' ? sentOn : null), expiresOn,
      confidence: expiresOn && number ? 'high' : expiresOn || number ? 'medium' : 'low',
      how: expiresOn ? 'Expiry date stated in the email' : status === 'applied' ? 'Application acknowledged on the date of the email' : 'Licence number found; no expiry date in the email',
    }
  }
  if (kind === 'gas') {
    const next = dateAfter(t, /\b(next (inspection|check|service|safety check) (is )?(due|date|by)|due (date|by)|expiry date|expires?( on)?|valid until|next due)\b/)
    const done = dateAfter(t, /\b(date of (inspection|check|appliance check|issue)|inspection date|inspected on|check(ed)? on|completed on|issue date|date)\b/, 40)
    if (next) return { kind, inspectedOn: done, expiresOn: next, confidence: 'high', how: 'Next check date stated on the gas safety record' }
    if (done) return { kind, inspectedOn: done, expiresOn: addYears(done, 1), confidence: 'medium', how: `Inspected ${done}; gas safety lasts a year` }
    return { kind, inspectedOn: sentOn, expiresOn: addYears(sentOn, 1), confidence: 'low', how: 'No date in the record, so worked out from the date the email was sent' }
  }
  if (kind === 'eicr') {
    const next = dateAfter(t, /\b(next inspection (is )?(recommended )?(by|date|due|no later than)|recommended (date of )?next inspection|re-?inspect(ion)? (by|date)|valid until|expiry date)\b/)
    const done = dateAfter(t, /\b(date(s)? of (the )?inspection|inspection date|date inspected|inspected on|date of issue|completed on)\b/, 40)
    const yearsIn = /\bnext inspection[^.]{0,40}?\b(within|in)\s+(\d)\s+years?\b/.exec(low)
    const unsatisfactory = /\bunsatisfactory\b/.test(low)
    if (next) return { kind, inspectedOn: done, expiresOn: next, confidence: 'high', how: `Next inspection date stated on the EICR${unsatisfactory ? ' (marked unsatisfactory: check remedial work was done)' : ''}` }
    if (done) { const n = yearsIn ? Math.min(5, Number(yearsIn[2])) : 5; return { kind, inspectedOn: done, expiresOn: addYears(done, n), confidence: 'medium', how: `Inspected ${done}; next due in ${n} years${unsatisfactory ? ' (marked unsatisfactory)' : ''}` } }
    return { kind, inspectedOn: sentOn, expiresOn: addYears(sentOn, 5), confidence: 'low', how: 'No date in the report, so worked out from the date the email was sent' }
  }
  // EPC
  const rating = /\b(?:current|energy|epc)\s*(?:efficiency\s*)?rating\s*(?:is|of|:)?\s*([A-G])\b/i.exec(t)?.[1]?.toUpperCase() ?? /\brated\s+([A-G])\b/i.exec(t)?.[1]?.toUpperCase() ?? null
  const until = dateAfter(t, /\b(valid until|expiry date|expires?( on)?)\b/)
  const done = dateAfter(t, /\b(date of (assessment|certificate)|date of issue|lodged on|assessment date)\b/, 40)
  if (until) return { kind, rating, expiresOn: until, confidence: rating ? 'high' : 'medium', how: 'Valid-until date stated on the EPC' }
  if (done) return { kind, rating, inspectedOn: done, expiresOn: addYears(done, 10), confidence: 'medium', how: `Certificate dated ${done}; EPCs last 10 years` }
  if (rating) return { kind, rating, expiresOn: null, confidence: 'low', how: 'Rating found but no date' }
  return null
}

/** Narrows the text to the part around a property's mention, so a council email listing several homes reads right. */
export function windowAt(text: string, at: number, normLength: number) {
  if (at < 0) return text
  // `at` is a position in the normalised text, which is a little shorter than the original; scale it across.
  const p = Math.round(at * (text.length / Math.max(1, normLength)))
  return text.slice(Math.max(0, p - 500), p + 1600)
}
