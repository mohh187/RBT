// The email templates, pinned by test.
//
// WHY THIS FILE EXISTS. Three defects shipped together and all three were
// invisible to code review:
//
//  1. DIRECTION. The templates declared RTL once, on <html>. Gmail strips
//     <html>/<head>/<body> and keeps only what is between them, so that
//     declaration was discarded and every report arrived left-to-right. Reading
//     the source, it looks right. Only rendering it and asking "which nodes
//     survive a sanitiser" shows it is not.
//
//  2. LANGUAGE. Every string was a hard-coded Arabic literal, so an English
//     menu still produced an Arabic email. The completeness of a translation is
//     exactly the sort of thing an eye cannot verify across ~60 strings.
//
//  3. LOGO GEOMETRY. A 60px square inside a 78px circle puts its corners
//     sqrt(30^2+30^2)=42.4 from the centre, past the 38px inner radius, so all
//     four stuck out. That is 3.4px — a real defect that a human comparing two
//     screenshots will not reliably see.
//
// The checks below are the ones a reviewer cannot perform by looking.
//
// scripts/guard.mjs walks src/ only, so the no-emoji / Latin-digits rules have
// never been mechanically enforced in functions/ — where all this new English
// prose gets typed. The last case closes that, against RENDERED output, which
// is stricter than source: it also catches an Arabic-Indic digit that arrives
// through toLocaleString at runtime.
import { createRequire } from 'node:module'

const require_ = createRequire(new URL('../functions/', import.meta.url))
const { shell, header, facts, lineTable, section, money } = require_('./emailTemplates.js')
const { venueBrand, platformBrand } = require_('./emailBrand.js')
const { PLATFORM_SELLER, addressAr } = require_('./platformSeller.js')

// ── the two hard project rules, verbatim from scripts/guard.mjs ──────────
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F02F}]/u
const ARABIC_INDIC = /[٠-٩۰-۹]/
const ARABIC = /[؀-ۿ]/

let pass = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; return }
  fails.push(`${name}${detail ? `\n      ${detail}` : ''}`)
}

// A venue whose DATA is entirely Latin. Any Arabic character in an English
// render is therefore necessarily a hard-coded literal — which makes case 1 the
// only mechanical proof that the translation work is actually complete.
const LATIN_VENUE = {
  name: 'Mazaj Cafe', slug: 'mazaj', themeColor: '#7A1E2B',
  phone: '0500000000', address: 'Riyadh', vatNumber: '300000000000003',
  logoUrl: 'https://example.test/logo.webp',
}

// Our own REGISTERED legal identity is Arabic and stays Arabic in an English
// mail: a commercial-registration name and a Saudi national address are the
// values on file, not prose to be translated. They are excluded by value, so a
// new Arabic literal appearing anywhere else still fails.
const REGISTERED = [PLATFORM_SELLER.legalNameAr, addressAr(PLATFORM_SELLER)].filter(Boolean)

const body = (b) => [
  facts([['Order number', '1042'], ['Table', '7']], { dir: b.dir }),
  lineTable([{ name: 'Flat White', qty: 2, total: money(26, 'SAR', { lang: b.lang }) }], 'Total', money(26, 'SAR', { lang: b.lang }), { dir: b.dir }),
  section(b, 'Movement', [['Paid orders', '86'], ['Revenue', money(3420, 'SAR', { lang: b.lang }), 'strong']]),
].join('')

const render = (brand) => shell(brand, {
  title: 'Your order is ready', preheader: 'Ready for pickup',
  body: body(brand), cta: { label: 'Track order', href: 'https://example.test/o/1' },
})

// ── 1. no Arabic survives an English render ──────────────────────────────
for (const [who, brand] of [
  ['venueBrand', venueBrand(LATIN_VENUE, 'en')],
  ['platformBrand', platformBrand({}, 'en')],
]) {
  let html = render(brand)
  REGISTERED.forEach((v) => { html = html.split(v).join('') })
  const stray = (html.match(new RegExp(`[^\\s>]*${ARABIC.source}[^\\s<]*`, 'g')) || [])
    // The riyal mark's alt text is an Arabic word by design; it is the accessible
    // name of a glyph, not prose, and never renders as text.
    .filter((s) => !s.includes('alt="ريال"'))
  ok(`${who}: an English render contains no Arabic literal`, stray.length === 0,
    stray.length ? `found: ${stray.slice(0, 4).join(' | ')}` : '')
}

// ── 2. direction is a parameter, not a constant ──────────────────────────
{
  const ar = render(venueBrand(LATIN_VENUE, 'ar'))
  const en = render(venueBrand(LATIN_VENUE, 'en'))
  ok('ar: <body> carries dir="rtl"', /<body[^>]+dir="rtl"/.test(ar))
  ok('ar: the wrapper table Gmail keeps carries dir="rtl"', /<table[^>]+dir="rtl"/.test(ar))
  ok('ar: direction is also inline (attributes alone are strippable)',
    (ar.match(/direction:rtl/g) || []).length >= 4,
    `only ${(ar.match(/direction:rtl/g) || []).length} inline direction declarations`)
  ok('en: not one rtl anywhere', !/rtl/.test(en),
    (en.match(/.{0,30}rtl.{0,30}/) || [''])[0])
  ok('en: <body> carries dir="ltr"', /<body[^>]+dir="ltr"/.test(en))
}

