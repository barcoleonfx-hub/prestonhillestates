import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Encrypts small secrets (like the mailbox password) before they're stored in the database,
// with a key derived from AUTH_SECRET, so a copy of the database alone doesn't reveal them.

function key() {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 16) throw new Error('AUTH_SECRET must be set to store passwords')
  return createHash('sha256').update(`phe-secret-box:${secret}`).digest()
}

export function seal(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.')
}

export function open(sealed: string): string | null {
  try {
    const [v, iv, tag, enc] = sealed.split('.')
    if (v !== 'v1') return null
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
