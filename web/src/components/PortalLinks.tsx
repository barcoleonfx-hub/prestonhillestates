import { existsSync } from 'node:fs'
import path from 'node:path'
import { ACCREDITATIONS, PORTALS } from '@/lib/site'

function logoFor(folder: string, key: string): string | null {
  for (const ext of ['svg', 'png', 'webp', 'jpg']) {
    if (existsSync(path.join(process.cwd(), 'public', folder, `${key}.${ext}`))) return `/${folder}/${key}.${ext}`
  }
  return null
}

/** Links to the branch's Zoopla and OnTheMarket pages, using the official logo when one has been added. */
export function PortalLinks({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <div className={`portal-links ${tone}`}>
      {PORTALS.map((p) => {
        const logo = logoFor('portals', p.key)
        return (
          <a key={p.key} className="portal-link" href={p.url} target="_blank" rel="noopener noreferrer"
            aria-label={`Preston Hill Estates on ${p.name} (opens in a new tab)`}>
            {logo ? <img src={logo} alt={p.name} /> : <span className="pname">{p.name}</span>}
            <span className="pgo" aria-hidden="true">↗</span>
          </a>
        )
      })}
    </div>
  )
}

/** The schemes the branch belongs to; each one downloads our certificate. Logos replace the names once added. */
export function AccreditationLinks() {
  return (
    <div className="acc-links">
      {ACCREDITATIONS.map((a) => {
        const logo = logoFor('accreditations', a.key)
        return (
          <a key={a.key} href={a.cert} download title={`${a.name}: download our certificate (PDF)`} aria-label={`${a.name}: download our certificate (PDF)`}>
            {logo ? <img src={logo} alt={a.name} /> : a.name}
          </a>
        )
      })}
    </div>
  )
}
