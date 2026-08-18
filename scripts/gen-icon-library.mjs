// Regenerates src/lib/iconLibraryData.js from the installed lucide-react.
// Run after upgrading lucide:  node scripts/gen-icon-library.mjs
//
// See the long comment at the top of the generated file for WHY the vector data
// is extracted instead of importing the library — short version: importing the
// barrel put 745 kB on first paint because Icon.jsx shares that module graph.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'

const DIR = 'node_modules/lucide-react/dist/esm/icons'
const OUT = 'src/lib/iconLibraryData.js'

const compact = {}
let aliases = 0
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(path.join(DIR, f), 'utf8')
  const m = src.match(/createLucideIcon\("([^"]+)",\s*(\[[\s\S]*?\])\s*\);/)
  if (!m) { aliases++; continue } // alias re-export of another icon
  let arr
  try {
    arr = JSON.parse(m[2].replace(/(\w+):/g, '"$1":').replace(/,(\s*[}\]])/g, '$1'))
  } catch { aliases++; continue }
  compact[m[1]] = arr.map(([tag, attrs]) => {
    const a = { ...attrs }
    delete a.key
    return `${tag}|${Object.entries(a).map(([k, v]) => `${k}=${v}`).join('~')}`
  }).join(';;')
}

const names = Object.keys(compact).sort()
const ordered = {}
for (const n of names) ordered[n] = compact[n]

const version = JSON.parse(readFileSync('node_modules/lucide-react/package.json', 'utf8')).version
const header = `// GENERATED — lucide-react v${version} vector data (ISC licensed).
//
// Regenerate with scripts/gen-icon-library.mjs when lucide is upgraded.
//
// WHY THIS FILE EXISTS INSTEAD OF IMPORTING lucide-react.
//
// The icon browser needs to enumerate every glyph at once. Doing that with
// \`import * as Lucide from 'lucide-react'\` defeats tree-shaking, and because
// Icon.jsx imports from the same barrel EAGERLY for the app chrome, rollup put
// the whole set in a shared chunk — 745 kB downloading on first paint for a
// feature almost nobody opens. Measured, not assumed.
//
// Holding the raw vector data instead breaks that coupling completely: nothing
// here touches lucide's module graph, so this file lands in its own chunk that
// only loads when the icon tab is opened. It also makes a saved design
// reproducible — the element stores its own markup, so a sticker keeps printing
// identically even if lucide renames or redraws a glyph.
//
// Alias re-exports of other icons are dropped; only unique glyphs are kept.
//
// Format, chosen to stay compact:
//   "Name": "tag|attr=val~attr=val;;tag|attr=val"
// Nodes split on ';;', tag from attrs on '|', attrs on '~', key/value on the
// first '='. lucide's react \`key\` props are stripped — they carry no geometry.

export const LUCIDE_VIEWBOX = '0 0 24 24'
export const LUCIDE_ICON_DATA = `

writeFileSync(OUT, header + JSON.stringify(ordered, null, 0) + '\n')
console.log(`${OUT}: ${names.length} icons, ${aliases} aliases skipped, ${Math.round(statSync(OUT).size / 1024)} KB`)
