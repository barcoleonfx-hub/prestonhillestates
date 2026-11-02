// Vocabularies for the diary. Safe to import from client components.

export const APPT_KINDS = [
  { value: 'viewing', label: 'Viewing' },
  { value: 'valuation', label: 'Valuation' },
  { value: 'other', label: 'Other' },
] as const

export const kindLabel = (k: string) => APPT_KINDS.find((x) => x.value === k)?.label ?? 'Appointment'

export const DURATIONS = [15, 30, 45, 60, 90] as const
export const REMINDERS = [
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hr before' },
  { value: 120, label: '2 hrs before' },
] as const

/** Half hour slots shown in the quick picker. Any other time can be typed in. */
export const SLOTS: string[] = Array.from({ length: 21 }, (_, i) => {
  const m = 8 * 60 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}) // 08:00 … 18:00

export const OUTCOMES = [
  { value: 'attended', label: 'Went ahead' },
  { value: 'no_show', label: 'No-show' },
  { value: 'cancelled_on_day', label: 'Cancelled on the day' },
] as const

export const INTEREST: Record<string, { value: string; label: string }[]> = {
  viewing: [
    { value: 'offer', label: 'Wants to make an offer' },
    { value: 'second', label: 'Interested, second viewing' },
    { value: 'maybe', label: 'Undecided' },
    { value: 'not', label: 'Not for them' },
  ],
  valuation: [
    { value: 'instructed', label: 'Instructed us' },
    { value: 'considering', label: 'Thinking it over' },
    { value: 'elsewhere', label: 'Going elsewhere' },
    { value: 'not_selling', label: 'Not moving yet' },
  ],
  other: [
    { value: 'positive', label: 'Positive' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'negative', label: 'Negative' },
  ],
}

export const NEXT_STEPS = [
  'Call back',
  'Book second viewing',
  'Pass offer to vendor',
  'Send valuation letter',
  'Send similar properties',
  'No further action',
] as const

export const outcomeLabel = (v: string | null) => OUTCOMES.find((o) => o.value === v)?.label ?? ''
export const interestLabel = (kind: string, v: string | null) =>
  (INTEREST[kind] ?? INTEREST.other).find((o) => o.value === v)?.label ?? ''

/** Minutes after an appointment ends before the person who went must record what happened. */
export const OUTCOME_GRACE_MIN = 15
