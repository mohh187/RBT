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
const MIRRORED = ['PLAN_QUOTAS', 'BURST_PER_MINUTE', 'UNIT_COST_USD']
const grab = (src, name) => {
  // the literal that follows `<name> = ` up to its closing brace, comments and
  // whitespace stripped so formatting differences are not reported as drift
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
try {
  const server = readFileSync(join(ROOT, 'functions', 'spend.js'), 'utf8')
  const client = readFileSync(join(ROOT, 'src', 'lib', 'spend.js'), 'utf8')
  for (const name of MIRRORED) {
    const a = grab(server, name)
    const b = grab(client, name)
    if (!a || !b) violations.push(`spend mirror: ${name} not found in ${!a ? 'functions/spend.js' : 'src/lib/spend.js'}`)
    else if (a !== b) violations.push(`spend mirror DRIFT in ${name}\n      functions/spend.js: ${a}\n      src/lib/spend.js:   ${b}`)
  }
} catch (e) {
  violations.push(`spend mirror: could not compare — ${e.message}`)
}

if (violations.length) {
  console.error(`HARD-RULE VIOLATIONS (${violations.length}):`)
  violations.forEach((v) => console.error('  ' + v))
  process.exit(1)
} else {
  console.log('guard: clean — no emojis, no Arabic-Indic digits in src/')
}
