// End-to-end check of the call log CRM with two people signed in: website lead → call → callback for a colleague,
// duplicate prevention, a new landlord booked for a valuation, and a due callback popping up and being closed.
// Usage: node scripts/e2e-crm.mjs <baseUrl> <adminEmail> <adminPassword> <screenshotDir>
// Clears contacts, calls and callbacks in the local database first. Never point it at real data.
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const { createClient } = require('@libsql/client')

const [base, email, password, shots] = process.argv.slice(2)
const db = createClient({ url: 'file:./data/prestonhill.db' })
const log = (...a) => console.log('•', ...a)
const shot = (page, name, full = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full })
const assert = (c, m) => { if (!c) { console.error('FAILED:', m); process.exit(1) } }
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0]

await db.batch([
  'DELETE FROM notification_reads', 'DELETE FROM notifications', 'DELETE FROM tasks', 'DELETE FROM calls',
  'UPDATE enquiries SET contact_id = NULL', 'UPDATE appointments SET contact_id = NULL', 'DELETE FROM audit_log', 'DELETE FROM contacts',
  "UPDATE enquiries SET handled = 1", "DELETE FROM appointments", "DELETE FROM admins WHERE email LIKE 'sarah.%@test.local'",
], 'write')

const browser = await chromium.launch()
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  page.on('dialog', (d) => d.accept())
  return page
}
async function signIn(em, pw) {
  const page = await newPage()
  await page.goto(`${base}/admin/login`)
  await page.fill('#email', em)
  await page.fill('#password', pw)
  await page.click('button[type=submit]')
  await page.waitForURL(`${base}/admin`)
  await page.mouse.click(5, 5)
  return page
}

// 1. A buyer sends a viewing request on the website.
const pub = await newPage()
await pub.goto(`${base}/properties`)
const url = await pub.evaluate(async (b) => (await (await fetch(`${b}/api/public/properties`)).json()).properties?.[0]?.url, base)
assert(url, 'need one published property (run e2e.mjs first)')
await pub.goto(url)
await pub.fill('#enq-name', 'Amira Hussain')
await pub.fill('#enq-phone', '07700 900555')
await pub.fill('#enq-message', 'Is the garden south facing?')
await pub.click('#enquiry button[type=submit]')
await pub.waitForSelector('text=Thank you')
const amira = await one("SELECT id, roles, source FROM contacts WHERE phone_norm = '07700900555'")
assert(amira && amira.roles === 'buyer' && amira.source === 'Our website', 'website enquiry created a buyer contact')
log('website enquiry → contact', amira.roles, amira.source)

// 2. Two members of staff.
const A = await signIn(email, password)
await A.goto(`${base}/admin/staff`)
const sarahEmail = `sarah.${Date.now()}@test.local`
await A.fill('#st-name', 'Sarah Khan')
await A.fill('#st-email', sarahEmail)
await A.click('text=Add staff member')
await A.waitForSelector('.notice.ok code')
const sarahPw = await A.textContent('.notice.ok code')
const B = await signIn(sarahEmail, sarahPw)
log('admin and Sarah signed in')

// 3. Admin calls the website lead back from My day and hands a callback to Sarah.
await A.goto(`${base}/admin/my-day`)
await A.waitForSelector('.lead-list >> text=Amira Hussain')
await shot(A, 'c01-my-day-lead')
await A.click('.lead-list li:has-text("Amira Hussain") >> text=Call them')
await A.waitForSelector('.call-drawer')
await A.waitForSelector('.cd-matches >> text=Amira Hussain')
await shot(A, 'c02-drawer-match')
await A.click('.cd-matches button:has-text("Amira Hussain")')
await A.waitForSelector('.cd-known >> text=Sent a viewing request on the website')
await A.click('.call-drawer .chip:has-text("Buyer")')
await A.fill('#cd-areas', 'Preston Road, Kenton')
await A.fill('#cd-budget', '650k')
await A.click('.call-drawer .chip:has-text("3")')
await A.click('.call-drawer .chip:has-text("Mortgage agreed in principle")')
await A.fill('#cd-notes', 'Garden is south west. Wants to view Saturday, Sarah to confirm a time.')
await A.click('.call-drawer .chip:has-text("Call back")')
await A.click('.cd-cb .chip:has-text("Tomorrow")')
await A.click('.cd-cb .chip:has-text("10:00")')
await A.selectOption('#cd-assign', { label: 'Sarah Khan' })
await shot(A, 'c03-drawer-filled')
await A.click('.call-drawer button[type=submit]')
await A.waitForSelector('.cd-done')
await shot(A, 'c04-drawer-done')
await A.click('.cd-done >> text=Close')
const t1 = await one('SELECT t.id, a.name FROM tasks t JOIN admins a ON a.id = t.assigned_to WHERE t.contact_id = ?', [amira.id])
assert(t1 && t1.name === 'Sarah Khan', 'callback assigned to Sarah')
assert((await one("SELECT handled FROM enquiries WHERE contact_id = ? ORDER BY created_at DESC", [amira.id])).handled === 1, 'enquiry marked handled')
const c1 = await one('SELECT max_price, min_beds, areas FROM contacts WHERE id = ?', [amira.id])
assert(c1.max_price === 650000 && c1.min_beds === 3, 'requirements saved')
log('call logged, requirements saved, callback for Sarah')

