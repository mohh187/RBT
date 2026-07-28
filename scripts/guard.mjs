// HARD-RULES guard (user-mandated, absolute): NO emojis and NO Arabic-Indic
// numerals anywhere in src/. Run via `npm run guard` (part of `npm run check`).
// Exits 1 with file:line listings when a violation is found.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'src')

// emoji blocks (pictographs, transport, flags, emoji-presentation) —
// deliberately NOT flagging monochrome text glyphs (✓ ✕ ★ − ×) used as icons
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u
const ARABIC_DIGITS = /[٠-٩۰-۹]/

const violations = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(jsx?|css|html)$/.test(name)) {
      const lines = readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (EMOJI.test(line)) violations.push(`${p}:${i + 1} EMOJI: ${line.trim().slice(0, 80)}`)
        if (ARABIC_DIGITS.test(line)) violations.push(`${p}:${i + 1} ARABIC-DIGIT: ${line.trim().slice(0, 80)}`)
      })
    }
  }
}
walk(SRC)

// ---- MIRROR DRIFT: the spend meter's numbers exist twice ----
// functions/spend.js decides what to refuse; src/lib/spend.js shows the venue
// what its ceiling is. functions/ is CommonJS and must not be bundled into the
// browser, so the tables are duplicated — and a meter that DISPLAYS a different
// limit from the one that REFUSES you is worse than showing nothing at all.
// This makes the drift a build failure instead of a support ticket.
// SPEND_PACKS is in here for a sharper reason than the rest: the client SHOWS
// a price and the server CHARGES one. If those two ever disagree the customer
// is billed an amount they did not see.
// Every server/client pair whose numbers must agree. Add a pair here rather
// than trusting a «change BOTH sides together» comment — that is precisely the
// contract this exists because nobody keeps.
const MIRRORS = [
  {
    server: 'functions/spend.js',
    client: 'src/lib/spend.js',
    objects: ['PLAN_QUOTAS', 'BURST_PER_MINUTE', 'UNIT_COST_USD', 'SPEND_PACKS'],
    // A single number, but every margin figure the finance engine produces
    // multiplies through it — a drift here misstates the whole P&L silently.
    scalars: ['USD_TO_SAR'],
  },
  {
    server: 'functions/platformPricing.js',
    client: 'src/lib/platformPricing.js',
    objects: ['FALLBACK_PRICES', 'FALLBACK_LIST_PRICES'],
    scalars: ['YEARLY_DISCOUNT'],
  },
  {
    // The legal identity. It prints on the landing footer (client) and is
    // stamped onto every issued invoice (server). A CR or VAT number that
    // disagrees between the marketing page and the tax invoice is a
    // discrepancy the buyer's accountant finds before we do.
    server: 'functions/platformSeller.js',
    client: 'src/lib/platformSeller.js',
    objects: ['PLATFORM_SELLER'],
  },
]

// The object literal that follows `<name> = `, up to its closing brace, with
// comments and whitespace stripped so formatting differences are not drift.
const grabObject = (src, name) => {
  const at = src.indexOf(`${name} = {`)
  if (at < 0) return null
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '') }
  }
  return null
}
// A bare numeric assignment: `const USD_TO_SAR = 3.75`.
const grabScalar = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(-?[0-9.]+)`))
  return m ? m[1] : null
}

for (const pair of MIRRORS) {
  try {
    const server = readFileSync(join(ROOT, ...pair.server.split('/')), 'utf8')
    const client = readFileSync(join(ROOT, ...pair.client.split('/')), 'utf8')
    const check = (name, grab) => {
      const a = grab(server, name)
      const b = grab(client, name)
      if (!a || !b) violations.push(`mirror: ${name} not found in ${!a ? pair.server : pair.client}`)
      else if (a !== b) violations.push(`mirror DRIFT in ${name}\n      ${pair.server}: ${a}\n      ${pair.client}: ${b}`)
    }
    for (const name of pair.objects || []) check(name, grabObject)
    for (const name of pair.scalars || []) check(name, grabScalar)
  } catch (e) {
    violations.push(`mirror ${pair.server} <-> ${pair.client}: could not compare — ${e.message}`)
  }
}

if (violations.length) {
  console.error(`HARD-RULE VIOLATIONS (${violations.length}):`)
  violations.forEach((v) => console.error('  ' + v))
  process.exit(1)
} else {
  console.log('guard: clean — no emojis, no Arabic-Indic digits in src/')
}
