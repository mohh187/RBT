// Set where a document series starts numbering.
//
// The counter holds the LAST issued number, so to make the next quotation
// QT-2026-0098 the stored value must be 97.
//
// Only ever RAISES a counter — lowering one would re-issue numbers that are
// already on documents in customers' hands, which is the one thing a gap-free
// sequence must never do.
//
//   node scripts/seed-doc-counters.mjs                      # show current
//   node scripts/seed-doc-counters.mjs --quote 98 --apply   # next quote = 0098
//   node scripts/seed-doc-counters.mjs --invoice 1 --apply
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { initializeApp, applicationDefault } = require('../functions/node_modules/firebase-admin/lib/app/index.js')
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js')

const argv = process.argv
const APPLY = argv.includes('--apply')
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i > -1 && argv[i + 1] ? Number(argv[i + 1]) : null
}
const YEAR = String(arg('year') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 4))

initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'menu-88996' })
const db = getFirestore()
const ref = db.doc('platformCounters/seq')

const snap = await ref.get()
const cur = snap.exists ? (snap.data() || {}) : {}
console.log(`platformCounters/seq — year ${YEAR}`)
for (const s of ['invoice', 'credit', 'quote', 'legacy']) {
  const v = Number(cur[s] && cur[s][YEAR]) || 0
  console.log(`  ${s.padEnd(8)} last issued ${v}  → next ${v + 1}`)
}

const patch = {}
for (const s of ['invoice', 'credit', 'quote', 'legacy']) {
  const want = arg(s)
  if (want == null) continue
  const last = Math.max(0, Math.floor(want) - 1)
  const existing = Number(cur[s] && cur[s][YEAR]) || 0
  if (last < existing) {
    console.log(`\n  REFUSED ${s}: would move ${existing} back to ${last} — numbers already issued cannot be reused.`)
    continue
  }
  patch[s] = { ...(cur[s] || {}), [YEAR]: last }
  console.log(`\n  ${APPLY ? 'SET' : 'would set'} ${s} → next number is ${last + 1}`)
}

if (!Object.keys(patch).length) {
  console.log('\nNothing to change. Pass e.g. --quote 98 --apply')
  process.exit(0)
}
if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}
await ref.set(patch, { merge: true })
console.log('\nWritten.')
process.exit(0)
