import { NO_REPLY, classify } from '@/lib/mail-audit'

// Which part of the business an email belongs to, for the Inbox page.

export const AREAS = [
  { id: 'sales', label: 'Sales', hint: 'Buyers, sellers, offers, solicitors and sales progression' },
  { id: 'lettings', label: 'Lettings', hint: 'Tenancies, contracts, referencing, deposits, moves' },
  { id: 'management', label: 'Management', hint: 'Repairs, certificates, landlords, rent' },
  { id: 'finance', label: 'Finance', hint: 'Invoices, payments, bank, HMRC, accountant' },
  { id: 'council', label: 'Council', hint: 'Brent, Harrow and other councils' },
  { id: 'legal', label: 'Legal', hint: 'Possession and enforcement, courts, disputes, ombudsman' },
  { id: 'general', label: 'General', hint: 'Everything else from real people and businesses' },
] as const
export type AreaId = (typeof AREAS)[number]['id'] | 'leads' | 'internal' | 'promo'
export const areaLabel = (id: string) => AREAS.find((a) => a.id === id)?.label ?? (id === 'leads' ? 'Leads' : id === 'promo' ? 'Newsletters' : id === 'internal' ? 'Internal' : 'General')

const SALES_WORDS = /\b(sale|purchase|buyer|vendor|seller|memorandum|memo of sale|completion|exchange|mortgage|survey|searches|conveyanc|ta6|ta10|offer accepted|sstc)\b/
const RENT_WORDS = /\b(to let|to rent|rental|tenant|tenancy|pcm|let agreed)\b/

/** Notification services: their emails matter but don't expect a written reply. */
const NOTICES = /(^|\.)(docusign|eumail\.docusign|mydeposits|depositprotection|tenancydepositscheme|goodlord|homelet|vouch|reposit|zerodeposit|e-paycapita|paycapita)\./

export function areaFor(fromAddr: string, subject: string, body: string, bulk: boolean): { area: AreaId; kind: string; needsReply: boolean } {
  const from = fromAddr.toLowerCase()
  const domain = from.split('@')[1] ?? ''
  const text = `${subject}\n${body.slice(0, 2500)}`.toLowerCase()
  const kind = classify(from, subject, body, bulk)
  const pick = (): AreaId => {
    if (kind === 'internal') return 'internal'
    if (kind === 'leads') return 'leads'
    if (/(^|\.)(skpropenforcement|hmcts|justice|courts?|bailiff|hce)\b|enforcement/.test(domain) || /\b(possession (order|claim|hearing)|bailiff|court (hearing|date|order)|warrant of possession|eviction)\b/.test(text)) return 'legal'
    if (/(tpos|theprs|ombudsman)\./.test(domain)) return 'legal'
    if (/docusign/.test(domain)) return SALES_WORDS.test(text) ? 'sales' : 'lettings'
    if (/solicitor|legal|law|conveyanc|llp\b/.test(domain)) return SALES_WORDS.test(text) ? 'sales' : 'legal'
    if (/(^|\.)(muve|coadjute|movebutler|smoove|lms|landmark)\./.test(domain)) return 'sales'
    if (/(^|\.)hmrc\.gov\.uk$|(^|\.)hmrc\./.test(domain)) return 'finance'
    if (/\.gov\.uk$|council/.test(domain)) return 'council'
    if (/(^|\.)(mydeposits|depositprotection|tenancydepositscheme|goodlord|homelet|vouch|reposit|zerodeposit|inventorybase)\./.test(domain)) return 'lettings'
    if (/(^|\.)(e-paycapita|paycapita|makesworth|xero|quickbooks)\.|accountan/.test(domain)) return 'finance'
    switch (kind) {
      case 'viewings': return RENT_WORDS.test(text) ? 'lettings' : 'sales'
      case 'sales': return 'sales'
      case 'tenancy': return 'lettings'
      case 'repairs': case 'rent': case 'compliance': case 'landlords': return 'management'
      case 'accounts': return 'finance'
      case 'automated': return 'promo'
      default: return 'general'
    }
  }
  const area = pick()
  const needsReply = !['promo', 'leads', 'internal'].includes(area) && !bulk && !NO_REPLY.test(from) && !NOTICES.test(domain)
  return { area, kind, needsReply }
}
