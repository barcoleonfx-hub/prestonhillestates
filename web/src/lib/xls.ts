import 'server-only'

// Reads ".xls" files, the kind Rentman and older software export, without any extra library. An ".xls" can be
// any of three things, all handled here:
//  - a real Excel 97–2003 workbook (a "compound file" holding BIFF8 records),
//  - a web page with a <table> saved under an .xls name,
//  - Excel 2003 XML ("SpreadsheetML").
// Dates come through as Excel day numbers (e.g. 41802), which the importer understands.

export type Sheet = { name: string; rows: string[][] }

export function readXlsSheets(buf: Buffer): Sheet[] {
  if (buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1) return biff(compoundStream(buf, ['Workbook', 'Book']))
  const text = decodeText(buf)
  if (/<Workbook\b[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(text) || /<ss:Workbook\b/i.test(text)) return spreadsheetMl(text)
  if (/<table\b/i.test(text)) return htmlTables(text)
  return [] // plain text: the caller reads it as CSV / tab-separated
}

/** The file as text (UTF-8 or the UTF-16 some exports use), for .xls files that are really tab-separated text. */
export const decodeText = (buf: Buffer) => (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^﻿/, ''))
const entities = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const clean = (rows: string[][]) => rows.filter((r) => r.some((x) => x.trim()))

// ---------- web page saved as .xls ----------
function htmlTables(html: string): Sheet[] {
  const out: Sheet[] = []
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...t[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => {
      const row: string[] = []
      for (const c of r[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
        row.push(entities(c[3]))
        const span = Number(/colspan\s*=\s*"?(\d+)/i.exec(c[2])?.[1] ?? 1)
        for (let i = 1; i < Math.min(span, 50); i++) row.push('')
      }
      return row
    })
    if (clean(rows).length) out.push({ name: `Sheet ${out.length + 1}`, rows: clean(rows) })
  }
  return out
}

// ---------- Excel 2003 XML ----------
function spreadsheetMl(xml: string): Sheet[] {
  const out: Sheet[] = []
  for (const ws of xml.matchAll(/<(?:ss:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi)) {
    const name = entities(/(?:ss:)?Name="([^"]*)"/i.exec(ws[1])?.[1] ?? `Sheet ${out.length + 1}`)
    const rows: string[][] = []
    for (const r of ws[2].matchAll(/<(?:ss:)?Row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)) {
      const row: string[] = []
      for (const c of (r[1] ?? '').matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
        const idx = Number(/(?:ss:)?Index="(\d+)"/i.exec(c[1])?.[1] ?? 0)
        if (idx) while (row.length < idx - 1) row.push('')
        const data = /<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(c[2] ?? '')
        let v = data ? entities(data[2]) : ''
        // Dates are written as 2014-06-12T00:00:00.000: hand them over as dd/mm/yyyy.
        if (data && /Type="DateTime"/i.test(data[1])) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (m) v = `${m[3]}/${m[2]}/${m[1]}` }
        if (data && /Type="Boolean"/i.test(data[1])) v = v === '1' ? 'TRUE' : 'FALSE'
        row.push(v)
      }
      rows.push(row)
    }
    out.push({ name, rows: clean(rows) })
  }
  return out
}

