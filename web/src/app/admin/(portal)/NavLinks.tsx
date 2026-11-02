'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ICONS: Record<string, React.ReactNode> = {
  dash: <path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-5H3zM14 7h7V3h-7z" />,
  homes: <path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />,
  mail: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  site: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function NavLinks({ newEnquiries }: { newEnquiries: number }) {
  const path = usePathname()
  const on = (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href)) ? 'on' : undefined
  return (
    <nav className="admin-nav" aria-label="Admin">
      <Link href="/admin" className={on('/admin')}><Icon name="dash" />Dashboard</Link>
      <Link href="/admin/properties" className={on('/admin/properties')}><Icon name="homes" />Properties</Link>
      <Link href="/admin/enquiries" className={on('/admin/enquiries')}>
        <Icon name="mail" />Enquiries{newEnquiries > 0 ? <span className="count">{newEnquiries}</span> : null}
      </Link>
      <a href="/properties" target="_blank" rel="noreferrer"><Icon name="site" />View website</a>
    </nav>
  )
}
