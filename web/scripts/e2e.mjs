// End-to-end check of the portal: sign in, create a listing, upload media, publish, view it publicly.
// Usage: node scripts/e2e.mjs <baseUrl> <email> <password> <assetsDir> <screenshotDir>
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import path from 'node:path'

const [base, email, password, assets, shots] = process.argv.slice(2)
const shot = (page, name, full = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full })
const log = (...a) => console.log('•', ...a)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('dialog', (d) => d.accept())

await page.goto(`${base}/admin/login`)
await shot(page, '01-login')
await page.fill('#email', email)
await page.fill('#password', 'wrong-password')
await page.click('button[type=submit]')
await page.waitForSelector('.notice.err')
log('wrong password rejected:', await page.textContent('.notice.err'))
await page.fill('#password', password)
await page.click('button[type=submit]')
await page.waitForURL(`${base}/admin`)
log('signed in')

await page.click('text=Add property for sale')
await page.waitForURL(/\/admin\/properties\/[0-9a-f-]{36}$/)
const editUrl = page.url()
log('created draft', editUrl)

// Try to publish an empty listing: should list what's missing.
await page.click('button[value=publish]')
await page.waitForSelector('.savebar .left span[style*="danger"]')
log('publish blocked:', (await page.textContent('.savebar .left')).slice(0, 160))

await page.fill('#addressLine1', '42')
await page.fill('#street', 'Carlton Avenue East')
await page.fill('#locality', 'Preston Road')
await page.fill('#town', 'Wembley')
await page.fill('#postcode', 'ha9 8lz')
await page.fill('#price', '810,000')
await page.selectOption('#priceQualifier', 'guide_price')
await page.selectOption('#tenure', 'freehold')
await page.selectOption('#propertyType', 'semi_detached_house')
await page.fill('#bedrooms', '4')
await page.fill('#bathrooms', '2')
await page.fill('#receptions', '2')
await page.fill('#floorAreaSqft', '1450')
await page.fill('#summary', 'An extended, halls-adjoining four bedroom semi-detached family home a short stroll from Preston Road station, offered with no onward chain.')
await page.fill('#desc', 'Preston Hill Estates is pleased to present this extended family home on one of Wembley’s most settled streets.\n\nThe ground floor offers two generous reception rooms and a kitchen opening onto a well-kept rear garden, with a ready-made additional room in the garage.')
const feats = ['Extended halls-adjoining semi', 'Two reception rooms', 'No onward chain', 'Walking distance to Preston Road station']
await page.fill('input[name=keyFeature] >> nth=0', feats[0])
for (const f of feats.slice(1)) {
  await page.click('text=+ Add a feature')
  await page.locator('input[name=keyFeature]').last().fill(f)
}
for (const [n, d] of [['Living room', '5.1m x 3.9m'], ['Kitchen', '4.2m x 3.1m'], ['Garage room', '5.0m x 2.6m']]) {
  await page.click('text=+ Add a room')
  await page.locator('input[name=roomName]').last().fill(n)
  await page.locator('input[name=roomDims]').last().fill(d)
}
await page.selectOption('#councilTaxBand', 'E')
await page.selectOption('#epcCurrent', 'D')
await page.selectOption('#epcPotential', 'B')
await page.fill('#parking', 'Driveway and garage')
await page.fill('#heating', 'Gas central heating')
await page.fill('#broadband', 'Ultrafast fibre available')
await page.fill('#videoUrl', 'not a link')
await page.click('button[value=save]')
await page.waitForSelector('text=Use a full link starting with https://')
log('bad video link rejected')
await page.fill('#videoUrl', '')
await page.click('button[value=save]')
await page.waitForSelector('text=Draft saved.')
log('draft saved')

// Uploads
const photoInput = page.locator('#sec-media input[type=file]').nth(0)
await photoInput.setInputFiles([path.join(assets, 'prop-semi.png'), path.join(assets, 'prop-terrace.png'), path.join(assets, 'prop-block.png')])
await page.waitForFunction(() => document.querySelectorAll('#sec-media .media-group:nth-child(1) .mtile').length === 3, null, { timeout: 30000 })
log('3 photos uploaded')
await page.locator('#sec-media input[type=file]').nth(1).setInputFiles(path.join(assets, 'prop-terrace.png'))
await page.locator('#sec-media input[type=file]').nth(2).setInputFiles(path.join(assets, 'tour.mp4'))
await page.waitForFunction(() => document.querySelectorAll('#sec-media .media-group:nth-child(3) .mtile').length === 1, null, { timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('#sec-media .media-group:nth-child(2) .mtile').length === 1, null, { timeout: 30000 })
log('floorplan and video uploaded')

// Wrong file type is refused with a clear message.
await page.locator('#sec-media input[type=file]').nth(3).setInputFiles(path.join(assets, 'tour.mp4'))
await page.waitForSelector('.uprow.err')
log('wrong type refused:', await page.textContent('.uprow.err'))
await page.click('.uprow.err button')

// Make the second photo the cover, and caption it.
const second = page.locator('#sec-media .media-group:nth-child(1) .mtile').nth(1)
await second.locator('input[aria-label=Caption]').fill('Front elevation')
await second.locator('text=Make cover').click()
await page.waitForFunction(() => document.querySelector('#sec-media .media-group:nth-child(1) .mtile:nth-child(1) .badge')?.textContent === 'Cover', null, { timeout: 15000 })
log('cover changed')

await page.click('button[value=publish]')
await page.waitForSelector('text=Published. This property is now on the website.')
log('published')
await page.waitForSelector('text=Live on website')
await page.evaluate(() => window.scrollTo(0, 0))
await shot(page, '03-editor-top')
await page.locator('#sec-media').scrollIntoViewIfNeeded()
await page.screenshot({ path: path.join(shots, '04-editor-media.png'), clip: await page.locator('#sec-media').boundingBox() })
await shot(page, '05-editor-full', true)

await page.goto(`${base}/admin/properties`)
await shot(page, '06-list')
await page.goto(`${base}/admin`)
await shot(page, '02-dashboard')

const href = await page.evaluate(async (u) => {
  const r = await fetch(u.replace(/\/admin\/properties\/.*/, '/api/public/properties'))
  const j = await r.json()
  return j.properties?.[0]?.url
}, editUrl)
log('public url', href)
if (href) {
  await page.goto(`${base}/properties`)
  await shot(page, '07-public-list')
  await page.goto(href)
  await shot(page, '08-public-detail', true)
  await page.fill('#enq-name', 'Test Buyer')
  await page.fill('#enq-phone', '07700 900123')
  await page.fill('#enq-message', 'Could we view on Saturday morning?')
  await page.click('#enquiry button[type=submit]')
  await page.waitForSelector('text=Thank you')
  log('enquiry sent')
  await page.goto(`${base}/admin/enquiries`)
  await page.waitForSelector('text=Test Buyer')
  await shot(page, '09-enquiries')
  log('enquiry visible in portal')
}

await browser.close()
log('DONE')
