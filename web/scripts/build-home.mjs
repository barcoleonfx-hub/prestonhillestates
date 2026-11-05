// Turns the approved homepage design (concept/homepage_src.html) into the live homepage:
// writes src/app/(home)/home.css and src/app/(home)/home-content.ts.
// Keeps the design exactly as approved and swaps the concept's sample bits for real ones
// (live listings, working search, valuation form and pop-up wired to the portal, real links).
// Run after editing the concept file:  node scripts/build-home.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(path.join(web, '../concept/homepage_src.html'), 'utf8')
const out = path.join(web, 'src/app/(home)')

/** Replace exactly `count` occurrences, so changes to the concept that break a swap are noticed. */
function swap(text, find, replace, count = 1) {
  const n = typeof find === 'string' ? text.split(find).length - 1 : (text.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) || []).length
  if (n !== count) throw new Error(`Expected ${count} match(es) for ${String(find).slice(0, 80)}, found ${n}`)
  return typeof find === 'string' ? text.split(find).join(replace) : text.replace(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g'), replace)
}

// ---------- CSS ----------
let css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'))
css = swap(css, 'url(data:font/woff2;base64,__ROMAN_B64__)', "url('/fonts/fraunces-roman.woff2')")
css = swap(css, 'url(data:font/woff2;base64,__ITALIC_B64__)', "url('/fonts/fraunces-italic.woff2')")
css += `
  /* ---------- live site additions ---------- */
  .prop .visual img.photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform 0.6s cubic-bezier(.2,.6,.2,1); }
  .prop:hover .visual img.photo { transform: scale(1.04); }
  .prop .pill { z-index: 1; }
  .prop .status { position: absolute; right: 14px; top: 14px; z-index: 1; font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; background: var(--charcoal); color: #F3D58E; padding: 6px 10px; border-radius: 999px; }
  .cardgrid .empty-card { grid-column: 1 / -1; padding: 40px; border: 1px dashed var(--line); border-radius: 20px; text-align: center; color: var(--ink-soft); background: var(--surface); }
  .cardgrid .empty-card a { color: var(--gold-deep); font-weight: 600; }
  .val-card .val-msg { font-size: 0.86rem; margin: 0; }
  .val-card .val-msg.err { color: #A8442E; }
  .val-card button.btn { border: 0; cursor: pointer; font: inherit; }
  .val-card input[aria-invalid="true"], .vp-field input[aria-invalid="true"] { border-color: #A8442E !important; }
  .val-done { text-align: center; padding: 18px 6px; }
  .val-done h3 { font-family: 'Fraunces', Georgia, serif; font-weight: 450; font-size: 1.6rem; color: var(--ink); }
  .val-done p { color: var(--ink-soft); margin-top: 6px; }
  footer.site address a { color: inherit; text-decoration: none; }
  footer.site address a:hover { text-decoration: underline; }
  .accredband img, footer.site .accred img { max-height: 30px; width: auto; display: block; }
  /* ---------- menu on phones and tablets ---------- */
  .mnav { display: none; position: relative; }
  .mnav > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--surface); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink); }
  .mnav > summary::-webkit-details-marker { display: none; }
  .mnav-bars { width: 16px; height: 10px; border-top: 2px solid currentColor; border-bottom: 2px solid currentColor; position: relative; }
  .mnav-bars::after { content: ''; position: absolute; left: 0; right: 0; top: 2px; border-top: 2px solid currentColor; }
  .mnav .mnav-close, .mnav[open] .mnav-open { display: none; }
  .mnav[open] .mnav-close { display: inline; }
  .mnav-panel { position: absolute; right: 0; top: calc(100% + 10px); width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 110px); overflow-y: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow-lg); padding: 18px 20px; display: grid; gap: 14px; z-index: 60; }
  .mnav-group { display: grid; gap: 2px; }
  .mnav-group b { font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold-deep); margin-bottom: 4px; }
  .mnav-group a { color: var(--ink); text-decoration: none; font-size: 1rem; padding: 7px 0; border-bottom: 1px solid var(--line-soft); }
  .mnav-cta { display: grid; gap: 8px; margin-top: 4px; }
  @media (max-width: 1180px) { nav.primary a.wide-only { display: none; } }
  @media (max-width: 1000px) { nav.primary { display: none; } .mnav { display: block; } }
`

// ---------- markup ----------
let html = src.slice(src.indexOf('</style>') + 8, src.indexOf('<script>')).trim()