// ---------- compound file (the container of a real .xls) ----------
function compoundStream(buf: Buffer, names: string[]): Buffer {
  const sectorSize = 1 << buf.readUInt16LE(0x1e), miniSize = 1 << buf.readUInt16LE(0x20)
  const dirStart = buf.readInt32LE(0x30), cutoff = buf.readUInt32LE(0x38)
  const miniFatStart = buf.readInt32LE(0x3c), difatStart = buf.readInt32LE(0x44), difatCount = buf.readUInt32LE(0x48)
  const sector = (id: number) => buf.subarray((id + 1) * sectorSize, (id + 2) * sectorSize)
  // The FAT's own sectors are listed in the header (first 109) and then in a chain of DIFAT sectors.
  const fatSectors: number[] = []
  for (let i = 0; i < 109; i++) { const id = buf.readInt32LE(0x4c + i * 4); if (id >= 0) fatSectors.push(id) }
  for (let d = difatStart, n = 0; d >= 0 && n < difatCount && n < 10000; n++) {
    const s = sector(d), per = sectorSize / 4 - 1
    for (let i = 0; i < per; i++) { const id = s.readInt32LE(i * 4); if (id >= 0) fatSectors.push(id) }
    d = s.readInt32LE(per * 4)
  }
  const fat: number[] = []
  for (const id of fatSectors) { const s = sector(id); for (let i = 0; i < sectorSize; i += 4) fat.push(s.readInt32LE(i)) }
  const chain = (start: number, table: number[]) => { const out: number[] = []; for (let id = start, n = 0; id >= 0 && n < 1_000_000; n++) /* negative ids end a chain */ { out.push(id); id = table[id] ?? -2 } return out }
  const read = (start: number) => Buffer.concat(chain(start, fat).map(sector))
  // Directory entries: 128 bytes each.
  const dir = read(dirStart)
  const entries: { name: string; type: number; start: number; size: number }[] = []
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = dir.readUInt16LE(o + 0x40)
    entries.push({ name: dir.subarray(o, o + Math.max(0, len - 2)).toString('utf16le'), type: dir[o + 0x42], start: dir.readInt32LE(o + 0x74), size: dir.readUInt32LE(o + 0x78) })
  }
  const root = entries.find((e) => e.type === 5)
  const want = entries.find((e) => e.type === 2 && names.includes(e.name))
  if (!want) throw new Error('No workbook inside this .xls file')
  if (want.size >= cutoff || !root) return read(want.start).subarray(0, want.size)
  // Small streams live in the "mini stream", in 64-byte pieces listed by the mini FAT.
  const miniStream = read(root.start)
  const miniFat: number[] = []
  if (miniFatStart >= 0) { const m = read(miniFatStart); for (let i = 0; i + 4 <= m.length; i += 4) miniFat.push(m.readInt32LE(i)) }
  return Buffer.concat(chain(want.start, miniFat).map((id) => miniStream.subarray(id * miniSize, (id + 1) * miniSize))).subarray(0, want.size)
}

