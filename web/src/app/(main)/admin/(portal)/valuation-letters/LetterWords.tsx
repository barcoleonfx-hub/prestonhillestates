'use client'

import { useState } from 'react'
import { joinLetter, splitLetter } from '@/lib/postal-letter-rules'
import { AiWrite } from '../AiWrite'

/**
 * The words of the letter, above and below the QR code. "Write with AI" writes both as one letter (from what's in
 * the boxes, our reviews and what the property report holds), then puts each part back in its box.
 */
export function LetterWords({ before: b0, after: a0 }: { before: string; after: string }) {
  const [before, setBefore] = useState(b0)
  const [after, setAfter] = useState(a0)
  return (
    <>
      <AiWrite place="valuation-letter" ctx={{}} value={joinLetter(before, after)} onChange={(v) => { const s = splitLetter(v); setBefore(s.before); setAfter(s.after) }} />
      <div className="vl-grid">
        <label className="field"><span className="flabel">Before the QR code</span><textarea className="textarea" name="before" rows={6} value={before} onChange={(e) => setBefore(e.target.value)} /></label>
        <label className="field"><span className="flabel">After the QR code</span><textarea className="textarea" name="after" rows={9} value={after} onChange={(e) => setAfter(e.target.value)} /></label>
      </div>
    </>
  )
}
