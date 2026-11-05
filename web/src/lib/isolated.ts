import 'server-only'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Heavy one-off work (reading a council's 300+ page register PDF) runs in a separate, short-lived Node process,
// so its memory is handed back the moment it finishes and can never push the web server over its limit.

const PDF_SCRIPT = `
const [, , unpdfUrl, input, output] = process.argv
const fs = require('fs')
import(unpdfUrl).then(async ({ getDocumentProxy }) => {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(input)))
  const out = fs.openSync(output, 'w')
  for (let i = 1; i <= Math.min(pdf.numPages, 2500); i++) {
    const page = await pdf.getPage(i)
    const c = await page.getTextContent()
    let line = '', lastY = null, lines = []
    for (const it of c.items) {
      const y = Math.round(it.transform[5])
      if (lastY != null && Math.abs(y - lastY) > 2) { lines.push(line.trim()); line = '' }
      line += it.str + ' '; lastY = y
    }
    if (line.trim()) lines.push(line.trim())
    fs.writeSync(out, lines.join('\\n') + '\\n')
    page.cleanup()
  }
  fs.closeSync(out)
  await pdf.destroy()
}).catch((e) => { console.error(e && e.message || String(e)); process.exit(2) })
`

/** The text of a PDF, one table row per line, read in a child process with its own memory cap. */
export async function pdfTextIsolated(buf: Buffer, opts: { maxMb?: number; timeoutMs?: number } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'phe-pdf-'))
  try {
    const input = path.join(dir, 'in.pdf'), output = path.join(dir, 'out.txt'), script = path.join(dir, 'read.cjs')
    await writeFile(input, buf)
    await writeFile(script, PDF_SCRIPT)
    const unpdf = pathToFileURL(path.join(/* turbopackIgnore: true */ process.cwd(), 'node_modules', 'unpdf', 'dist', 'index.mjs')).href
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${opts.maxMb ?? 256}`, script, unpdf, input, output], { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      child.stderr.on('data', (d) => { err += d })
      const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Reading the register took too long')) }, opts.timeoutMs ?? 240_000)
      child.on('exit', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`Couldn’t read the register PDF${err ? `: ${err.trim().slice(0, 200)}` : ''}`)) })
      child.on('error', (e) => { clearTimeout(t); reject(e) })
    })
    return await readFile(output, 'utf8')
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
