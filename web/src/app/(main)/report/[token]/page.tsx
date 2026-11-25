import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { merge } from '@/lib/booklet'
import { bookletInput } from '@/lib/booklet-data'
import { shareByToken } from '@/lib/booklet-share'
import { ViewBeacon } from './ViewBeacon'
import { ReportView } from './ReportView'
import '../../admin/booklet/[id]/booklet.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your property report · Preston Hill Estates', robots: { index: false, follow: false } }

/** The valuation booklet for the person it's for, at its private link (from the "property report" email). */
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const share = await shareByToken(token)
  if (!share) notFound()
  const data = await bookletInput(share.bookletId, { name: 'Preston Hill Estates' })
  if (!data) notFound()
  // The guide price and the pages from the OnTheMarket guide only once staff have finalised the report.
  const shown = data.guide && !data.guide.finalisedAt ? { ...data, guide: null } : data
  // An open is counted by the page itself once it's been read for a few seconds (never by link previews).
  return <><ReportView data={shown} f={merge(data.defaults, data.saved)} /><ViewBeacon token={token} /></>
}
