// End-to-end check of staff accounts, the diary, alerts and the required outcome form, using two people signed in at once.
// Usage: node scripts/e2e-diary.mjs <baseUrl> <adminEmail> <adminPassword> <screenshotDir>
import { createRequire } from 'node:module'
import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const { createClient } = require('@libsql/client')

const [base, email, password, shots] = process.argv.slice(2)
const db = createClient({ url: 'file:./data/prestonhill.db' })
const log = (...a) => console.log('•', ...a)
const shot = (page, name, full = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full })
const assert = (c, m) => { if (!c) { console.error('FAILED:', m); process.exit(1) } }

// Start clean: remove test staff and appointments left by earlier runs.
await db.batch([
  "DELETE FROM notification_reads",
  "DELETE FROM notifications",
  "DELETE FROM tasks",
  "DELETE FROM appointments",
  "DELETE FROM admins WHERE email LIKE 'sarah.%@test.local'",
], 'write')

const browser = await chromium.launch()
async function signIn(em, pw) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}/admin/login`)
  await page.fill('#email', em)
  await page.fill('#password', pw)
  await page.click('button[type=submit]')
  await page.waitForURL(`${base}/admin`)
  await page.mouse.click(5, 5) // a click unlocks sound, as a person would
  return page
}

// 1. Admin adds a negotiator.
const A = await signIn(email, password)
log('admin signed in')
const sarahEmail = `sarah.${Date.now()}@test.local`
await A.goto(`${base}/admin/staff`)
await A.fill('#st-name', 'Sarah Khan')
await A.fill('#st-email', sarahEmail)
await A.fill('#st-phone', '07700 900123')
await A.click('text=Add staff member')
await A.waitForSelector('.notice.ok code')
const sarahPw = await A.textContent('.notice.ok code')
log('added Sarah, starting password shown once')
await shot(A, 'd01-staff')

// 2. Sarah signs in on her own screen.
const B = await signIn(sarahEmail, sarahPw)
log('Sarah signed in')
assert(!(await B.locator('a[href="/admin/staff"]').count()), 'negotiators should not see Staff')
await B.goto(`${base}/admin/staff`)
assert(B.url() === `${base}/admin`, 'negotiator blocked from staff page')
log('Staff page is admin only')

// 3. Admin books a viewing for tomorrow at 10:00 with Sarah going.
await A.goto(`${base}/admin/diary/new`)
await A.click('.chips[aria-label=Day] .chip:nth-child(2)') // Tomorrow
await A.click('.slot:has-text("10:00")')
await A.click('.chip:has-text("45 min")')
const hasProps = await A.locator('.bk-proplist button').count()
if (hasProps) await A.locator('.bk-proplist button').first().click()
else await A.fill('#bk-address', '12 Kenton Road, Harrow HA3 8AA')
await A.click('.staffopt:has-text("Sarah Khan")')
await A.fill('#bk-cn', 'Daniel Okafor')
await A.fill('#bk-cp', '07700 900456')
await A.fill('#bk-notes', 'First time buyer, mortgage agreed in principle. Keys in the office.')
await shot(A, 'd02-booking-form', true)
await A.click('text=Book and alert everyone')
await Promise.race([A.waitForURL(/\/admin\/diary\/[0-9a-f-]{36}\?saved=booked/), A.waitForSelector('.bk-err')])
assert(!(await A.locator('.bk-err').count()), `booking refused: ${await A.locator('.bk-err').textContent().catch(() => '')}`)
const apptId = A.url().split('/diary/')[1].split('?')[0]
log('booked', apptId)
await shot(A, 'd03-booked')

// 4. Sarah gets the pop-up within one poll.
await B.waitForSelector('.alert-card', { timeout: 30000 })
const alertText = await B.textContent('.alert-card')
assert(alertText.includes('New viewing booked') && alertText.includes('You'), 'Sarah sees the booking alert naming her')
log('Sarah alerted:', alertText.replace(/\s+/g, ' ').slice(0, 140))
await shot(B, 'd04-alert-on-sarah')
await A.waitForTimeout(1500)
assert(!(await A.locator('.alert-card').count()), 'admin is not alerted about their own booking')

// 5. Double booking is caught.
await A.goto(`${base}/admin/diary/new`)
await A.click('.chips[aria-label=Day] .chip:nth-child(2)')
await A.click('.slot:has-text("10:30")')
await A.fill('#bk-address', '3 Preston Road, Wembley HA9 8PL')
await A.click('.staffopt:has-text("Sarah Khan")')
assert((await A.textContent('.staffopt:has-text("Sarah Khan") .sfree')).startsWith('Busy'), 'busy marker shown')
await A.fill('#bk-cn', 'Priya Shah')
await A.fill('#bk-cp', '07700 900789')
await A.click('text=Book and alert everyone')
await A.waitForSelector('.bk-err')
log('clash caught:', (await A.textContent('.bk-err')).replace(/\s+/g, ' ').slice(0, 120))
await shot(A, 'd05-clash', true)

// 6. Got it clears Sarah's alert; then the reminder fires for everyone.
await B.click('.alert-card >> text=Got it')
await B.waitForSelector('.alert-card', { state: 'detached' })
await db.execute({ sql: 'UPDATE appointments SET starts_at = ?, reminder_min = 30, reminded_at = NULL WHERE id = ?', args: [new Date(Date.now() + 20 * 60000).toISOString(), apptId] })
await B.reload()
await B.waitForSelector('.alert-card.k-reminder', { timeout: 30000 })
await A.waitForSelector('.alert-card.k-reminder', { timeout: 30000 })
log('reminder on both screens')
await shot(B, 'd06-reminder')

// 7. Once it's over, Sarah is locked out until she records the outcome.
await db.execute({ sql: 'UPDATE appointments SET starts_at = ? WHERE id = ?', args: [new Date(Date.now() - 2 * 3600000).toISOString(), apptId] })
await B.goto(`${base}/admin/properties`)
await B.waitForSelector('.gate')
await shot(B, 'd07-outcome-gate')
assert(await B.locator('.admin-main').getAttribute('inert') !== null, 'page behind the gate is inert')
await B.click('.gate >> text=Save outcome')
assert(await B.locator('.gate').count() === 1, 'empty outcome is not accepted')
await B.click('.gate .chip:has-text("Went ahead")')
await B.click('.gate .chip:has-text("Interested, second viewing")')
await B.fill('#gate-notes', 'Loved the garden, worried about the second bedroom size. Wants to bring parents on Saturday.')
await B.click('.gate .chip:has-text("Book second viewing")')
await shot(B, 'd08-outcome-filled')
await B.click('.gate >> text=Save outcome')
await B.waitForSelector('.gate', { state: 'detached' })
log('outcome saved, portal unlocked')
const row = (await db.execute({ sql: 'SELECT status, outcome, outcome_interest, outcome_next FROM appointments WHERE id = ?', args: [apptId] })).rows[0]
assert(row.status === 'completed' && row.outcome === 'attended', 'outcome stored')
await B.goto(`${base}/admin/diary/${apptId}`)
await shot(B, 'd09-detail-with-outcome')

// 8. Diary and dashboard views.
await A.goto(`${base}/admin/diary?view=past`)
await shot(A, 'd10-diary-past')
await A.goto(`${base}/admin/diary`)
await shot(A, 'd11-diary')

// 9. Emails went to everyone, with a calendar invite on the booking.
const outbox = path.join(process.cwd(), 'data', 'outbox')
const files = readdirSync(outbox).filter((f) => f.includes(sarahEmail.replace(/[^a-z0-9@.]+/gi, '_')))
log('emails to Sarah:', files.length)
const booking = files.map((f) => readFileSync(path.join(outbox, f), 'utf8')).find((t) => t.includes('Subject: Booked'))
assert(booking && booking.includes('text/calendar'), 'booking email carries a calendar invite')
log('booking email subject:', /Subject: (.*)/.exec(booking)[1])

await browser.close()
log('all diary checks passed')