// ---------- BIFF8 records (the workbook itself) ----------
function biff(wb: Buffer): Sheet[] {
  // Every record: type (2 bytes), length (2 bytes), data. CONTINUE records (0x3c) carry on the one before.
  type Rec = { type: number; data: Buffer; pieces: Buffer[] }
  const recs: (Rec & { at: number })[] = []
  for (let o = 0; o + 4 <= wb.length;) {
    const type = wb.readUInt16LE(o), len = wb.readUInt16LE(o + 2)
    const data = wb.subarray(o + 4, o + 4 + len)
    if (type === 0x3c && recs.length) { const last = recs[recs.length - 1]; last.pieces.push(data) } else recs.push({ type, data, pieces: [data], at: o })
    o += 4 + len
  }
  const sheets: { name: string; at: number }[] = []
  let sst: string[] = []
  for (const r of recs) {
    if (r.type === 0x85) { // BOUNDSHEET: where each sheet starts, and its name
      const at = r.data.readUInt32LE(0), kind = r.data[5]
      if (kind === 0) sheets.push({ name: shortString(r.data, 6), at })
    } else if (r.type === 0xfc) sst = readSst(r.pieces)
    else if (r.type === 0x0a) break // end of the workbook part; sheets follow
  }
  const out: Sheet[] = []
  for (const s of sheets) {
    const startIdx = recs.findIndex((r) => r.at === s.at)
    if (startIdx < 0) continue
    const cells = new Map<number, Map<number, string>>()
    const put = (row: number, col: number, v: string) => { if (!cells.has(row)) cells.set(row, new Map()); cells.get(row)!.set(col, v) }
    let pendingFormula: [number, number] | null = null
    for (let i = startIdx + 1; i < recs.length; i++) {
      const { type, data } = recs[i]
      if (type === 0x0a) break // EOF of this sheet
      if (data.length < 6 && type !== 0x207) continue
      const row = data.readUInt16LE(0), col = data.readUInt16LE(2)
      if (type === 0xfd) put(row, col, sst[data.readUInt32LE(6)] ?? '') // LABELSST
      else if (type === 0x203) put(row, col, num(data.readDoubleLE(6))) // NUMBER
      else if (type === 0x27e) put(row, col, num(rk(data.readUInt32LE(6)))) // RK
      else if (type === 0xbd) { // MULRK: several numbers in a row
        const last = data.readUInt16LE(data.length - 2)
        for (let c = col, o = 4; c <= last && o + 6 <= data.length - 2; c++, o += 6) put(row, c, num(rk(data.readUInt32LE(o + 2))))
      } else if (type === 0x204) put(row, col, longString(Buffer.concat(recs[i].pieces), 6)) // LABEL
      else if (type === 0x205) put(row, col, data[7] === 0 ? (data[6] ? 'TRUE' : 'FALSE') : '') // BOOLERR
      else if (type === 0x06) { // FORMULA: its last result
        if (data.readUInt16LE(12) === 0xffff) {
          const k = data[6]
          if (k === 0) pendingFormula = [row, col]
          else if (k === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE')
        } else put(row, col, num(data.readDoubleLE(6)))
      } else if (type === 0x207 && pendingFormula) { put(pendingFormula[0], pendingFormula[1], longString(Buffer.concat(recs[i].pieces), 0)); pendingFormula = null }
    }
    const maxRow = Math.max(-1, ...cells.keys())
    const rows: string[][] = []
    for (let r = 0; r <= maxRow; r++) {
      const m = cells.get(r)
      if (!m) { rows.push([]); continue }
      const width = Math.max(...m.keys()) + 1
      rows.push(Array.from({ length: width }, (_, c) => m.get(c) ?? ''))
    }
    out.push({ name: s.name, rows: clean(rows) })
  }
  return out
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e9) / 1e9))
function rk(v: number) {
  const n = v & 2 ? (v >> 2) : (() => { const b = Buffer.alloc(8); b.writeUInt32LE(v & 0xfffffffc, 4); return b.readDoubleLE(0) })()
  return v & 1 ? n / 100 : n
}
/** ShortXLUnicodeString: 1-byte length, flags, characters. */
function shortString(b: Buffer, o: number) {
  const n = b[o], wide = b[o + 1] & 1
  return wide ? b.subarray(o + 2, o + 2 + n * 2).toString('utf16le') : b.subarray(o + 2, o + 2 + n).toString('latin1')
}
/** XLUnicodeString: 2-byte length, flags, characters. */
function longString(b: Buffer, o: number) {
  const n = b.readUInt16LE(o), wide = b[o + 2] & 1
  return wide ? b.subarray(o + 3, o + 3 + n * 2).toString('utf16le') : b.subarray(o + 3, o + 3 + n).toString('latin1')
}
/** The shared string table. Strings can break across CONTINUE records, which restart with a fresh flags byte. */
function readSst(pieces: Buffer[]): string[] {
  let p = 0, o = 8
  const out: string[] = []
  const total = pieces[0].readUInt32LE(4)
  const need = (n: number) => { while (o + n > pieces[p].length && p < pieces.length - 1 && o >= pieces[p].length) { p++; o = 0 } }
  const u8 = () => { need(1); return pieces[p][o++] }
  const u16 = () => { if (o + 2 > pieces[p].length) { const lo = u8(); return lo | (u8() << 8) } const v = pieces[p].readUInt16LE(o); o += 2; return v }
  const u32 = () => { const lo = u16(); return lo + u16() * 65536 }
  const skip = (n: number) => { while (n > 0 && p < pieces.length) { const here = Math.min(n, pieces[p].length - o); o += here; n -= here; if (n > 0) { p++; o = 0 } } }
  for (let s = 0; s < total && p < pieces.length; s++) {
    if (o >= pieces[p].length) { if (p >= pieces.length - 1) break; p++; o = 0 }
    const cch = u16(), flags = u8()
    let wide = flags & 1
    const runs = flags & 8 ? u16() : 0, ext = flags & 4 ? u32() : 0
    let str = '', left = cch
    while (left > 0 && p < pieces.length) {
      if (o >= pieces[p].length) { if (p >= pieces.length - 1) break; p++; o = 0; wide = pieces[p][o++] & 1 } // continued: new flags byte
      const fit = Math.min(left, Math.floor((pieces[p].length - o) / (wide ? 2 : 1)))
      str += wide ? pieces[p].subarray(o, o + fit * 2).toString('utf16le') : pieces[p].subarray(o, o + fit).toString('latin1')
      o += fit * (wide ? 2 : 1); left -= fit
      if (fit === 0 && left > 0) { o = pieces[p].length }
    }
    skip(runs * 4 + ext)
    out.push(str)
  }
  return out
}
