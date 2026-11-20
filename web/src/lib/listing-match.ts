// Choosing which of our listings an enquiry is about, when more than one is on the same street (a block with a flat
// for sale and another to let). Pure, so it can be tested.

export type ListingHint = { channel: 'sale' | 'let' | null; price: number | null }
export type Candidate = { id: string; postcode: string | null; channel: string; price: number | null; status?: string | null }

/** What the enquiry says about the listing: sale or let, and its price ("£1,750 pcm", "£650,000"). */
export function hintFrom(text: string, intent: 'buy' | 'rent' | 'valuation' | null): ListingHint {
  // Only what the portal says about the listing: not their own words ("I'm a tenant at the moment" is a buyer).
  const lines = text.split('\n').filter((l) => !/^\s*(comments|message|situation|my situation|their address|about)\s*:/i.test(l))
  const t = lines.join('\n').toLowerCase()
  const let_ = intent === 'rent' || /\b(pcm|pw|per month|per week|to rent|to let|tenant enquiry|renter enquiry)\b/.test(t)
  const sale = !let_ && (intent === 'buy' || /\b(for sale|buyer enquiry)\b/.test(t))
  // The price on the listing card ("Listing: £1,750 pcm") rather than any figure in the email.
  const priceLine = lines.find((l) => /^\s*listing\s*:/i.test(l)) ?? lines.find((l) => /£/.test(l)) ?? ''
  const m = /£\s?([\d,]+(?:\.\d+)?)\s*(k\b)?\s*(pcm|pw|per month|per week)?/i.exec(priceLine)
  let price = m ? Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1) : null
  if (price && m?.[3] && /pw|week/i.test(m[3])) price = Math.round((price * 52) / 12)
  return { channel: let_ ? 'let' : sale ? 'sale' : null, price: price && price > 0 ? price : null }
}

/**
 * The best listing for an enquiry: in the same postcode area, on the right side (sale or let), nearest in price.
 * When the enquiry clearly says sale or let and none of the listings on that street is, it isn't linked at all:
 * a tenant enquiry linked to the flat for sale is worse than none.
 */
export function pickListing(rows: Candidate[], outward: string | null, hint: ListingHint): string | null {
  const here = rows.filter((r) => !outward || (r.postcode ?? '').toUpperCase().startsWith(outward))
  const side = hint.channel ? here.filter((r) => (r.channel === 'let' ? 'let' : 'sale') === hint.channel) : here
  if (!side.length) return null
  const live = (r: Candidate) => (r.status && /^(withdrawn|sold|let)$/i.test(r.status) ? 1 : 0)
  const off = (r: Candidate) => (hint.price && r.price ? Math.abs(r.price - hint.price) / hint.price : 1)
  return [...side].sort((a, b) => live(a) - live(b) || off(a) - off(b))[0].id
}
