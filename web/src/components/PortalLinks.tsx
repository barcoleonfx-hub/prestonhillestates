import { existsSync } from 'node:fs'
import path from 'node:path'
import { PORTALS } from '@/lib/site'

function logoFor(key: string): string | null {
  for (const ext of ['svg', 'png', 'webp']) {
    if (existsSync(path.join(process.cwd(), 'public', 'portals', `${key}.${ext}`))) return `/portals/${key}.${ext}`
  }
  return null
}

/** Links to the branch's Zoopla and OnTheMarket pages, using the official logo when one has been added. */
export function PortalLinks({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <div className={`portal-links ${tone}`}>
      {PORTALS.map((p) => {
        const logo = logoFor(p.key)
        return (
          <a
            key={p.key}
            className="portal-link"
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Preston Hill Estates on ${p.name} (opens in a new tab)`}
          >
            {logo ? <img src={logo} alt={p.name} /> : <span className="pname">{p.name}</span>}
            <span className="pgo" aria-hidden="true">↗</span>
          </a>
        )
      })}
    </div>
  )
}
