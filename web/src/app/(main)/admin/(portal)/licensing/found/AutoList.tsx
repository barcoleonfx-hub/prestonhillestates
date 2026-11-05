'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { fmtDay, kindLabel } from '@/lib/licensing-rules'
import type { Found } from '@/lib/licensing-extract'
import { undoFound } from '../../../licensing-actions'

type Item = { id: string; rentalId: string; address: string; kind: string; found: Found; source: string; when: string | null; pdf: string | null }
const LABEL: Record<string, string> = { licence: 'Licence', gas: 'Gas safety', eicr: 'EICR', epc: 'EPC' }

export function AutoList({ items }: { items: Item[] }) {
  const [pending, start] = useTransition()
  if (!items.length) return <p className="card-sub">Nothing yet.</p>
  return (
    <ul className="lic-autoitems">
      {items.map((i) => (
        <li key={i.id}>
          <div>
            <Link href={`/admin/licensing/${i.rentalId}`} className="addr-main">{i.address}</Link>
            <span><b>{LABEL[i.kind] ?? i.kind}</b>: {i.kind === 'licence' ? [kindLabel(i.found.licenceKind ?? 'selective'), i.found.number, i.found.expiresOn ? `until ${fmtDay(i.found.expiresOn)}` : null].filter(Boolean).join(' · ') : `${i.found.expiresOn ? `until ${fmtDay(i.found.expiresOn)}` : ''}${i.found.rating ? ` · rated ${i.found.rating}` : ''}`}</span>
            <span className="addr-sub">{i.found.how} · from “{i.source}”{i.when ? ` (${fmtDay(i.when.slice(0, 10))})` : ''}{i.pdf ? <> · <a href={`/api/admin/licensing/files/${i.pdf}`} target="_blank" rel="noreferrer">open the PDF</a></> : null}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(() => undoFound(i.id))}>Undo</button>
        </li>
      ))}
    </ul>
  )
}
