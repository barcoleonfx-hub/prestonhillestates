import Link from 'next/link'
import type { ActivityItem } from '@/lib/activity'
import { fmtTime } from '@/lib/time'
import { LogCallButton } from './LogCallButton'

/** One line per thing that happened: calls, emails, walk-ins, website enquiries, bookings, outcomes. */
export function ActivityFeed({ items, meId, showDay }: { items: ActivityItem[]; meId: string; showDay?: (iso: string) => string }) {
  return (
    <ol className="feed">
      {items.map((i) => (
        <li key={i.id} className={`feed-item t-${i.type}${i.open ? ' open' : ''}`}>
          <span className="feed-time num">{showDay ? <small>{showDay(i.at)}</small> : null}{fmtTime(i.at)}</span>
          <span className="feed-dot" aria-hidden="true" />
          <div className="feed-main">
            <div className="feed-top">
              <span className="feed-label">{i.label}</span>
              {i.open ? <span className="pill warn">Needs a reply</span> : null}
              {i.staffName ? <span className="feed-who">{i.staffId === meId ? 'You' : i.staffName}</span> : null}
            </div>
            <div className="feed-title">{i.href ? <Link href={i.href}>{i.title}</Link> : i.title}</div>
            {i.body ? <p className="feed-body pre">{i.body}</p> : null}
            {i.contactPhone && (i.type === 'enquiry' || i.type === 'call') ? <a className="feed-phone" href={`tel:${i.contactPhone}`}>{i.contactPhone}</a> : null}
          </div>
          {i.open && i.enquiry ? (
            <div className="feed-actions">
              <LogCallButton
                label="Call them" className="btn btn-dark btn-sm"
                prefill={{
                  name: i.enquiry.name, phone: i.enquiry.phone ?? undefined, email: i.enquiry.email ?? undefined, enquiryId: i.enquiry.id, direction: 'out',
                  propertyId: i.enquiry.propertyId ?? undefined, ...(i.contactId ? { contactId: i.contactId } : {}),
                  callerType: i.enquiry.kind === 'valuation' ? (i.enquiry.intent === 'letting' ? 'landlord' : 'seller') : i.enquiry.channel === 'let' ? 'tenant' : 'buyer',
                }}
              />
              <Link className="btn btn-ghost btn-sm" href={`/admin/diary/new?enquiry=${i.enquiry.id}`}>{i.enquiry.kind === 'valuation' ? 'Book valuation' : 'Book viewing'}</Link>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
