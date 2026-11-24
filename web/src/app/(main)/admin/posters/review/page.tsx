import QRCode from 'qrcode'
import { requireAdmin } from '@/lib/auth'
import { knownBase } from '@/lib/property-email-data'
import { reviewLink, scanStats } from '@/lib/qr-links'
import { googleSummary, reviewsFor } from '@/lib/reviews-data'
import { ReviewPoster } from './ReviewPoster'
import '../../window/[id]/window.css'
import '../black-friday/poster.css'
import './review.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Review poster' }

/**
 * "Leave us a Google review": a poster for the office. Its QR code goes through our own link (/go/review), which
 * counts the scan and then opens Google's review form for the branch.
 */
export default async function ReviewPosterPage() {
  await requireAdmin()
  const link = `${await knownBase()}/go/review`
  const [qr, stats, google, target, list] = await Promise.all([
    QRCode.toDataURL(link, { margin: 0, width: 720, errorCorrectionLevel: 'M', color: { dark: '#23211A', light: '#FFFFFF' } }),
    scanStats('review'),
    googleSummary().catch(() => ({ rating: null, count: null, url: null })),
    reviewLink(),
    reviewsFor('any', 40).catch(() => []),
  ])
  // Two short, complete five-star Google reviews, word for word.
  const quotes = list.filter((r) => r.source === 'Google review' && r.rating === 5 && !/(…|\.\.\.)\s*$/.test(r.text) && r.text.length >= 40 && r.text.length <= 150)
    .slice(0, 2).map((r) => ({ text: r.text, name: r.name, date: r.date ?? null }))
  return <ReviewPoster qr={qr} link={link} stats={stats} rating={google.rating && google.count ? { rating: google.rating, count: google.count } : null} target={target} quotes={quotes} />
}
