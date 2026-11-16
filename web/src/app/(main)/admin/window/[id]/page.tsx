import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { windowCardFor } from '@/lib/window-card-data'
import { WindowEditor } from './WindowEditor'
import './window.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Window display sheet' }

/** A shop window display sheet for one property: outside the portal's frame so it prints cleanly. */
export default async function WindowPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const input = await windowCardFor(id)
  if (!input) notFound()
  return <WindowEditor input={input} />
}