html = swap(html, 'data:image/jpeg;base64,__FOUNDER_B64__', '/img/founder.jpg')
// Nav button and hero CTA open the full valuation page; the button inside the homepage form is replaced below.
html = swap(html, 'https://claude.ai/code/artifact/76c93993-6277-4580-b173-93622a7443ae', '/valuation', 3)
html = swap(html, '<a href="#listings">Sales</a>', '<a href="/properties?channel=sale">Sales</a>')
html = swap(html, '<a href="#listings">Lettings</a>', '<a href="/properties?channel=let">To rent</a>\n      <a href="/renting">Tenants</a>\n      <a href="/landlords">Landlords</a>')
html = swap(html, '      <a href="#services">Services</a>\n      <a href="#areas">Areas</a>', '      <a class="wide-only" href="#services">Services</a>\n      <a class="wide-only" href="#areas">Areas</a>')
// Phones and tablets: the links fold into a Menu button (no script needed: it's a <details>).
html = swap(html, '    </nav>\n  </div>\n</header>', `    </nav>
    <details class="mnav">
      <summary aria-label="Menu"><span class="mnav-bars" aria-hidden="true"></span><span class="mnav-open">Menu</span><span class="mnav-close">Close</span></summary>
      <div class="mnav-panel">
        <div class="mnav-group"><b>Buying</b><a href="/properties?channel=sale">Homes for sale</a><a href="/mortgage-calculator">How much can I borrow?</a><a href="/sold-prices">Sold prices</a></div>
        <div class="mnav-group"><b>Renting</b><a href="/properties?channel=let">Homes to rent</a><a href="/renting">Register for new homes to rent</a></div>
        <div class="mnav-group"><b>Landlords</b><a href="/landlords">Letting &amp; management</a><a href="/landlords#estimate">Rent estimate</a><a href="/fees">Fees &amp; legal</a></div>
        <div class="mnav-group"><b>Selling</b><a href="/valuation">Free valuation</a><a href="/guides">Guides</a></div>
        <div class="mnav-cta"><a class="btn gold" href="/valuation">Free valuation</a><a class="btn ghost" href="tel:+442089049005">Call 020 8904 9005</a></div>
      </div>
    </details>
  </div>
</header>`)
html = swap(html, '<a class="btn dark" href="#">View all properties</a>', '<a class="btn dark" href="/properties">View all properties</a>')
html = swap(html, /<div class="cardgrid">[\s\S]*?<p class="sample-note">[\s\S]*?<\/p>/, '<div class="cardgrid"><!--LISTINGS--></div>')
html = swap(html, '<a class="link" href="#">Selling with us', '<a class="link" href="/valuation?intent=selling">Selling with us')
html = swap(html, '<a class="link" href="#">Letting with us', '<a class="link" href="/landlords">Letting with us')
html = swap(html, '<a class="link" href="#">Management service', '<a class="link" href="/landlords#included">Management service')
html = swap(html, '<li><a href="/valuation?intent=letting">Landlord valuation</a></li>', '<li><a href="/landlords">Letting &amp; management</a></li>\n        <li><a href="/landlords#estimate">Rent estimate</a></li>')
html = swap(html, '<li><a href="#contact">Contact</a></li>', '<li><a href="/fees">Fees &amp; legal</a></li>\n        <li><a href="#contact">Contact</a></li>')
html = swap(html, /<a class="area-chip" href="#"><span class="nm">([^<]+)<\/span>/, (_m, nm) => `<a class="area-chip" href="/properties?q=${encodeURIComponent(nm)}"><span class="nm">${nm}</span>`, 8)
html = swap(html, '<li><a href="#listings">Properties for sale</a></li>', '<li><a href="/properties?channel=sale">Properties for sale</a></li>')
html = swap(html, '<li><a href="#listings">Properties to let</a></li>', '<li><a href="/properties?channel=let">Properties to let</a></li>\n        <li><a href="/renting">Register as a tenant</a></li>')
html = swap(html, '<span>Design concept · sample data, not the live site</span>', '<span>Independent estate agents in Harrow since 2004</span>')
html = swap(html, '+44 20 8904 9005<br/>', '<a href="tel:+442089049005">020 8904 9005</a><br/>')
html = swap(html, 'info@prestonhillestates.com\n', '<a href="mailto:info@prestonhillestates.com">info@prestonhillestates.com</a>\n')
html = swap(html, 'Client review · from the current site', 'Client review')

// Property search → the live search page.
html = swap(html, '<form class="searchbar" aria-label="Property search" onsubmit="return false;">',
  '<form class="searchbar" aria-label="Property search" action="/properties" method="get"><input type="hidden" name="channel" value="sale" id="q-channel"/>')
