'use client'

import { useEffect, useState } from 'react'
import type { LicenceRow } from '@/db/schema'
import { fmtDay, kindLabel, LICENCE_STATUS } from '@/lib/licensing-rules'
import { deleteLicence } from '../../licensing-actions'
import { LicenceForm } from './LicenceForm'

export function LicenceList({ rentalId, list, countingId, kind, council }: { rentalId: string; list: LicenceRow[]; countingId: string | null; kind: string | null; council: string | null }) {
  const [editing, setEditing] = useState<string | null>(list.length ? null : 'new')
  // Once a new licence is saved it appears in the list, so close the form.
  useEffect(() => { if (list.length) setEditing(null) }, [list.length])
  return (
    <div className="lic-licences">
      {list.map((l) => editing === l.id ? <LicenceForm key={l.id} rentalId={rentalId} l={l} onDone={() => setEditing(null)} /> : (
        <div key={l.id} className={`lic-licence${l.id === countingId ? ' counts' : ''}`}>
          <div>
            <b>{kindLabel(l.kind)}</b>{l.number ? ` · ${l.number}` : ''}{l.id === countingId ? <span className="pill gold" style={{ marginLeft: 8 }}>The one that counts</span> : null}
            <div className="addr-sub">
              {LICENCE_STATUS.find((s) => s.value === l.status)?.label}
              {l.appliedOn ? ` · applied ${fmtDay(l.appliedOn)}` : ''}{l.startsOn ? ` · from ${fmtDay(l.startsOn)}` : ''}{l.expiresOn ? ` · until ${fmtDay(l.expiresOn)}` : ''}
              {l.maxOccupants ? ` · up to ${l.maxOccupants} people` : ''}{l.maxHouseholds ? ` in ${l.maxHouseholds} households` : ''}
            </div>
            {l.conditions ? <div className="lic-cond">{l.conditions}</div> : null}
          </div>
          <div className="actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(l.id)}>Edit</button>
            <form action={deleteLicence} onSubmit={(e) => { if (!window.confirm('Delete this licence record?')) e.preventDefault() }}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="rentalId" value={rentalId} /><button className="btn btn-ghost btn-sm" type="submit">Delete</button></form>
          </div>
        </div>
      ))}
      {editing === 'new' ? <LicenceForm rentalId={rentalId} kind={kind} council={council} onDone={list.length ? () => setEditing(null) : undefined} /> : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>Add a licence or application</button>}
    </div>
  )
}