await B.waitForSelector('.alert-card.k-callback_assigned', { timeout: 30000 })
log('Sarah alerted:', (await B.textContent('.alert-card.k-callback_assigned')).replace(/\s+/g, ' ').slice(0, 90))
await B.click('.alert-card >> text=Got it')

// 4. Same person rings again from the office with the number written differently: no duplicate.
await A.goto(`${base}/admin/contacts`)
await A.waitForLoadState('networkidle')
await A.keyboard.press('n')
await A.waitForSelector('.call-drawer')
await A.fill('#cd-phone', '+44 7700 900 555')
await A.waitForSelector('.cd-matches >> text=Amira Hussain')
log('repeat caller recognised from +44 format')
await A.fill('#cd-name', 'Amira H')
await A.click('.call-drawer button[type=submit]')
await A.waitForSelector('.call-drawer .notice.err')
log('refused without caller type:', await A.textContent('.call-drawer .notice.err'))
await A.click('.call-drawer .chip:has-text("Buyer")')
await A.click('.call-drawer .chip:has-text("No action needed")')
await A.click('.call-drawer button[type=submit]')
await A.waitForSelector('.cd-done')
await A.click('.cd-done >> text=Close')
assert((await one("SELECT count(*) AS n FROM contacts WHERE phone_norm = '07700900555'")).n === 1, 'no duplicate contact')
log('still one record for Amira')

// 5. A new landlord rings and wants a valuation.
await A.keyboard.press('n')
await A.fill('#cd-phone', '020 8123 4567')
await A.fill('#cd-name', 'Graham Cole')
await A.click('.call-drawer .chip:has-text("Landlord")')
await A.fill('#cd-addr', '18 Woodcock Hill, Harrow HA3 0JQ')
await A.click('.call-drawer .chip:has-text("Tenant leaving soon")')
await A.click('.call-drawer .chip:has-text("Zoopla")')
await A.click('.call-drawer .chip:has-text("Book valuation")')
await A.click('.call-drawer button[type=submit]')
await A.waitForURL(/\/admin\/diary\/new\?contact=/)
assert(await A.inputValue('#bk-cn') === 'Graham Cole', 'booking prefilled with the caller')
assert(await A.inputValue('#bk-address') === '18 Woodcock Hill, Harrow HA3 0JQ', 'valuation address prefilled')
await A.click('.chips[aria-label=Day] .chip:nth-child(2)')
await A.click('.slot:has-text("12:00")')
await A.click('.staffopt:has-text("Sarah Khan")')
await A.click('text=Book and alert everyone')
await A.waitForURL(/saved=booked/)
const graham = await one("SELECT id, source FROM contacts WHERE phone_norm = '02081234567'")
assert(graham.source === 'Zoopla', 'source saved')
assert((await one('SELECT count(*) AS n FROM appointments WHERE contact_id = ?', [graham.id])).n === 1, 'appointment linked to contact')
log('landlord → valuation booked and linked')
await A.goto(`${base}/admin/contacts/${graham.id}`)
await shot(A, 'c05-contact-record')

// 6. Sarah's callback falls due: it pops up, she logs the call, and it closes.
await db.execute({ sql: 'UPDATE tasks SET due_at = ?, notified_at = NULL WHERE id = ?', args: [new Date(Date.now() - 60000).toISOString(), t1.id] })
await B.goto(`${base}/admin/my-day`)
await B.waitForSelector('.alert-card.k-callback', { timeout: 30000 })
await shot(B, 'c06-callback-due')
await B.click('.alert-card.k-callback >> text=Log the call')
await B.waitForSelector('.cd-known >> text=Amira Hussain')
assert(await B.isChecked('.cd-tasks input[name=closeTask]'), 'callback ticked as done by default')
await B.click('.call-drawer .chip:has-text("No action needed")')
await B.fill('#cd-notes', 'Booked her in for Saturday 11am.')
await shot(B, 'c07-callback-drawer')
await B.click('.call-drawer button[type=submit]')
await B.waitForSelector('.cd-done')
assert((await one('SELECT done_at FROM tasks WHERE id = ?', [t1.id])).done_at, 'callback closed by the call')
log('callback popped up, call logged, callback closed')
await B.click('.cd-done >> text=Close')
await B.goto(`${base}/admin/contacts/${amira.id}`)
await shot(B, 'c08-amira-record', true)

await A.goto(`${base}/admin/contacts`)
await shot(A, 'c09-contacts')
await A.goto(`${base}/admin/my-day?who=all`)
await shot(A, 'c10-my-day-office')
await browser.close()
log('all CRM checks passed')