html = swap(html, '<input id="q-loc" type="text"', '<input id="q-loc" name="q" type="text"')
html = swap(html, /<select id="q-type">[\s\S]*?<\/select>/, `<select id="q-type" name="type"><option value="">Any type</option><option value="detached_house">Detached house</option><option value="semi_detached_house">Semi-detached house</option><option value="terraced_house">Terraced house</option><option value="flat">Flat</option><option value="maisonette">Maisonette</option><option value="bungalow">Bungalow</option></select>`)
html = swap(html, /<select id="q-price">[\s\S]*?<\/select>/, `<select id="q-price" name="max"><option value="">No max</option><option value="400000">£400,000</option><option value="600000">£600,000</option><option value="800000">£800,000</option><option value="1000000">£1,000,000</option></select>`)

// Valuation section form → posts to the portal.
html = swap(html, /<form class="val-card rv d2" onsubmit="return false;">[\s\S]*?<\/form>/, `<form class="val-card rv d2" id="val-form" novalidate>
        <div class="val-fields">
        <div>
          <label for="v-postcode">Property postcode</label>
          <input id="v-postcode" name="postcode" type="text" placeholder="e.g. HA3 0PS" autocomplete="postal-code" style="text-transform: uppercase;"/>
        </div>
        <div class="row2">
          <div>
            <label for="v-name">Your name</label>
            <input id="v-name" name="name" type="text" placeholder="Full name" autocomplete="name"/>
          </div>
          <div>
            <label for="v-phone">Phone</label>
            <input id="v-phone" name="phone" type="tel" placeholder="Mobile number" autocomplete="tel"/>
          </div>
        </div>
        <input type="text" name="hp_check" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"/>
        <p class="val-msg err" role="alert" hidden></p>
        <button class="btn gold" type="submit" style="width:100%;">Request my valuation</button>
        <p class="fine">Free and without obligation · a reply within one working day</p>
        </div>
        <div class="val-done" role="status" hidden>
          <h3>Thank you.</h3>
          <p>A member of the branch will call you within one working day to arrange your free valuation.</p>
        </div>
      </form>`)
// Honeypot for the pop-up form too.
html = swap(html, '<p class="vp-error" role="alert" hidden></p>', '<input type="text" name="hp_check" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"/>\n          <p class="vp-error" role="alert" hidden></p>')

// Accreditation and portal logos where we have them; otherwise the name stays as text.
const LOGO_DIRS = ['public/accreditations', 'public/portals']
function logoFor(key) {
  for (const dir of LOGO_DIRS) for (const ext of ['svg', 'png', 'webp', 'jpg']) {
    if (existsSync(path.join(web, dir, `${key}.${ext}`))) return `/${dir.replace('public/', '')}/${key}.${ext}`
  }
  return null
}
html = html.replace(/(<a [^>]*data-badge="([a-z]+)"[^>]*>)(.*?)<\/a>/g, (m, tag, key, inner) => {
  const url = logoFor(key)
  if (!url) return m
  const label = /aria-label="([^"]*)"/.exec(tag)
  const alt = label ? label[1].replace(/\s*\(opens in a new tab\)/, '') : key
  return `${tag}${inner.replace(/^[^<]+/, `<img src="${url}" alt="${alt}"> `)}</a>`
})

html = swap(html, '<li><a href="#valuation">Free valuation</a></li>', '<li><a href="/valuation">Free valuation</a></li>')

// Shared chrome for other pages that use this design (e.g. /valuation): the icon sprite, header and footer,
// with on-page anchors pointed back at the homepage.
const sprite = html.slice(0, html.indexOf('<header class="site"'))
let header = html.slice(html.indexOf('<header class="site"'), html.indexOf('</header>') + 9)
let footer = html.slice(html.indexOf('<footer class="site"'), html.indexOf('</footer>') + 9)
const toHome = (t) => t.replace(/href="#(top|listings|services|areas|heritage|founder|valuation)"/g, (_m, id) => `href="/${id === 'top' ? '' : '#' + id}"`)
header = toHome(header)
footer = toHome(footer)

// ---------- script ----------
let js = src.slice(src.indexOf('<script>') + 8, src.indexOf('</script>'))
js = swap(js, "'video/wembley-720.mp4' : 'video/wembley-1080.mp4'", "'/video/wembley-720.mp4' : '/video/wembley-1080.mp4'")
js = swap(js, "'video/wembley-last.jpg' : 'video/wembley-first.jpg'", "'/video/wembley-last.jpg' : '/video/wembley-first.jpg'")
// Same once-per-visitor rule as the pop-up on the property pages: hidden 30 days after closing, a year after sending.
js = swap(js, "var KEY = 'phe_vp_preview'", "var KEY = 'phe_valuation_popup'")
js = swap(js, 'try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}', 'try { if (Number(localStorage.getItem(KEY) || 0) > Date.now()) return; } catch (e) {}')
js = swap(js, "function close() {\n      try { sessionStorage.setItem(KEY, '1'); } catch (e) {}",
  "function close(days) {\n      try { localStorage.setItem(KEY, String(Date.now() + (typeof days === 'number' ? days : 30) * 864e5)); } catch (e) {}")