// ── 3. every directional cell states its own alignment ───────────────────
// The regression that returns the moment someone adds a row type: a <td> with
// no align inherits, and inheritance is exactly what the sanitiser destroys.
for (const [name, html] of [
  ['facts', facts([['k', 'v']], { dir: 'rtl' })],
  ['lineTable', lineTable([{ name: 'x', qty: 1, total: '5' }], 'Total', '5', { dir: 'rtl' })],
  ['section', section(venueBrand(LATIN_VENUE, 'ar'), 'T', [['k', 'v']])],
]) {
  const tds = (html.match(/<td/g) || []).length
  const aligned = (html.match(/align="/g) || []).length
  ok(`${name}: every <td> has an explicit align`, tds > 0 && tds === aligned,
    `${tds} cells, ${aligned} aligned`)
}

// ── 4. values sit at the END of the row, whichever way it runs ────────────
{
  const rtl = facts([['k', '1']], { dir: 'rtl' })
  const ltr = facts([['k', '1']], { dir: 'ltr' })
  ok('rtl: the value cell is aligned left (the row end)', /align="left"[^>]*dir="ltr"/.test(rtl))
  ok('ltr: the value cell is aligned right (the row end)', /align="right"[^>]*dir="ltr"/.test(ltr))
  ok('both: the value cell is always dir="ltr" (it holds a number)',
    /dir="ltr"/.test(rtl) && /dir="ltr"/.test(ltr))
}

// ── 5. the logo cannot poke out of its circle. as arithmetic. ────────────
// Written so that raising the cap back to 60 fails AND says why.
{
  const html = header(venueBrand(LATIN_VENUE, 'ar'))
  const cap = Number((html.match(/max-width:(\d+)px/) || [])[1])
  const INNER_R = 38            // 78px disc, 1px border
  ok('logo: a square at this size fits inside the disc',
    cap > 0 && (cap / 2) * Math.SQRT2 <= INNER_R,
    `max-width:${cap}px puts the corners at ${((cap / 2) * Math.SQRT2).toFixed(1)}px, outside the ${INNER_R}px radius`)
  ok('logo: no object-fit (it centre-crops a wide wordmark and most clients ignore it)',
    !/object-fit/.test(html))
  ok('logo: the disc cannot collapse to an oval when the image is shorter',
    /line-height:78px/.test(html))

  // A masked logo has transparent corners, so nothing can protrude and it is
  // allowed to fill the disc.
  const round = header(venueBrand({ ...LATIN_VENUE, logoRoundUrl: 'https://example.test/logo-round.png' }, 'ar'))
  const rcap = Number((round.match(/max-width:(\d+)px/) || [])[1])
  ok('logo: an already-masked logo is allowed to be larger', rcap > cap, `${rcap} vs ${cap}`)
  ok('logo: the masked copy is the one used', /logo-round\.png/.test(round))
}

// ── 6. the hard project rules, finally enforced in functions/ ────────────
for (const lang of ['ar', 'en']) {
  const html = render(venueBrand(LATIN_VENUE, lang))
  ok(`${lang}: no emoji in rendered mail`, !EMOJI.test(html))
  ok(`${lang}: no Arabic-Indic numerals in rendered mail`, !ARABIC_INDIC.test(html),
    (html.match(/.{0,20}[٠-٩۰-۹].{0,20}/) || [''])[0])
}

// ── 7. the real builders, at source ──────────────────────────────────────
// The seven email builders live inside Firestore triggers and cannot be invoked
// here without standing up a database, so cases 1-6 exercise the TEMPLATES with
// a synthetic body. This case covers the builders themselves, and it targets the
// four positions where an untranslated string is both most likely and most
// visible: the subject line and preheader (which are built OUTSIDE shell() and
// are the first things the reader sees, in the inbox list, before opening
// anything), the title, and button labels.
//
// Method: delete every `p('عربي', 'english')` pick — the sanctioned way to write
// a bilingual string — then look for Arabic that is left. What remains is a
// literal nobody gave an English twin.
{
  const { readFileSync } = await import('node:fs')
  const FILES = ['messaging.js', 'invoicing.js', 'campaigns.js', 'platformExtensions.js']
  // A pick call, including the nested-quote and template-literal forms actually
  // used in these files.
  const PICK = /\b(?:p|L\([^)]*\))\(\s*(?:`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')\s*,/g
  const STR = String.raw`(?:\`(?:[^\`\\]|\\.)*\`|'(?:[^'\\]|\\.)*')`
  // `label:` alone is too broad — it is also the description on a stored
  // invoice line (`label: 'عربون حجز'`), which is Saudi receipt DATA and stays
  // Arabic. A CTA is specifically `{ label, href }`, so require the href.
  const KEYS = new RegExp(String.raw`\b(subject|title|preheader)\s*:\s*(${STR})|\b(label)\s*:\s*(${STR})\s*,\s*href`, 'g')

  for (const f of FILES) {
    const src = readFileSync(new URL(`../functions/${f}`, import.meta.url), 'utf8')
      // Comments are prose about the code, not code. They are allowed Arabic.
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const bad = []
    let m
    while ((m = KEYS.exec(src))) {
      const key = m[1] || m[3]
      const raw = m[2] || m[4]
      // The Arabic half of a pick is consumed by PICK; anything still Arabic
      // after that was never given an English twin.
      const val = raw.replace(PICK, '')
      if (ARABIC.test(val) && !REGISTERED.some((r) => val.includes(r))) bad.push(`${key}: ${raw.slice(0, 60)}`)
    }
    ok(`${f}: every subject/title/preheader/label is bilingual`, bad.length === 0,
      bad.slice(0, 3).join('\n      '))
  }
}

if (fails.length) {
  console.error(`\n  email-guard: ${fails.length} FAILED, ${pass} passed\n`)
  fails.forEach((f) => console.error(`   x  ${f}`))
  console.error('')
  process.exit(1)
}
console.log(`  email-guard: ${pass} checks passed`)
