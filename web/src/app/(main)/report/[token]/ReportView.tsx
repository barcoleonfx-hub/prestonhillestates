'use client'

import type { BookletFields, BookletInput } from '@/lib/booklet'
import { BookletPages } from '../../admin/booklet/[id]/BookletPages'

/** The booklet, read-only, with a bar to download it as a PDF (the browser's "Save as PDF"). */
export function ReportView({ data, f }: { data: BookletInput; f: BookletFields }) {
  return (
    <div className="bk-report">
      <div className="bk-report-bar">
        <div><b>Preston Hill Estates</b><span>Your property report{f.forName ? `, prepared for ${f.forName}` : ''}</span></div>
        <div className="acts">
          <a className="call" href="tel:02089049005">020 8904 9005</a>
          <button type="button" onClick={() => window.print()}>Download PDF</button>
        </div>
      </div>
      <p className="bk-report-tip">To save it: Download PDF, then choose “Save as PDF”, A4, with background graphics on.</p>
      <main className="bk-stage"><BookletPages data={data} f={f} /></main>
    </div>
  )
}
