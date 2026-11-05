'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addReviews, readScreenshots, type FoundReview } from '../../review-actions'

type Row = FoundReview & { include: boolean; category: string }

/** Shrinks a screenshot to at most 2000px on its longest side as a JPEG, so six fit in one upload. */
async function shrink(f: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(f)
    const k = Math.min(1, 2000 / Math.max(img.width, img.height))
    if (k === 1 && f.size < 1_500_000) return f
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b ?? f), 'image/jpeg', 0.88))
  } catch { return f }
}

/** Upload screenshots of Google reviews; check what was read; add the ones you want. */
export function ScreenshotImport() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function read(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true); setMsg(null); setRows(null)
    const fd = new FormData()
    const files = [...((e.currentTarget.elements.namedItem('shots') as HTMLInputElement).files ?? [])].slice(0, 6)
    for (const [i, f] of files.entries()) { const b = await shrink(f); fd.append('shots', b, `shot-${i + 1}.${b.type === 'image/jpeg' ? 'jpg' : 'png'}`) }
    const r = await readScreenshots(fd).catch(() => ({ reviews: [], error: 'The portal didn’t answer. Try again in a minute.' }))
    setBusy(false)
    if (r.error && !r.reviews.length) return setMsg({ ok: false, text: r.error })
    if (!r.reviews.length) return setMsg({ ok: false, text: 'No reviews were found in those screenshots.' })
    setRows(r.reviews.map((x) => ({ ...x, include: !x.duplicate && x.rating >= 4, category: 'general' })))
  }
  async function add() {
    if (!rows) return
    setBusy(true)
    const r = await addReviews(rows.filter((x) => x.include).map((x) => ({ author: x.author, rating: x.rating, month: x.month, text: x.text, category: x.category }))).catch(() => null)
    setBusy(false)
    if (!r) return setMsg({ ok: false, text: 'They didn’t save. Try again.' })
    setMsg({ ok: true, text: `${r.added} review${r.added === 1 ? '' : 's'} added.` }); setRows(null)
    router.refresh()
  }

  return (
    <div className="rv-shots">
      <form onSubmit={read} className="rv-shots-pick">
        <input type="file" name="shots" accept="image/png,image/jpeg,image/webp" multiple required />
        <button className="btn btn-gold" type="submit" disabled={busy}>{busy && !rows ? 'Reading the screenshots…' : 'Read the screenshots'}</button>
      </form>
      <p className="card-sub">Up to 6 at a time. Phone or computer screenshots both work; it takes about 10 to 20 seconds.</p>
      {msg ? <div className={`notice ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{msg.text}</div> : null}
      {rows ? (
        <>
          <p className="card-sub" style={{ marginTop: 12 }}>Check each one against the screenshot, then add the ones you want. Reviews under 4 stars are never shown on the website.</p>
          <div className="rv-found">
            {rows.map((r, i) => (
              <div key={i} className={`rv-found-row${r.include ? ' on' : ''}`}>
                <label className="rv-inc"><input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} /> Add</label>
                <div className="rv-found-main">
                  <div className="rv-found-top">
                    <input className="input" value={r.author} onChange={(e) => set(i, { author: e.target.value })} aria-label="Name" />
                    <select className="select" value={r.rating} onChange={(e) => set(i, { rating: Number(e.target.value), include: Number(e.target.value) >= 4 && r.include })} aria-label="Stars">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} {n}</option>)}</select>
                    <input className="input" type="month" value={r.month ?? ''} onChange={(e) => set(i, { month: e.target.value || null })} aria-label="Month" title={`Shown on Google as “${r.when}”`} />
                    <select className="select" value={r.category} onChange={(e) => set(i, { category: e.target.value })} aria-label="Show on"><option value="general">Sales and lettings</option><option value="sales">Sales</option><option value="lettings">Lettings</option></select>
                  </div>
                  <textarea className="input" rows={3} value={r.text} onChange={(e) => set(i, { text: e.target.value })} aria-label="Review" />
                  <div className="addr-sub">
                    {r.duplicate ? 'Already added. ' : ''}{r.truncated ? 'The words were cut off in the screenshot (“More”): open the review on Google, take a screenshot of the full text, or paste the rest. ' : ''}{r.rating < 4 ? 'Under 4 stars: kept for your records only. ' : ''}Google showed the date as “{r.when}”.
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn btn-gold" type="button" onClick={add} disabled={busy || !rows.some((x) => x.include)}>{busy ? 'Adding…' : `Add ${rows.filter((x) => x.include).length} review${rows.filter((x) => x.include).length === 1 ? '' : 's'}`}</button>
            <button className="btn btn-ghost" type="button" onClick={() => setRows(null)} disabled={busy}>Cancel</button>
          </div>
        </>
      ) : null}
    </div>
  )
}
