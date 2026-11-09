import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { currentAdmin } from '@/lib/auth'
import { merge } from '@/lib/booklet'
import { bookletInput } from '@/lib/booklet-data'
import { recordView, shareByToken } from '@/lib/booklet-share'
import { ReportView } from './ReportView'
import '../../admin/booklet/[id]/booklet.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your property report · Preston Hill Estates', robots: { index: false, follow: false } }

/** The valuation booklet for the person it's for, at its private link (from the "property report" email). */
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const share = await shareByToken(token)
  if (!share) notFound()
  // Staff checking the link don't count as the owner opening it.
  if (!(await currentAdmin())) await recordView(token).catch(() => {})
  const data = await bookletInput(share.bookletId, { name: 'Preston Hill Estates' })
  if (!data) notFound()
  return <ReportView data={data} f={merge(data.defaults, data.saved)} />
}
