'use client'
import { useCallback, useEffect, useState } from 'react'

type Photo = { id: string; url: string; caption: string | null }

export function Gallery({ photos, alt }: { photos: Photo[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const go = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + photos.length) % photos.length)), [photos.length])

  useEffect(() => {
    if (open == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, go])

  if (!photos.length) return null
  const [first, ...rest] = photos

  return (
    <>
      <div className="gallery">
        <button className="main" type="button" onClick={() => setOpen(0)} aria-label="Open photo gallery" style={{ border: 0, padding: 0, display: 'block', width: '100%' }}>
          <img src={first.url} alt={first.caption || alt} />
          {photos.length > 1 ? <span className="count">View all {photos.length} photos</span> : null}
        </button>
        {rest.length ? (
          <div className="side">
            {rest.slice(0, 2).map((p, i) => (
              <button key={p.id} type="button" onClick={() => setOpen(i + 1)} aria-label={`Open photo ${i + 2}`}>
                <img src={p.url} alt={p.caption || ''} loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {open != null ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photos">
          <div className="top">
            <span>{open + 1} / {photos.length}</span>
            <button type="button" onClick={() => setOpen(null)}>Close</button>
          </div>
          <div className="stage">
            {photos.length > 1 ? <button className="nav" type="button" onClick={() => go(-1)} aria-label="Previous photo">‹</button> : null}
            <figure>
              <img src={photos[open].url} alt={photos[open].caption || alt} />
              {photos[open].caption ? <figcaption>{photos[open].caption}</figcaption> : null}
            </figure>
            {photos.length > 1 ? <button className="nav" type="button" onClick={() => go(1)} aria-label="Next photo">›</button> : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
