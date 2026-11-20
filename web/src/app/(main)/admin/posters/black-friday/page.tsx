import QRCode from 'qrcode'
import { requireAdmin } from '@/lib/auth'
import { OFFICE_WHATSAPP, waLink } from '@/lib/whatsapp'
import { PosterEditor } from './PosterEditor'
import '../../window/[id]/window.css'
import './poster.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Black Friday poster' }

/** What a passer-by sends when they scan the poster: our WhatsApp, with the details we need laid out. */
const POSTER_MESSAGE = 'Hi Preston Hill Estates, I’d like to introduce a landlord for your £500 Black Friday offer.\n\nLandlord’s name:\nTheir phone number:\nWhere their property is:\nThey’re happy for you to contact them: Yes\n\nMy name:'

/** The Black Friday landlord referral poster for the shop window: outside the portal's frame so it prints cleanly. */
export default async function BlackFridayPosterPage() {
  await requireAdmin()
  const link = waLink(OFFICE_WHATSAPP, POSTER_MESSAGE)
  const qr = await QRCode.toDataURL(link, { margin: 0, width: 720, errorCorrectionLevel: 'M', color: { dark: '#2B1A12', light: '#FFFFFF' } })
  return <PosterEditor qr={qr} />
}
