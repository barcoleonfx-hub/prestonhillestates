'use client'

import { useRef } from 'react'
import { LEAD_STATUSES } from '@/lib/lead-rules'
import { updateLeadOwner, updateLeadStatus } from '../../../lead-actions'

/** Status and owner of a lead: change either and it saves straight away (and shows on the timeline). */
export function LeadControls({ id, status, ownerId, meId, staff }: { id: string; status: string; ownerId: string | null; meId: string; staff: { id: string; name: string }[] }) {
  const s = useRef<HTMLFormElement>(null)
  const o = useRef<HTMLFormElement>(null)
  return (
    <div className="lead-ctl">
      <form ref={s} action={updateLeadStatus}>
        <input type="hidden" name="id" value={id} />
        <label>Stage
          <select name="status" className="input" defaultValue={status} key={status} onChange={() => s.current?.requestSubmit()}>
            {LEAD_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
      </form>
      <form ref={o} action={updateLeadOwner}>
        <input type="hidden" name="id" value={id} />
        <label>Looked after by
          <select name="owner" className="input" defaultValue={ownerId ?? ''} key={ownerId ?? ''} onChange={() => o.current?.requestSubmit()}>
            <option value="">Nobody yet</option>
            {staff.map((x) => <option key={x.id} value={x.id}>{x.id === meId ? `${x.name} (you)` : x.name}</option>)}
          </select>
        </label>
      </form>
      {ownerId !== meId ? (
        <form action={updateLeadOwner} className="lead-take">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="owner" value={meId} />
          <button className="btn btn-ghost btn-sm" type="submit">Take it</button>
        </form>
      ) : null}
    </div>
  )
}
