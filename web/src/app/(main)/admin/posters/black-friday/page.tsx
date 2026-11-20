import QRCode from 'qrcode'
import { requireAdmin } from '@/lib/auth'
import { knownBase } from '@/lib/property-email-data'
import { scanStats } from '@/lib/qr-links'
import { PosterEditor } from './PosterEditor'
import '../../window/[id]/window.css'
import './poster.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Black Friday poster' }

/**
 * The Black Friday landlord referral poster for the shop window: outside the portal's frame so it prints cleanly.
 * Its QR code goes through our own link (/go/landlord-500), which counts the scan and then opens WhatsApp.
 */
export default async function BlackFridayPosterPage() {
  await requireAdmin()
  const link = `${await knownBase()}/go/landlord-500`
  const [qr, stats] = await Promise.all([
    QRCode.toDataURL(link, { margin: 0, width: 720, errorCorrectionLevel: 'M', color: { dark: '#2B1A12', light: '#FFFFFF' } }),
    scanStats('landlord-500'),
  ])
  return <PosterEditor qr={qr} link={link} stats={stats} />
}