js = swap(js, "root.querySelector('.vp-done-close').addEventListener('click', close);", "root.querySelector('.vp-done-close').addEventListener('click', function () { close(365); });")
js = swap(js, "      err.hidden = true; form.hidden = true; done.hidden = false;\n      done.querySelector('button').focus();",
  `      var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      window.pheSendValuation({ name: name, phone: tel, email: mail, postcode: pc, intent: (form.querySelector('input[name=intent]:checked') || {}).value, hp_check: form.hp_check.value })
        .then(function (r) {
          btn.disabled = false; btn.textContent = 'Request my free valuation';
          if (!r.ok) { var map = { name: 'vp-name', phone: 'vp-phone', email: 'vp-email', postcode: 'vp-postcode' }; return fail(map[r.field] || 'vp-name', r.error || 'Something went wrong. Please call us on 020 8904 9005.'); }
          try { localStorage.setItem(KEY, String(Date.now() + 365 * 864e5)); } catch (e) {}
          err.hidden = true; form.hidden = true; done.hidden = false;
          done.querySelector('button').focus();
        });`)

const extra = `
/* ---------- live site: shared sender, search and valuation section ---------- */
window.pheSendValuation = function (data) {
  return fetch('/api/public/valuation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(function (r) { return r.json(); })
    .catch(function () { return { ok: false, error: 'We couldn’t send that. Please check your connection or call us on 020 8904 9005.' }; });
};
(function () {
  var channel = document.getElementById('q-channel'), price = document.getElementById('q-price');
  var BUY = [['', 'No max'], ['400000', '£400,000'], ['600000', '£600,000'], ['800000', '£800,000'], ['1000000', '£1,000,000']];
  var RENT = [['', 'No max'], ['1500', '£1,500 pcm'], ['2000', '£2,000 pcm'], ['2500', '£2,500 pcm'], ['3500', '£3,500 pcm']];
  document.querySelectorAll('.searchbar .toggle button').forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      channel.value = i === 1 ? 'let' : 'sale';
      price.innerHTML = (i === 1 ? RENT : BUY).map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    });
  });
  var form = document.getElementById('val-form'); if (!form) return;
  var msg = form.querySelector('.val-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    [].forEach.call(form.querySelectorAll('input'), function (i) { i.removeAttribute('aria-invalid'); });
    function fail(id, text) { var el = document.getElementById(id); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } msg.textContent = text; msg.hidden = false; }
    var name = form.name.value.trim(), tel = form.phone.value.trim(), pc = form.postcode.value.trim().toUpperCase().replace(/\\s+/g, ' ');
    if (!/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/.test(pc)) return fail('v-postcode', 'Enter the full postcode of the property, e.g. HA3 0PS.');
    if (!name) return fail('v-name', 'Please tell us your name.');
    if (!/^[0-9+()\\s-]{7,20}$/.test(tel)) return fail('v-phone', tel ? 'That phone number doesn’t look right.' : 'Add a phone number so the branch can call you.');
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
    window.pheSendValuation({ name: name, phone: tel, postcode: pc, intent: 'unsure', hp_check: form.hp_check.value }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Request my valuation';
      if (!r.ok) { var map = { name: 'v-name', phone: 'v-phone', postcode: 'v-postcode' }; return fail(map[r.field] || 'v-name', r.error || 'Something went wrong. Please call us on 020 8904 9005.'); }
      try { localStorage.setItem('phe_valuation_popup', String(Date.now() + 365 * 864e5)); } catch (e) {}
      form.querySelector('.val-fields').hidden = true; form.querySelector('.val-done').hidden = false;
    });
  });
})();
`
js = extra + js // the sender must exist before the pop-up code runs

writeFileSync(path.join(out, 'home.css'), `/* Generated by scripts/build-home.mjs from concept/homepage_src.html. Edit the concept file, then re-run. */\n${css}`)
writeFileSync(path.join(out, 'home-content.ts'), `// Generated by scripts/build-home.mjs from concept/homepage_src.html. Edit the concept file, then re-run.\nexport const MARKUP = ${JSON.stringify(html)}\n\nexport const SCRIPT = ${JSON.stringify(js)}\n\n/** Icon sprite, header and footer for other pages in this design. */\nexport const SPRITE = ${JSON.stringify(sprite)}\nexport const HEADER = ${JSON.stringify(header)}\nexport const FOOTER = ${JSON.stringify(footer)}\n`)
console.log(`home.css ${css.length.toLocaleString()} chars, markup ${html.length.toLocaleString()}, script ${js.length.toLocaleString()}`)
