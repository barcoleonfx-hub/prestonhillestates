// Property licensing: which schemes apply where, and what state each rented property is in.
// Pure functions and data with no server imports, so pages and the scheduler use exactly the same rules.

// Brent and Harrow have their schemes loaded; any other council is kept by name (e.g. 'ealing'), or 'other'.
export type Council = 'brent' | 'harrow' | 'other' | (string & {})
export type LicenceKind = 'selective' | 'additional_hmo' | 'mandatory_hmo'
export type Occupancy = 'single' | 'hmo_small' | 'hmo_large'
export type LicenceStatus = 'granted' | 'applied' | 'refused' | 'exempt'

export const COUNCILS: { value: Council; label: string; register: string | null; contact: string }[] = [
  { value: 'brent', label: 'Brent', register: 'https://www.brent.gov.uk/prslicensing', contact: 'prslicensing@brent.gov.uk · 020 8937 2384' },
  { value: 'harrow', label: 'Harrow', register: 'https://www.harrow.gov.uk/licences/selective-licensing', contact: 'harrow.gov.uk/licences' },
  { value: 'other', label: 'Another council', register: null, contact: '' },
]
export const KINDS: { value: LicenceKind; label: string; short: string }[] = [
  { value: 'selective', label: 'Selective licence', short: 'Selective' },
  { value: 'additional_hmo', label: 'Additional HMO licence', short: 'Additional HMO' },
  { value: 'mandatory_hmo', label: 'Mandatory HMO licence', short: 'Mandatory HMO' },
]
export const OCCUPANCY: { value: Occupancy; label: string; hint: string }[] = [
  { value: 'single', label: 'Single household', hint: 'A family, a couple, or up to 2 sharers' },
  { value: 'hmo_small', label: 'Small HMO', hint: '3 or 4 people from 2 or more households' },
  { value: 'hmo_large', label: 'Large HMO', hint: '5 or more people from 2 or more households (mandatory licence everywhere)' },
]
export const LICENCE_STATUS: { value: LicenceStatus; label: string }[] = [
  { value: 'granted', label: 'Granted' }, { value: 'applied', label: 'Applied, waiting for the council' },
  { value: 'exempt', label: 'Exempt / temporary exemption' }, { value: 'refused', label: 'Refused' },
]
export const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k
export const councilLabel = (c: string | null) => (c ? COUNCILS.find((x) => x.value === c)?.label ?? c.replace(/\b\w/g, (m) => m.toUpperCase()) : 'Unknown')
export const isOurCouncil = (c: string | null | undefined) => c === 'brent' || c === 'harrow'

/** Every ward in each borough (2022 boundaries), for choosing one by hand when the postcode look-up can't. */
export const WARDS: Record<'brent' | 'harrow', string[]> = {
  brent: ['Alperton', 'Barnhill', 'Brondesbury Park', 'Cricklewood & Mapesbury', 'Dollis Hill', 'Harlesden & Kensal Green', 'Kenton', 'Kilburn', 'Kingsbury',
    'Northwick Park', 'Preston', 'Queens Park', 'Queensbury', 'Roundwood', 'Stonebridge', 'Sudbury', 'Tokyngton', 'Welsh Harp', 'Wembley Central', 'Wembley Hill', 'Wembley Park', 'Willesden Green'],
  harrow: ['Belmont', 'Canons', 'Centenary', 'Edgware', 'Greenhill', 'Harrow on the Hill', 'Harrow Weald', 'Hatch End', 'Headstone', 'Kenton East', 'Kenton West',
    'Marlborough', 'North Harrow', 'Pinner', 'Pinner South', 'Rayners Lane', 'Roxbourne', 'Roxeth', 'Stanmore', 'Wealdstone North', 'Wealdstone South', 'West Harrow'],
}
export const normWard = (w: string | null | undefined) => (w ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z]+/g, ' ').trim()

