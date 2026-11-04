import 'server-only'
import { inflateRawSync } from 'node:zlib'

/** Reads the files out of a .zip held in memory (stored or deflated entries). Enough for OS open data downloads. */
export function unzip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a zip file')
  let count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  // Zip64 (very large archives) keeps the real values elsewhere.
  if (off === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20
    if (buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('Unsupported zip')
    const z64 = Number(buf.readBigUInt64LE(loc + 8))
    count = Number(buf.readBigUInt64LE(z64 + 32))
    off = Number(buf.readBigUInt64LE(z64 + 48))
  }
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    let csize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32)
    let local = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (csize === 0xffffffff || local === 0xffffffff) {
      // Zip64 extra field holds the 64-bit sizes and offset.
      let e = off + 46 + nameLen
      const end = e + extraLen
      while (e < end) {
        const id = buf.readUInt16LE(e), size = buf.readUInt16LE(e + 2)
        if (id === 0x0001) {
          let p = e + 4
          if (buf.readUInt32LE(off + 24) === 0xffffffff) p += 8 // uncompressed size
          if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(p)); p += 8 }
          if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(p))
        }
        e += 4 + size
      }
    }
    if (want(name)) {
      const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28)
      const start = local + 30 + lNameLen + lExtraLen
      const data = buf.subarray(start, start + csize)
      out.set(name, method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : Buffer.alloc(0))
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}
