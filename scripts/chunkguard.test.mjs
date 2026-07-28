// The stale-chunk detector, pinned by test.
//
// WHY THIS FILE EXISTS. On 2026-07-28 a venue manager hit
// «Cannot read properties of undefined (reading 'default')» on /admin/screens
// and had to refresh by hand, even though this codebase already had
// stale-chunk self-healing. The self-heal missed because firebase.json rewrites
// `**` to /index.html, so a deleted chunk URL answers 200 text/html instead of
// 404 — the fetch SUCCEEDS and none of the "failed to fetch" phrasings ever
// appear. Verified against production, not assumed:
//     curl -o /dev/null -w '%{http_code} %{content_type}' \
//       https://rbt360sa.com/assets/Screens-DEADBEEF.js
//     -> 200 text/html; charset=utf-8
//
// The detector is a regex over an error MESSAGE, which makes it exactly the
// kind of thing that rots silently: browsers reword their errors, and nobody
// notices until the next deploy strands a tab. The two directions matter
// equally —
//   a miss  = the user sees a crash card and must refresh by hand (the bug)
//   a false = a REAL bug gets "fixed" by a reload and is never reported (worse)
//
// Reads the regexes straight out of the source so the test cannot drift from
// the implementation it is guarding.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const src = readFileSync(join(ROOT, 'src', 'components', 'ErrorBoundary.jsx'), 'utf8')

const grab = (name) => {
  const m = src.match(new RegExp(`const ${name} = (/.*/i)`))
  if (!m) throw new Error(`${name} not found in ErrorBoundary.jsx — did it get renamed?`)
  // eslint-disable-next-line no-eval
  return eval(m[1])
}
const CHUNK_RE = grab('CHUNK_RE')
const STALE_MODULE_RE = grab('STALE_MODULE_RE')
const isChunkError = (s) => CHUNK_RE.test(s) || STALE_MODULE_RE.test(s)

// [message, shouldSelfHeal, why]
const CASES = [
  // --- stale chunk: must self-heal --------------------------------------
  ["Cannot read properties of undefined (reading 'default')", true, 'Chrome/Edge — the exact crash that was reported'],
  ["undefined is not an object (evaluating 'n.default')", true, 'Safari, same failure'],
  ['can\'t access property "default", mod is undefined', true, 'Firefox, same failure'],
  ["Unexpected token '<'", true, 'index.html parsed as an ES module'],
  ['Failed to fetch dynamically imported module: /assets/X-abc.js', true, 'the classic 404 case'],
  ['Loading chunk 42 failed.', true, 'webpack-era phrasing, still emitted by some browsers'],
  ['Importing a module script failed.', true, 'Safari preload failure'],
  ['Loading chunk failed: module resolved without a default export', true, 'thrown by our own lazyRoute()'],

  // --- real bugs: must NOT reload ---------------------------------------
  ["Cannot read properties of undefined (reading 'name')", false, 'ordinary undefined deref'],
  ["Cannot read properties of undefined (reading 'length')", false, 'ordinary undefined deref'],
  ["Cannot read properties of null (reading 'default')", false, 'NULL, not undefined — our code did this, not the network'],
  ['t.map is not a function', false, 'ordinary type error'],
  ['Minified React error #310', false, 'a real React violation'],
  ['Cannot read properties of undefined (reading \'defaultValue\')', false, 'must not match on a prefix of «default»'],
]

let failed = 0
for (const [msg, want, why] of CASES) {
  const got = isChunkError(msg)
  if (got === want) continue
  failed++
  console.error(`  FAIL  ${want ? 'should self-heal' : 'should NOT reload'} — ${why}\n        ${JSON.stringify(msg)}`)
}

if (failed) {
  console.error(`\nchunkguard: ${failed} of ${CASES.length} failed`)
  process.exit(1)
}
console.log(`chunkguard: ${CASES.length} cases pass — stale chunks self-heal, real bugs still report`)
