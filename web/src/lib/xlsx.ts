import 'server-only'
import { unzip } from './zip'

// Reads the first sheet of an Excel (.xlsx) file into rows of text, without any extra library.
// Dates come through as Excel day numbers (e.g. 46022), which the importer understands.

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('')
const colIndex = (ref: string) => { const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'; let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]))
  // The first sheet in the workbook's order, found through its relationship id.
  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb)?.[1]
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : null
  const path = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` : [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort()[0]
  const sheet = files.get(path ?? '')?.toString('utf8') ?? ''
  const rows: string[][] = []
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] ?? ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? texts(inner) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : decode(v ?? '')
      const i = ref ? colIndex(ref) : row.length
      while (row.length < i) row.push('')
      row[i] = val
    }
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim()))
}
