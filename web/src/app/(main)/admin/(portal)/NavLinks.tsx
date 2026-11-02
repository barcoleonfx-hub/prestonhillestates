'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ICONS: Record<string, React.ReactNode> = {
  dash: <path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-5H3zM14 7h7V3h-7z" />,
  homes: <path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />,
  mail: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  day: <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  people: <path d="M4 5h16v14H4zM8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6.5 16c.5-1.6 1.8-2.5 3.5-2.5s3 .9 3.5 2.5M15 10h3M15 13h3" />,
  diary: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3" />,
  team: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.6 3 5.2" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5" />,
  site: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function NavLinks({ newEnquiries, today, outcomes, callbacks, isAdmin }: { newEnquiries: number; today: number; outcomes: number; callbacks: number; isAdmin: boolean }) {
  const path = usePathname()
  const on = (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href)) ? 'on' : undefined
  return (
    <nav className="admin-nav" aria-label="Admin">
      <Link href="/admin" className={on('/admin')}><Icon name="dash" />Dashboard</Link>
      <Link href="/admin/my-day" className={on('/admin/my-day')}>
        <Icon name="day" />My day{callbacks > 0 ? <span className="count" title="Callbacks due today">{callbacks}</span> : null}
      </Link>
      <Link href="/admin/contacts" className={on('/admin/contacts')}><Icon name="people" />Contacts</Link>
      <Link href="/admin/diary" className={on('/admin/diary')}>
        <Icon name="diary" />Diary
        {outcomes > 0 ? <span className="count warn" title="Outcomes waiting">{outcomes}</span> : today > 0 ? <span className="count" title="Today">{today}</span> : null}
      </Link>
      <Link href="/admin/properties" className={on('/admin/properties')}><Icon name="homes" />Properties</Link>
      <Link href="/admin/enquiries" className={on('/admin/enquiries')}>
        <Icon name="mail" />Enquiries{newEnquiries > 0 ? <span className="count">{newEnquiries}</span> : null}
      </Link>
      {isAdmin ? <Link href="/admin/staff" className={on('/admin/staff')}><Icon name="team" />Staff</Link> : null}
      <Link href="/admin/account" className={on('/admin/account')}><Icon name="user" />Your account</Link>
      <a href="/properties" target="_blank" rel="noreferrer"><Icon name="site" />View website</a>
    </nav>
  )
}