export type Scheme = {
  id: string; council: Council; kind: LicenceKind; name: string
  wards: string[] // ['*'] means the whole borough
  startsOn: string; endsOn: string // YYYY-MM-DD, inclusive
  sourceUrl: string | null; checkedOn: string | null; notes: string | null
}

// What we found on 5 November 2026 from the councils' designation notices. Editable in the portal, because
// councils add, renew and end schemes: staff should check the council pages when one is due to start or end.
export const SEED_SCHEMES: Omit<Scheme, 'id'>[] = [
  { council: 'brent', kind: 'selective', name: 'Brent selective licensing, designation 1', wards: ['Harlesden & Kensal Green', 'Dollis Hill', 'Willesden Green'], startsOn: '2023-08-01', endsOn: '2028-07-31', sourceUrl: 'https://www.brent.gov.uk/housing/landlords/property-licensing', checkedOn: '2026-11-05', notes: null },
  { council: 'brent', kind: 'selective', name: 'Brent selective licensing, designation 2', wards: ['Alperton', 'Barnhill', 'Brondesbury Park', 'Cricklewood & Mapesbury', 'Kenton', 'Kilburn', 'Kingsbury', 'Northwick Park', 'Preston', 'Queens Park', 'Queensbury', 'Roundwood', 'Stonebridge', 'Sudbury', 'Tokyngton', 'Welsh Harp', 'Wembley Central', 'Wembley Hill'], startsOn: '2024-04-01', endsOn: '2029-03-31', sourceUrl: 'https://www.brent.gov.uk/housing/landlords/property-licensing', checkedOn: '2026-11-05', notes: 'Every ward except Wembley Park.' },
  { council: 'brent', kind: 'additional_hmo', name: 'Brent additional HMO licensing', wards: ['*'], startsOn: '2026-02-02', endsOn: '2031-02-01', sourceUrl: 'https://democracy.brent.gov.uk/ieDecisionDetails.aspx?AIId=74705', checkedOn: '2026-11-05', notes: 'Borough-wide.' },
  { council: 'harrow', kind: 'selective', name: 'Harrow selective licensing: Edgware and Roxeth', wards: ['Edgware', 'Roxeth'], startsOn: '2026-05-02', endsOn: '2031-05-01', sourceUrl: 'https://www.harrow.gov.uk/licences/selective-licensing/6', checkedOn: '2026-11-05', notes: null },
  { council: 'harrow', kind: 'selective', name: 'Harrow selective licensing: Greenhill and Marlborough', wards: ['Greenhill', 'Marlborough'], startsOn: '2026-07-06', endsOn: '2031-07-05', sourceUrl: 'https://www.harrow.gov.uk/licences/selective-licensing/6', checkedOn: '2026-11-05', notes: null },
  { council: 'harrow', kind: 'selective', name: 'Harrow selective licensing: Wealdstone North and South', wards: ['Wealdstone North', 'Wealdstone South'], startsOn: '2026-09-01', endsOn: '2031-08-31', sourceUrl: 'https://www.harrow.gov.uk/licences/selective-licensing/6', checkedOn: '2026-11-05', notes: null },
  { council: 'harrow', kind: 'additional_hmo', name: 'Harrow additional HMO licensing (previous)', wards: ['*'], startsOn: '2021-08-06', endsOn: '2026-08-05', sourceUrl: 'https://www.harrow.gov.uk/licences/licences-houses-multiple-occupation-hmos', checkedOn: '2026-11-05', notes: 'Ended. Small HMOs in Harrow had no additional licensing between this and the new scheme.' },
  { council: 'harrow', kind: 'additional_hmo', name: 'Harrow additional HMO licensing (new)', wards: ['*'], startsOn: '2027-01-06', endsOn: '2032-01-05', sourceUrl: 'https://www.harrow.gov.uk/licences/licences-houses-multiple-occupation-hmos', checkedOn: '2026-11-05', notes: 'Approved and scheduled to start on 6 January 2027. Confirm the date with Harrow.' },
]

