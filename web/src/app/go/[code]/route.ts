import { NextResponse, type NextRequest } from 'next/server'
import { QR_LINKS, recordScan } from '@/lib/qr-links'

export const dynamic = 'force-dynamic'

/** A poster's QR code: count the scan, then go where the code is meant to go. Counting never holds anyone up. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const link = QR_LINKS[code]
  if (!link) return NextResponse.redirect(new URL('/', req.url), 302)
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  await recordScan(code, { ip, ua: req.headers.get('user-agent') ?? '' }).catch((e) => console.error('recording a QR scan failed', e))
  return NextResponse.redirect(link.target, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}
