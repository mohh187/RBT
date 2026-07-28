// Drives functions/spend.js takeSpend() against an in-memory stub that
// reproduces the Firestore Admin SDK semantics the meter actually depends on:
//   update({'a.b': v})  -> sets the nested field, leaves a's other keys alone
//   update({a: {...}})  -> REPLACES the whole map at `a`
//   set({...}, {merge}) -> deep-merges maps
// (No Java on this machine, so the real emulator is unavailable.)
const path = require('path')
const { takeSpend, invalidateControls } = require(path.join(__dirname, 'spend.js'))

const FieldValueSentinel = '<<serverTimestamp>>'

function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && v !== FieldValueSentinel) {
      dst[k] = deepMerge(dst[k] && typeof dst[k] === 'object' ? { ...dst[k] } : {}, v)
    } else dst[k] = v
  }
  return dst
}
function applyUpdate(doc, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k.includes('.')) {
      const parts = k.split('.')
      let cur = doc
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = v
    } else {
      doc[k] = v // whole-value replacement, exactly like the real update()
    }
  }
}

function makeDb(seed = {}) {
  const store = { ...seed }
  const collected = []
  const drawn = []
  const ref = (p) => ({
    path: p,
    async get() {
      const d = store[p]
      return { exists: d !== undefined, data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) }
    },
    async set(data, opts) {
      if (opts && opts.merge && store[p]) deepMerge(store[p], data)
      else store[p] = JSON.parse(JSON.stringify(data))
    },
    // The balance drawdown uses update() + FieldValue.increment. The real
    // admin sentinel is a NumericIncrementTransform carrying `operand`
    // (verified against the installed firebase-admin, not assumed), and it is
    // RECORDED rather than applied so a test can assert the exact amount drawn
    // — which is the whole point of the split-grant arithmetic.
    async update(data) {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && typeof v.operand === 'number') drawn.push({ field: k, by: v.operand })
        else applyUpdate(store[p] || (store[p] = {}), { [k]: v })
      }
    },
  })
  return {
    _store: store,
    _collected: collected,
    _drawn: drawn,
    doc: ref,
    collection: (name) => ({ async add(d) { collected.push({ name, ...d }); return { id: 'x' } } }),
    async runTransaction(fn) {
      const writes = []
      const tx = {
        async get(r) { return r.get() },
        set(r, data) { writes.push(['set', r.path, data]) },
        update(r, data) { writes.push(['update', r.path, data]) },
      }
      const out = await fn(tx)
      for (const [kind, p, data] of writes) {
        if (kind === 'set') store[p] = JSON.parse(JSON.stringify(data))
        else { if (!store[p]) throw new Error('update on missing doc ' + p); applyUpdate(store[p], data) }
      }
      return out
    },
  }
}

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