export type Licence = {
  id: string; kind: LicenceKind; council: string | null; number: string | null; status: LicenceStatus
  appliedOn: string | null; startsOn: string | null; expiresOn: string | null
}
export type RentalFacts = {
  council: Council | null; ward: string | null; occupancy: Occupancy
  noLicenceNeeded?: boolean
  gasExpires: string | null; eicrExpires: string | null; epcExpires: string | null; epcRating: string | null
}

export type Bucket = 'unlicensed' | 'expired' | 'due30' | 'due90' | 'due180' | 'upcoming' | 'applied' | 'check' | 'ok' | 'not_required'
export const BUCKETS: { value: Bucket; label: string; tone: 'red' | 'amber' | 'yellow' | 'blue' | 'grey' | 'green'; about: string }[] = [
  { value: 'unlicensed', label: 'Needs a licence now', tone: 'red', about: 'In a licensing area with no licence or application on file.' },
  { value: 'expired', label: 'Licence expired', tone: 'red', about: 'The licence has run out and no new one is on file.' },
  { value: 'due30', label: 'Expires within 30 days', tone: 'red', about: 'Apply for the renewal now.' },
  { value: 'due90', label: 'Expires within 90 days', tone: 'amber', about: 'Start the renewal: get the certificates and landlord details together.' },
  { value: 'upcoming', label: 'Scheme starting soon', tone: 'amber', about: 'A new scheme will cover this property. Apply before it starts.' },
  { value: 'due180', label: 'Expires within 6 months', tone: 'yellow', about: 'Coming up. Let the landlord know.' },
  { value: 'applied', label: 'Applied, waiting', tone: 'blue', about: 'Application made, so the property is covered while the council decides. Chase if it drags on.' },
  { value: 'check', label: 'To check', tone: 'grey', about: 'We can’t tell yet: the ward isn’t known (add the postcode), it’s outside Brent and Harrow, or it’s marked not needed in a licensing area.' },
  { value: 'ok', label: 'Licensed', tone: 'green', about: 'Valid for more than 6 months.' },
  { value: 'not_required', label: 'No licence needed', tone: 'green', about: 'No scheme covers this property at the moment.' },
]
export const bucketOf = (b: string) => BUCKETS.find((x) => x.value === b) ?? BUCKETS[BUCKETS.length - 1]

export type CertState = 'expired' | 'due30' | 'due60' | 'ok' | 'missing'
export type Cert = { key: 'gas' | 'eicr' | 'epc'; label: string; state: CertState; date: string | null; days: number | null; note: string | null }

export type Assessment = {
  bucket: Bucket
  needed: LicenceKind | null // the licence this property needs today
  scheme: Scheme | null // the scheme that makes it needed (null for mandatory HMO)
  upcoming: { kind: LicenceKind; scheme: Scheme; days: number } | null
  licence: Licence | null // the licence that counts
  validUntil: string | null // the earlier of the licence expiry and the scheme end
  days: number | null // days left on validUntil, or until the scheme starts
  reasons: string[] // plain-English explanation
  certs: Cert[]
  certIssues: number
  urgency: number // lower is more urgent, for sorting
}

const DAY = 86400000
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY)
export const fmtDay = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const plural = (n: number, w: string) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`
export const inWords = (days: number) => (days === 0 ? 'today' : days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`)

const covers = (s: Scheme, f: RentalFacts) =>
  s.council === f.council && (s.wards.includes('*') || (!!f.ward && s.wards.some((w) => normWard(w) === normWard(f.ward))))
const kindFor = (o: Occupancy): LicenceKind => (o === 'hmo_large' ? 'mandatory_hmo' : o === 'hmo_small' ? 'additional_hmo' : 'selective')

