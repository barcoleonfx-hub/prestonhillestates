import { ACCREDITATIONS, PORTALS } from '@/lib/site'

const LOGOS: Record<string, string> = { safeagent: '/accreditations/safeagent.png', mydeposits: '/accreditations/mydeposits.jpg' }

/** The schemes we belong to (each logo downloads our certificate) and the portals we're on. Sits at the foot of the page. */
export function AccreditationBand() {
  return (
    <div className="accredband" aria-label="Accreditations">
      <div className="wide row">
        <span className="grp">
          <span className="lead">Regulated &amp; accredited</span>
          <span className="hint">Click a logo to download our certificate</span>
          {ACCREDITATIONS.map((a) => (
            <a key={a.key} className="t acc" href={a.cert} download title={`${a.name}: download our certificate (PDF)`} aria-label={`${a.name}: download our certificate (PDF)`}>
              {LOGOS[a.key] ? <img src={LOGOS[a.key]} alt={a.name} /> : a.key === 'prs' ? 'PRS' : a.name}
              <span className="dl" aria-hidden="true">↓</span>
            </a>
          ))}
        </span>
        <span className="grp">
          <span className="lead">Marketed on</span>
          {PORTALS.map((p) => (
            <a key={p.key} className="portal" href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Preston Hill Estates on ${p.name} (opens in a new tab)`}>{p.name} <span className="go" aria-hidden="true">↗</span></a>
          ))}
        </span>
      </div>
    </div>
  )
}
