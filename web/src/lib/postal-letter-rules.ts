// Printed letters to people who asked for a valuation: the address lines for the envelope window, whether an
// address is complete enough to post to, who to write to by default, and the words. No server code, so it's tested.

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i

/** The address as lines for the envelope window, postcode last on its own line. */
export function addressLines(address: string | null | undefined, postcode?: string | null): string[] {
  const text = (address ?? '').replace(/\s+/g, ' ').trim()
  const pc = (text.match(POSTCODE) ?? (postcode ?? '').match(POSTCODE))
  const code = pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null
  const lines: string[] = []
  for (const raw of text.replace(POSTCODE, '').split(/[,\n]/)) {
    const l = raw.trim().replace(/\s+/g, ' ')
    if (!l || /^(uk|united kingdom|england|gb)$/i.test(l)) continue
    if (!lines.some((x) => x.toLowerCase() === l.toLowerCase())) lines.push(l)
  }
  if (code) lines.push(code)
  return lines
}

/** Complete enough to post: a postcode, and a house number or name with a street. */
export function postable(lines: string[]): boolean {
  if (lines.length < 2 || !POSTCODE.test(lines[lines.length - 1])) return false
  const rest = lines.slice(0, -1)
  return /\d/.test(rest[0]) || rest.length >= 2
}

/** "4 Kenton Park Avenue": the house and street, for the letter's words. */
export function shortHome(lines: string[]): string | null {
  const rest = lines.filter((l) => !POSTCODE.test(l))
  if (!rest.length) return null
  // "Flat 2" on its own line goes with the building's line.
  if (/^(flat|apartment|unit)\s+\w+$/i.test(rest[0]) && rest[1]) return `${rest[0]}, ${rest[1]}`
  return rest[0]
}

export const firstName = (name: string) => {
  const w = name.trim().split(/\s+/)
  return /^(mr|mrs|ms|miss|dr)\.?$/i.test(w[0] ?? '') ? name.trim() : w[0] ?? ''
}

/** Who to write to without being asked: someone with a full address, not booked in, and not written to lately. */
export function chooseByDefault(r: { postable: boolean; booked: boolean; lastLetterAt: string | null; status: string }, now = new Date()): { tick: boolean; why: string | null } {
  if (!r.postable) return { tick: false, why: 'Address incomplete: add the house number and postcode' }
  if (r.booked) return { tick: false, why: 'Valuation already booked' }
  if (r.status === 'won' || r.status === 'lost') return { tick: false, why: r.status === 'won' ? 'Already instructed' : 'Marked as lost' }
  if (r.lastLetterAt && now.getTime() - Date.parse(r.lastLetterAt) < 30 * 864e5) return { tick: false, why: 'Written to in the last 30 days' }
  return { tick: true, why: null }
}

export const LETTER_BEFORE = 'Thank you for asking us to value {home}. I’ve prepared a free personal property report for your home, with recent prices on and around your road and a guide to your local area. Scan the code below with your phone camera to open it.'
export const LETTER_AFTER = 'An online figure can only go so far. Condition, extensions and layout can make a big difference to the price, so the most accurate figure comes from a short visit. It takes about 30 minutes, it’s free and there’s no obligation.\n\nTo arrange a time that suits you, call me on 020 8904 9005 or send a WhatsApp message to 07745 203146.'

/** The words with {first} and {home} filled in, as paragraphs. */
export function fillLetter(text: string, v: { first: string; home: string | null }): string[] {
  return text.replace(/\{first\}/g, v.first || 'there').replace(/\{home\}/g, v.home || 'your home')
    .split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

/** Where the QR code goes in a letter written as one piece (by the AI, or to show both parts together). */
export const QR_MARK = '[QR CODE]'

/** Both parts as one text, with the QR code's place marked. */
export const joinLetter = (before: string, after: string) => `${before.trim()}\n\n${QR_MARK}\n\n${after.trim()}`

/**
 * One text back into the words before and after the QR code. Without the marker, the code goes after the paragraph
 * that mentions scanning it (or after the first paragraph).
 */
export function splitLetter(text: string): { before: string; after: string } {
  const t = text.replace(/\r/g, '').trim()
  const m = /^\s*\[\s*qr(?:\s*code)?\s*\]\s*$/im.exec(t)
  if (m) return { before: t.slice(0, m.index).trim(), after: t.slice(m.index + m[0].length).trim() }
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const scan = paras.findIndex((p) => /\b(scan|qr|code)\b/i.test(p))
  const cut = scan >= 0 && scan < paras.length - 1 ? scan + 1 : Math.min(1, paras.length)
  return { before: paras.slice(0, cut).join('\n\n'), after: paras.slice(cut).join('\n\n') }
}
