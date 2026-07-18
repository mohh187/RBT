// Moyasar TEST-mode journey validator.
//
// Proves the payment leg the Cloud Functions depend on — create hosted invoice,
// poll status, fetch the settled payment — WITHOUT deploying anything. Run it,
// open the printed URL, pay with a Moyasar TEST card, and watch it settle.
//
// SAFETY: refuses to run unless MOYASAR_SECRET_KEY is a TEST key (sk_test_...),
// so it can never create a real charge.
//
// Usage:
//   node scripts/moyasar-test-journey.mjs            # 10.00 SAR
//   node scripts/moyasar-test-journey.mjs 25         # 25.00 SAR
//
// Reads MOYASAR_SECRET_KEY from functions/.env (or the process env).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = join(here, '..', 'functions', '.env')

function readEnv(path) {
  const out = {}
  let txt = ''
  try { txt = readFileSync(path, 'utf8') } catch { return out }
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

const env = readEnv(envPath)
const sk = env.MOYASAR_SECRET_KEY || process.env.MOYASAR_SECRET_KEY || ''
if (!sk) { console.error('No MOYASAR_SECRET_KEY found in functions/.env'); process.exit(1) }
if (!sk.startsWith('sk_test_')) {
  console.error('REFUSING TO RUN: MOYASAR_SECRET_KEY is not a TEST key (expected sk_test_...).')
  console.error('Set the Moyasar TEST secret key in functions/.env first, to avoid real charges.')
  process.exit(1)
}

const amountSar = Number(process.argv[2]) || 10
const amount = Math.round(amountSar * 100) // halalas — same conversion the functions use
const authHeader = 'Basic ' + Buffer.from(sk + ':').toString('base64')

async function moyasar(pathname, opts = {}) {
  const r = await fetch('https://api.moyasar.com/v1' + pathname, {
    ...opts,
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${pathname} -> HTTP ${r.status}: ${JSON.stringify(j)}`)
  return j
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

async function main() {
  console.log(`\n=== Moyasar TEST journey - ${amountSar.toFixed(2)} SAR (${amount} halalas) ===`)
  const invoice = await moyasar('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      amount, currency: 'SAR', description: 'rbt360 test journey',
      success_url: 'https://menu-88996.web.app/pay/return?intent=TEST',
      metadata: { source: 'test-journey' },
    }),
  })
  console.log('\nInvoice created:', invoice.id, '| status:', invoice.status)
  console.log('\n>>> OPEN THIS URL AND PAY WITH A TEST CARD:\n   ', invoice.url)
  console.log('\n   Moyasar test card : 4111 1111 1111 1111')
  console.log('   Expiry / CVC      : any future date / any 3 digits')
  console.log('   Name              : any')
  console.log('   3-D Secure OTP    : follow the on-screen test prompt (Moyasar test OTP)')
  console.log('\nPolling invoice status every 5s (Ctrl+C to stop)...')

  const startedMs = Date.now()
  const TIMEOUT = 8 * 60 * 1000
  while (Date.now() - startedMs < TIMEOUT) {
    await sleep(5000)
    let cur
    try { cur = await moyasar('/invoices/' + invoice.id) } catch (e) { console.log('  poll error:', e.message); continue }
    console.log('  status:', cur.status)
    if (cur.status === 'paid') {
      console.log('\nPAID. Settled payment(s):')
      for (const p of cur.payments || []) {
        const src = p.source || {}
        console.log(`  - ${p.id} | ${p.status} | ${p.amount} halalas | ${src.type || ''} ${src.company || ''} ${src.number || ''}`)
      }
      console.log('\nRESULT: createInvoice + status polling + payment fetch all work with this test key.')
      console.log('These are the exact Moyasar calls used by createPayIntent / settleFromPayment / the webhook.')
      return
    }
    if (cur.status === 'failed' || cur.status === 'canceled') { console.log('\nInvoice', cur.status, '- stopping.'); return }
  }
  console.log('\nTimed out waiting for payment (8 min).')
}
main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1) })
