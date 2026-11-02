// Usage: npm run create-admin -- <email> "<name>" [password]
// With no password argument a strong one is generated and printed once.
import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, migrate } from '../src/db/client'
import { admins } from '../src/db/schema'

async function main() {
  const [email, name, given] = process.argv.slice(2)
  if (!email || !name) {
    console.error('Usage: npm run create-admin -- <email> "<name>" [password]')
    process.exit(1)
  }
  if (given && given.length < 10) {
    console.error('Passwords must be at least 10 characters.')
    process.exit(1)
  }
  await migrate()
  const password = given || randomBytes(12).toString('base64url')
  const passwordHash = await bcrypt.hash(password, 12)
  const existing = await db.query.admins.findFirst({ where: eq(admins.email, email.toLowerCase()) })
  if (existing) {
    await db.update(admins).set({ name, passwordHash }).where(eq(admins.id, existing.id))
    console.log(`Updated ${email}.`)
  } else {
    await db.insert(admins).values({
      id: randomUUID(), email: email.toLowerCase(), name, passwordHash, role: 'admin', createdAt: new Date().toISOString(),
    })
    console.log(`Created admin ${email}.`)
  }
  if (!given) console.log(`Password: ${password}`)
}
main()
