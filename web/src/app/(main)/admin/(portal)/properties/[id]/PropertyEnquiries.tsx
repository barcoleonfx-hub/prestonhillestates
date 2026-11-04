import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { contacts, enquiries, type Property } from '@/db/schema'
import { RECENT_DAYS } from '@/lib/enquiry-labels'
import { streetFor, unlinkedFor } from '@/lib/enquiry-links'
import { trailFor, type TrailItem } from '@/lib/enquiry-trail'
import { linkMatchingEnquiries } from '../../../crm-actions'
import { EnquiryItem, type EnquiryRow } from '../../EnquiryItem'

/** Everyone who has enquired about this listing, newest first, ready to call and comment on. */
export async function PropertyEnquiries({ property }: { property: Property }) {
  const rows: EnquiryRow[] = (await db
    .select({ e: enquiries, dnc: contacts.doNotContact })
    .from(enquiries)
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(eq(enquiries.propertyId, property.id))
    .orderBy(desc(enquiries.createdAt))
    .limit(1000)).map((r) => ({ ...r, p: property }))
  const [trailById, unlinked] = await Promise.all([trailFor(rows.map((r) => r.e)), unlinkedFor(property)])
  // One row per person: their latest enquiry, with every comment and call from all of them.
  const phoneKey = (v: string | null) => { const d = (v ?? '').replace(/\D/g, '').replace(/^44/, '0'); return d.length >= 10 ? d : '' }
  const key = (e: EnquiryRow['e']) => phoneKey(e.phone) || e.email?.toLowerCase() || e.contactId || e.name.toLowerCase()
  const people = new Map<string, { row: EnquiryRow; times: number; trail: TrailItem[] }>()
  for (const r of rows) {
    const k = key(r.e)
    const g = people.get(k)
    if (!g) people.set(k, { row: r, times: 1, trail: [...(trailById[r.e.id] ?? [])] })
    else {
      g.times++
      if (!g.row.e.contactId && r.e.contactId) g.row = r // show the one linked to their contact record
      for (const t of trailById[r.e.id] ?? []) if (!g.trail.some((x) => x.id === t.id)) g.trail.push(t)
    }
  }
  const groups = [...people.values()].map((g) => ({ ...g, trail: g.trail.sort((a, b) => (a.at < b.at ? 1 : -1)) }))
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const recent = groups.filter((g) => g.row.e.createdAt >= recentFrom)
  const older = groups.filter((g) => g.row.e.createdAt < recentFrom)
  const outcomes = groups.filter((g) => g.row.e.outcome).length
  const street = streetFor(property)

  return (
    <section className="card card-pad pe" id="enquiries" aria-labelledby="pe-h">
      <div className="today-head">
        <div>
          <h2 id="pe-h">Enquiries about this property · {groups.length} {groups.length === 1 ? 'person' : 'people'}</h2>
          <p className="card-sub">
            Everyone who asked about it, from the website, Zoopla, OnTheMarket and email.
            {groups.length ? ` ${outcomes} of ${groups.length} have an outcome recorded.` : ''} Call them, then leave a comment so the team knows where things stand.
          </p>
        </div>
      </div>
      {unlinked.length ? (
        <form action={linkMatchingEnquiries} className="notice ok pe-link">
          <input type="hidden" name="propertyId" value={property.id} />
          <span><b>{unlinked.length}</b> more enquir{unlinked.length === 1 ? 'y mentions' : 'ies mention'} {street} but {unlinked.length === 1 ? 'isn’t' : 'aren’t'} linked to this property yet.</span>
          <button className="btn btn-gold btn-sm" type="submit">Link {unlinked.length === 1 ? 'it' : 'them'}</button>
        </form>
      ) : null}
      {rows.length === 0 ? (
        <p className="card-sub" style={{ marginTop: 10 }}>No enquiries linked yet. Enquiries from the website link themselves; imported emails link when they mention this street.</p>
      ) : (
        <>
          {recent.length ? (
            <>
              <h3 className="pm-h">Recent · last {Math.round(RECENT_DAYS / 30)} months · {recent.length}</h3>
              <div className="enq">{recent.map((g) => <EnquiryItem key={g.row.e.id} {...g.row} trail={g.trail} times={g.times} onProperty />)}</div>
            </>
          ) : null}
          {older.length ? (
            <>
              <h3 className="pm-h">Older · {older.length}</h3>
              <div className="enq">{older.map((g) => <EnquiryItem key={g.row.e.id} {...g.row} trail={g.trail} times={g.times} onProperty />)}</div>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