function certFor(key: Cert['key'], date: string | null, today: string, rating?: string | null): Cert {
  const label = { gas: 'Gas safety', eicr: 'EICR (electrics)', epc: 'EPC' }[key]
  if (!date) return { key, label, state: 'missing', date: null, days: null, note: null }
  const days = daysBetween(today, date)
  const low = key === 'epc' && !!rating && /^[FG]$/i.test(rating)
  return {
    key, label, date, days, note: low ? `Rated ${rating!.toUpperCase()}: below the legal minimum (E) for letting` : null,
    state: low || days < 0 ? 'expired' : days <= 30 ? 'due30' : days <= 60 ? 'due60' : 'ok',
  }
}

/** Where a rented property stands on licensing today, and why. */
export function assess(f: RentalFacts, licences: Licence[], schemes: Scheme[], today = isoDay(new Date())): Assessment {
  const reasons: string[] = []
  const kind = kindFor(f.occupancy)
  const active = (s: Scheme) => s.startsOn <= today && s.endsOn >= today
  const scheme = kind === 'mandatory_hmo' ? null : schemes.find((s) => s.kind === kind && active(s) && covers(s, f)) ?? null
  const needed: LicenceKind | null = kind === 'mandatory_hmo' ? 'mandatory_hmo' : scheme ? kind : null
  const soon = kind === 'mandatory_hmo' ? null : schemes.filter((s) => s.kind === kind && s.startsOn > today && covers(s, f)).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? null
  const upcoming = soon && !needed ? { kind, scheme: soon, days: daysBetween(today, soon.startsOn) } : null

  const certs = [certFor('gas', f.gasExpires, today), certFor('eicr', f.eicrExpires, today), certFor('epc', f.epcExpires, today, f.epcRating)]
  const certIssues = certs.filter((c) => c.state !== 'ok').length

  // Which licence counts: the newest of the kind needed (or of any kind, if none is needed).
  const want = needed ?? upcoming?.kind ?? null
  const mine = licences.filter((l) => !want || l.kind === want).sort((a, b) => (b.expiresOn ?? b.appliedOn ?? '').localeCompare(a.expiresOn ?? a.appliedOn ?? ''))
  const valid = mine.find((l) => l.status === 'granted' && (!l.startsOn || l.startsOn <= today) && !!l.expiresOn && l.expiresOn >= today) ?? null
  const pending = mine.find((l) => l.status === 'applied' || (l.status === 'exempt' && (!l.expiresOn || l.expiresOn >= today))) ?? null
  const lapsed = mine.find((l) => l.status === 'granted' && !!l.expiresOn && l.expiresOn < today) ?? null

  const unknownArea = isOurCouncil(f.council) && !f.ward && kind === 'selective'
  if (!f.council) reasons.push('We don’t know which council this property is in yet.')
  else if (!isOurCouncil(f.council)) reasons.push(`Outside Brent and Harrow: check ${f.council === 'other' ? 'that council' : councilLabel(f.council)}’s own licensing rules. Any licence on file is still tracked.`)
  else if (unknownArea) reasons.push(`The ward isn’t known yet (add the postcode), so we can’t confirm which ${councilLabel(f.council)} scheme applies. Any licence on file is still tracked.`)
  if (scheme) reasons.push(`${f.ward ? `${f.ward} ward` : 'This area'} is covered by ${scheme.name} until ${fmtDay(scheme.endsOn)}.`)
  else if (kind === 'mandatory_hmo') reasons.push('5 or more people from 2 or more households: a mandatory HMO licence is needed anywhere in England.')
  else if (f.council === 'brent' || f.council === 'harrow') reasons.push(f.ward ? `No ${kindLabel(kind).toLowerCase()} scheme covers ${f.ward} ward at the moment.` : '')
  if (upcoming) reasons.push(`${upcoming.scheme.name} starts on ${fmtDay(upcoming.scheme.startsOn)} (${inWords(upcoming.days)}). A licence is needed from that date.`)

  let bucket: Bucket, licence: Licence | null = null, validUntil: string | null = null, days: number | null = null
  if (needed && f.noLicenceNeeded && !valid && !pending) {
    bucket = 'check'
    reasons.push(`Marked as not needing a licence, but ${scheme ? scheme.name : 'mandatory HMO licensing'} covers it. Check the reason (an exemption?) and note it on the property.`)
  } else if (needed) {
    if (valid) {
      licence = valid
      validUntil = scheme && scheme.endsOn < valid.expiresOn! ? scheme.endsOn : valid.expiresOn!
      if (validUntil !== valid.expiresOn) reasons.push(`The licence runs to ${fmtDay(valid.expiresOn)}, but the scheme ends on ${fmtDay(validUntil)}. If the council renews the scheme, a new licence will be needed.`)
      days = daysBetween(today, validUntil)
      bucket = days <= 30 ? 'due30' : days <= 90 ? 'due90' : days <= 180 ? 'due180' : 'ok'
      reasons.push(`Licence ${valid.number ? `${valid.number} ` : ''}is valid until ${fmtDay(validUntil)} (${inWords(days)}).`)
    } else if (pending) {
      licence = pending; bucket = 'applied'
      days = pending.appliedOn ? daysBetween(pending.appliedOn, today) : null
      reasons.push(pending.status === 'exempt' ? `Exemption on file${pending.expiresOn ? ` until ${fmtDay(pending.expiresOn)}` : ''}.` : `Application made${pending.appliedOn ? ` on ${fmtDay(pending.appliedOn)} (${plural(days!, 'day')} ago)` : ''}. Keep proof of the application.`)
    } else if (lapsed) {
      licence = lapsed; bucket = 'expired'; validUntil = lapsed.expiresOn; days = daysBetween(today, lapsed.expiresOn!)
      reasons.push(`Licence ${lapsed.number ?? ''} expired on ${fmtDay(lapsed.expiresOn)}. Letting it without a licence or an application is an offence.`)
    } else {
      bucket = 'unlicensed'
      reasons.push('No licence or application is on file. Letting it without one is an offence: apply straight away, or add the licence if there is one.')
    }
  } else if (upcoming) {
    licence = valid ?? pending
    bucket = licence ? (licence.status === 'applied' ? 'applied' : 'ok') : 'upcoming'
    days = upcoming.days
  } else if ((unknownArea || !f.council || !isOurCouncil(f.council)) && (valid || pending || lapsed)) {
    // We can't say whether a licence is needed, but one is on file: watch its dates as if it were.
    if (valid) {
      licence = valid; validUntil = valid.expiresOn!; days = daysBetween(today, validUntil)
      bucket = days <= 30 ? 'due30' : days <= 90 ? 'due90' : days <= 180 ? 'due180' : 'ok'
      reasons.push(`Licence ${valid.number ? `${valid.number} ` : ''}is valid until ${fmtDay(validUntil)} (${inWords(days)}).`)
    } else if (pending) {
      licence = pending; bucket = 'applied'; days = pending.appliedOn ? daysBetween(pending.appliedOn, today) : null
      reasons.push(`Application made${pending.appliedOn ? ` on ${fmtDay(pending.appliedOn)}` : ''}.`)
    } else {
      licence = lapsed; bucket = 'expired'; validUntil = lapsed!.expiresOn; days = daysBetween(today, lapsed!.expiresOn!)
      reasons.push(`Licence ${lapsed!.number ?? ''} expired on ${fmtDay(lapsed!.expiresOn)}.`)
    }
  } else if (f.noLicenceNeeded) {
    bucket = 'not_required'
    reasons.push('Marked as not needing a licence (by us, or on the spreadsheet we imported).')
  } else if (unknownArea || !f.council || !isOurCouncil(f.council)) {
    // Outside Brent and Harrow we don't hold the council's schemes, so we can't say a licence isn't needed.
    bucket = 'check'
  } else {
    // Not needed, but if they hold one we still watch it.
    licence = valid ?? pending
    bucket = 'not_required'
    if (valid?.expiresOn) { validUntil = valid.expiresOn; days = daysBetween(today, valid.expiresOn) }
  }
  const order: Bucket[] = ['unlicensed', 'expired', 'due30', 'upcoming', 'due90', 'check', 'due180', 'applied', 'ok', 'not_required']
  const urgency = order.indexOf(bucket) * 100000 + (days ?? 50000) + (certIssues ? -1 : 0)
  return { bucket, needed, scheme, upcoming, licence, validUntil, days, reasons: reasons.filter(Boolean), certs, certIssues, urgency }
}