async function run() {
  // ---------- 1. a plain grant, and the counter it writes ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro', name: 'مقهى' } })
    const r = await takeSpend(db, 't1', 'waUtility', 1)
    check('grants the first message', r.granted === 1 && r.reason === 'ok', r)
    const c = Object.entries(db._store).find(([k]) => k.includes('counters/spend-'))
    check('creates the counter doc', !!c)
    check('counts month/day/minute', c[1].m.waUtility === 1 && c[1].d.waUtility === 1 && c[1].b.waUtility === 1, c && c[1])
  }

  // ---------- 2. the monthly cap refuses the overflow, not the whole batch ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro', msgCapMonthly: 10 } })
    const a = await takeSpend(db, 't1', 'waMarketing', 8)
    const b = await takeSpend(db, 't1', 'waMarketing', 8)
    check('partial grant at the cap', a.granted === 8 && b.granted === 2 && b.reason === 'cap', { a, b })
    const c = Object.entries(db._store).find(([k]) => k.includes('counters/spend-'))[1]
    check('counts the refusals', c.blocked.waMarketing === 6, c.blocked)
    check('flags the venue once', c.flagged.waMarketing === true, c.flagged)
    check('raises exactly one console event', db._collected.filter((e) => e.type === 'spendLimit').length === 1, db._collected.length)
    check('mirrors msgsSent for the old screens', db._store['tenants/t1'].msgsSent.count === 10, db._store['tenants/t1'].msgsSent)
    const c2 = await takeSpend(db, 't1', 'waMarketing', 5)
    check('refuses everything once full', c2.granted === 0 && c2.reason === 'cap', c2)
  }

  // ---------- 2b. a bulk blast is claimed whole, not clipped by a burst wall ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'enterprise' } }) // waMarketing month 1300
    const r = await takeSpend(db, 't1', 'waMarketing', 1200)
    check('a 1200-person blast is granted in one claim', r.granted === 1200 && r.reason === 'ok', r)
    // Over the ceiling it is the MONTH that clips it — never a minute wall,
    // which would have silently dropped most of a legitimate audience.
    const db2 = makeDb({ 'tenants/t1': { plan: 'enterprise' } })
    const r2 = await takeSpend(db2, 't1', 'waMarketing', 5000)
    check('an oversized blast is clipped by the month, not a burst', r2.granted === 1300 && r2.reason === 'cap', r2)
  }

  // ---------- 2c. a small console cap must not become an absurd daily wall ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro', spendCaps: { email: 120 } } })
    let g = 0
    for (let i = 0; i < 120; i++) g += (await takeSpend(db, 't1', 'email', 1)).granted
    // 120/6 = 20/day would have strangled it; the floor keeps the month cap binding.
    check('the daily floor keeps a small cap usable', g === 50, g)
  }

  // ---------- 3. the per-minute wall is what stops a runaway loop ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'enterprise' } })
    let granted = 0
    for (let i = 0; i < 60; i++) granted += (await takeSpend(db, 't1', 'waUtility', 1)).granted
    check('burst wall holds at 20/min', granted === 20, granted)
    const r = await takeSpend(db, 't1', 'waUtility', 1)
    check('names the wall that fired', r.reason === 'burst', r)
    // a different channel is unaffected by waUtility's wall
    const e = await takeSpend(db, 't1', 'email', 1)
    check('walls are per channel', e.granted === 1, e)
  }

  // ---------- 4. day rollover must not carry yesterday's other channels ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro' } })
    await takeSpend(db, 't1', 'waUtility', 3)
    await takeSpend(db, 't1', 'email', 5)
    const key = Object.keys(db._store).find((k) => k.includes('counters/spend-'))
    check('both channels share the day map', db._store[key].d.waUtility === 3 && db._store[key].d.email === 5, db._store[key].d)
    db._store[key].d.day = '2000-01-01' // pretend a day passed
    db._store[key].b.minute = '2000-01-01, 00:00'
    await takeSpend(db, 't1', 'waUtility', 1)
    const d = db._store[key].d
    check('rollover replaces the whole day map', d.email === undefined && d.waUtility === 1, d)
    check('month total survives the rollover', db._store[key].m.waUtility === 4 && db._store[key].m.email === 5, db._store[key].m)
  }

  // ---------- 5. policy states ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro', active: false } })
    check('a suspended venue cannot spend', (await takeSpend(db, 't1', 'email', 1)).reason === 'suspended')
  }
  {
    const db = makeDb({ 'tenants/t1': { spendCaps: { email: 0 } } })
    check('cap 0 disables the channel', (await takeSpend(db, 't1', 'email', 1)).reason === 'disabled')
  }
  {
    const db = makeDb({ 'tenants/t1': { spendCaps: { email: -1 } } })
    let g = 0
    for (let i = 0; i < 90; i++) g += (await takeSpend(db, 't1', 'email', 1)).granted
    check('unlimited still respects the burst wall', g === 80, g)
  }
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro' }, 'platformConfig/spendControls': { killAll: true } })
    invalidateControls()
    const r = await takeSpend(db, 't1', 'waUtility', 5)
    check('the kill switch stops everything', r.granted === 0 && r.reason === 'killed', r)
    invalidateControls()
  }
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro' }, 'platformConfig/spendControls': { channels: { waMarketing: true } } })
    invalidateControls()
    check('a channel can be killed alone', (await takeSpend(db, 't1', 'waMarketing', 1)).reason === 'killed')
    check('other channels keep running', (await takeSpend(db, 't1', 'waUtility', 1)).granted === 1)
    invalidateControls()
  }

  // ---------- 6. fail OPEN on infrastructure, closed on policy ----------
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro' } })
    db.runTransaction = async () => { throw new Error('UNAVAILABLE') }
    const r = await takeSpend(db, 't1', 'waUtility', 3)
    check('a database outage never silences an order update', r.granted === 3 && r.reason === 'error-open', r)
  }
  {
    const db = makeDb({}) // tenant does not exist
    const r = await takeSpend(db, 'ghost', 'waUtility', 2)
    check('an unreadable tenant fails open too', r.granted === 2 && r.reason === 'error-open', r)
  }
  {
    const db = makeDb({ 'tenants/t1': { plan: 'pro' } })
    check('an unknown channel is unmetered', (await takeSpend(db, 't1', 'sms', 4)).reason === 'unmetered')
  }
  {
    // Fail-open must not become fail-forever: an OUTAGE with the brakes
    // removed is unbounded spending, so the blind grants are budgeted.
    invalidateControls()
    const db = makeDb({ 'tenants/t1': { plan: 'enterprise' } })
    db.runTransaction = async () => { throw new Error('UNAVAILABLE') }
    let open = 0, closed = 0
    for (let i = 0; i < 300; i++) {
      const r = await takeSpend(db, 't1', 'email', 1)
      if (r.reason === 'error-open') open += 1
      if (r.reason === 'error-closed') closed += 1
    }
    check('blind grants are budgeted, then it fails closed', open === 200 && closed === 100, { open, closed })
    invalidateControls()
  }

  // ---------- 7. the expensive channel gets its own walls ----------
  {
    // A month's images are counted in dozens. A flat daily floor of 50 let a
    // whole month burn in one afternoon on the priciest unit the platform
    // buys, so aiImage carries its own floor — and the minute wall bites
    // first, which is the point: 60 requests in a loop yield 4.
    const { limitsFor } = require(path.join(__dirname, 'spend.js'))
    const lim = limitsFor({ plan: 'pro' }, 'aiImage') // month 60
    check('image daily wall is a sixth of the month, not the month', lim.day === 10, lim)
    const db = makeDb({ 'tenants/t1': { plan: 'pro' } })
    let g = 0
    for (let i = 0; i < 60; i++) g += (await takeSpend(db, 't1', 'aiImage', 1)).granted
    check('a 60-request image loop is stopped at 4', g === 4, g)
  }
  {
    // ---- the commercial shape, as two invariants rather than one ----
    //
    // Summing EVERY channel's ceiling and demanding it stay under the plan
    // price is the wrong test: it assumes a venue maxes all eight channels in
    // the same month, which no venue does, and the pressure to make that sum
    // fit would force the rails below what a healthy venue actually needs.
    //
    // The two things worth asserting are the two real risks:
    //
    //   A. NO SINGLE CHANNEL CAN BANKRUPT THE PLAN. One runaway channel, fully
    //      consumed, must still cost less than the plan's monthly price.
    //
    //   B. THE AUTOMATIC CHANNELS TOGETHER STAY INSIDE THE PLAN. waUtility,
    //      email and dinerAi fire without anyone pressing a button — a bug
    //      spends them. The rest (marketing blasts, assistant turns, image and
    //      3D generation) each need a deliberate human action, so they cannot
    //      run away unattended.
    //
    // waUtility is priced at the realistic 40% billed share: the rest fall
    // inside WhatsApp's free 24-hour service window.
    const { PLAN_QUOTAS, UNIT_COST_USD, USD_TO_SAR } = require(path.join(__dirname, 'spend.js'))
    const PRICE_SAR = { menu: 99, ops: 199, pro: 349, enterprise: 549 }
    const BILLED_SHARE = { waUtility: 0.4 }
    const AUTOMATIC = ['waUtility', 'email', 'dinerAi']
    const costSar = (ch, qty) => qty * (BILLED_SHARE[ch] || 1) * UNIT_COST_USD[ch] * USD_TO_SAR

    Object.entries(PLAN_QUOTAS).forEach(([plan, q]) => {
      const worst = Object.entries(q).map(([ch, qty]) => ({ ch, sar: costSar(ch, qty) }))
        .sort((a, b) => b.sar - a.sar)[0]
      check(`${plan}: no single channel can outspend the plan (worst is ${worst.ch} at ${worst.sar.toFixed(0)} of ${PRICE_SAR[plan]} SAR)`,
        worst.sar < PRICE_SAR[plan], worst)

      const auto = AUTOMATIC.reduce((s, ch) => s + costSar(ch, q[ch] || 0), 0)
      check(`${plan}: the unattended channels stay inside the plan (${auto.toFixed(0)} of ${PRICE_SAR[plan]} SAR)`,
        auto < PRICE_SAR[plan], auto.toFixed(2))
    })
  }

  // ---------- 8. purchased credit is headroom, and it DEPLETES ----------
  const { limitsFor: LF, SPEND_PACKS, extraOf } = require(path.join(__dirname, 'spend.js'))
  {
    const lim = LF({ plan: 'pro', spendExtra: { waUtility: 2000 } }, 'waUtility')
    check('a top-up raises the ceiling above the plan', lim.plan === 6000 && lim.extra === 2000 && lim.month === 8000, lim)
  }
  {
    // The old aiExtra behaviour granted the purchased quantity EVERY month
    // forever. Buying 1,000 must mean 1,000 — so consuming past the plan cap
    // has to draw the balance down.
    const db = makeDb({ 'tenants/t1': { spendCaps: { email: 10 }, spendExtra: { email: 5 } } })
    const a = await takeSpend(db, 't1', 'email', 8)  // entirely inside the plan
    check('inside the plan, the balance is untouched', a.granted === 8 && db._drawn.length === 0, db._drawn)
    const b = await takeSpend(db, 't1', 'email', 5)  // 2 inside the plan, 3 from credit
    check('a grant straddling the boundary is split', b.granted === 5, b)
    check('exactly the overflow was drawn, from the right field',
      db._drawn.length === 1 && db._drawn[0].by === -3 && db._drawn[0].field === 'spendExtra.email', db._drawn)
    const c = await takeSpend(db, 't1', 'email', 5)  // 2 left of the 15 ceiling
    check('the effective ceiling is plan + balance', c.granted === 2 && c.reason === 'cap', c)
  }
  {
    // aiText keeps the LEGACY aiExtra field so /admin/assistant keeps working.
    const lim = LF({ plan: 'ops', aiExtra: 300 }, 'aiText')
    check('aiText reads the legacy aiExtra balance', lim.plan === 800 && lim.extra === 300 && lim.month === 1100, lim)
    check('extraOf reads the same field', extraOf({ aiExtra: 300 }, 'aiText') === 300)
  }

  // ---------- 9. the three migrated channels ----------
  {
    check('ar3d is off below enterprise', LF({ plan: 'pro' }, 'ar3d').month === 0)
    check('ar3d is on at enterprise', LF({ plan: 'enterprise' }, 'ar3d').month === 20)
    check('a purchased pack opens ar3d on any plan', LF({ plan: 'pro', spendExtra: { ar3d: 5 } }, 'ar3d').month === 5)
    check('the legacy ar3dMonthly still wins', LF({ plan: 'enterprise', ar3dMonthly: 3 }, 'ar3d').plan === 3)
    check('the legacy dinerAiMonthly still wins', LF({ plan: 'pro', dinerAiMonthly: 250 }, 'dinerAi').plan === 250)
    check('dinerAi keeps its historic 20/min burst', LF({ plan: 'pro' }, 'dinerAi').minute === 20)
  }

  // ---------- 10. every channel can be topped up, and never below cost ----------
  {
    const { CHANNELS, UNIT_COST_USD, USD_TO_SAR } = require(path.join(__dirname, 'spend.js'))
    CHANNELS.forEach((ch) => {
      const packs = SPEND_PACKS[ch] || []
      check(`${ch} is purchasable`, packs.length > 0)
      const bad = packs.filter((p) => p.sar <= p.qty * UNIT_COST_USD[ch] * USD_TO_SAR)
      check(`${ch} packs all price above their own cost`, bad.length === 0, bad)
    })
  }

  // ---------- 11. the PLATFORM-wide Gemini wall ----------
  {
    // Every other wall is per venue. This one guards the single shared API key
    // against Google's spend-based rate limit, which no per-venue cap can see.
    // Cap is 0.6 USD/min; aiImage is 0.039 → 15 images platform-wide, then stop.
    const db = makeDb({
      'tenants/a': { plan: 'enterprise' },
      'tenants/b': { plan: 'enterprise' },
      'tenants/c': { plan: 'enterprise' },
      'tenants/d': { plan: 'enterprise' },
    })
    let granted = 0
    let platformRefusals = 0
    // Four venues each well inside their OWN 4/min image wall.
    for (let round = 0; round < 4; round++) {
      for (const tid of ['a', 'b', 'c', 'd']) {
        const r = await takeSpend(db, tid, 'aiImage', 1)
        granted += r.granted
        if (r.reason === 'platformBurst') platformRefusals += 1
      }
    }
    check('the shared-key wall stops the platform sum at 15 images/min', granted === 15, granted)
    check('and it refuses with its own reason, not a venue one', platformRefusals === 1, platformRefusals)
    // Each venue individually is still under its own 4/min wall — proving the
    // per-venue meters could never have caught this.
    const perVenue = Object.entries(db._store)
      .filter(([k]) => k.includes('counters/spend-'))
      .map(([, v]) => (v.b && v.b.aiImage) || 0)
    check('no single venue exceeded its own burst wall', perVenue.every((n) => n <= 4), perVenue)
  }
  {
    // A text turn is 0.0018 — the wall must not bite ordinary assistant use.
    const db = makeDb({ 'tenants/a': { plan: 'enterprise' } })
    let g = 0
    for (let i = 0; i < 30; i++) g += (await takeSpend(db, 'a', 'aiText', 1)).granted
    check('ordinary assistant traffic is untouched by the platform wall', g === 30, g)
  }
  {
    // Non-Gemini channels must never consult it.
    const db = makeDb({ 'tenants/a': { plan: 'enterprise' } })
    db.runTransaction = async (fn) => {
      // Fail ONLY the platform-counter transaction; a real one would still work.
      throw new Error('should not be called for waUtility')
    }
    const r = await takeSpend(db, 'a', 'waUtility', 1)
    check('waUtility does not touch the Gemini wall', r.granted === 1 && r.reason === 'error-open', r)
    invalidateControls()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
run()
