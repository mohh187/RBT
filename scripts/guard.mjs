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

if (violations.length) {
  console.error(`HARD-RULE VIOLATIONS (${violations.length}):`)
  violations.forEach((v) => console.error('  ' + v))
  process.exit(1)
} else {
  console.log('guard: clean — no emojis, no Arabic-Indic digits in src/')
}