// ---------- reminders ----------

export const LICENCE_STEPS = [180, 90, 60, 30, 14, 7, 1, 0]
export const CERT_STEPS = [60, 30, 7, 0]

/** The reminders a property is due right now, each with a stable key so it's only sent once. */
export function dueReminders(a: Assessment, rental: { id: string; address: string }, today = isoDay(new Date())) {
  const out: { key: string; title: string; body: string; urgent: boolean }[] = []
  const at = rental.address
  if (a.bucket === 'unlicensed') out.push({ key: `unlicensed:${a.needed}:${weekOf(today)}`, title: `No licence: ${at}`, body: `Needs a ${kindLabel(a.needed!).toLowerCase()} and none is on file.`, urgent: true })
  if (a.bucket === 'expired' && a.licence) out.push({ key: `expired:${a.licence.id}:${weekOf(today)}`, title: `Licence expired: ${at}`, body: `${kindLabel(a.licence.kind)} ${a.licence.number ?? ''} expired on ${fmtDay(a.licence.expiresOn)}.`, urgent: true })
  if (a.validUntil && a.days != null && a.licence?.status === 'granted' && a.days >= 0) {
    const step = LICENCE_STEPS.find((s) => a.days! <= s && a.days! > (LICENCE_STEPS[LICENCE_STEPS.indexOf(s) + 1] ?? -1))
    if (step != null) out.push({ key: `due:${a.licence.id}:${a.validUntil}:${step}`, title: `Licence ${a.days === 0 ? 'ends today' : `ends ${inWords(a.days)}`}: ${at}`, body: `${kindLabel(a.licence.kind)} ${a.licence.number ?? ''} is valid until ${fmtDay(a.validUntil)}.`, urgent: a.days <= 30 })
  }
  if (a.bucket === 'upcoming' && a.upcoming) {
    const step = [90, 30, 7].find((s) => a.upcoming!.days <= s && a.upcoming!.days > ({ 90: 30, 30: 7, 7: -1 } as Record<number, number>)[s])
    if (step != null) out.push({ key: `upcoming:${a.upcoming.scheme.id}:${step}`, title: `Licence needed from ${fmtDay(a.upcoming.scheme.startsOn)}: ${at}`, body: `${a.upcoming.scheme.name} starts ${inWords(a.upcoming.days)}. Apply before then.`, urgent: a.upcoming.days <= 30 })
  }
  for (const c of a.certs) {
    if (c.state === 'missing' || c.days == null) continue
    if (c.note) { out.push({ key: `cert:${c.key}:low:${c.date}`, title: `${c.label}: ${at}`, body: c.note, urgent: true }); continue }
    const step = CERT_STEPS.find((s) => c.days! <= s && c.days! > (CERT_STEPS[CERT_STEPS.indexOf(s) + 1] ?? -99999))
    if (step != null) out.push({ key: `cert:${c.key}:${c.date}:${step}`, title: `${c.label} ${c.days < 0 ? 'expired' : `due ${inWords(c.days)}`}: ${at}`, body: `${c.label} ${c.days < 0 ? 'expired on' : 'runs out on'} ${fmtDay(c.date)}.`, urgent: c.days <= 30 })
  }
  return out
}
// Repeat "no licence" and "expired" reminders once a week until they're sorted.
const weekOf = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return isoDay(d) }
