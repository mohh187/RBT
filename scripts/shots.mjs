// Real-screenshot capture for the landing gallery.
// Reads credentials from the git-ignored .env.shots at RUNTIME (never committed,
// never printed). Logs into the live site, unlocks the device PIN gate, and
// captures dashboard / cashier / themes / menu into public/marketing/*.jpg —
// where RealGallery picks them up.
//
// Usage:  1) cp .env.shots.example .env.shots  and fill it
//         2) node scripts/shots.mjs           (add SHOTS_HEADED=1 to watch)
//
// Uses your system Edge/Chrome via playwright-core (no bundled browser).

import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const env = {}
try {
  readFileSync('.env.shots', 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trimStart().startsWith('#')) env[m[1]] = m[2]
  })
} catch {
  console.error('Missing .env.shots — copy .env.shots.example to .env.shots and fill it.')
  process.exit(1)
}

const BASE = (env.SHOTS_BASE || 'https://menu-88996.web.app').replace(/\/$/, '')
const { SHOTS_EMAIL: EMAIL, SHOTS_PASSWORD: PASSWORD, SHOTS_SLUG: SLUG, SHOTS_PIN: PIN } = env
if (!EMAIL || !PASSWORD) { console.error('SHOTS_EMAIL / SHOTS_PASSWORD are required in .env.shots'); process.exit(1) }

const OUT = 'public/marketing'
mkdirSync(OUT, { recursive: true })
const HEADED = env.SHOTS_HEADED === '1'
const settle = (page, ms = 2800) => page.waitForTimeout(ms)

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: !HEADED }) } catch { /* try next */ }
  }
  return chromium.launch({ headless: !HEADED })
}

// Dismiss the device PIN gate if present (click the staff tile, type the PIN).
async function unlock(page) {
  if (!PIN) return
  try {
    const tile = page.locator('.pinlock-person').first()
    await tile.waitFor({ state: 'visible', timeout: 3500 })
    await tile.click()
    await page.waitForTimeout(500)
    for (const d of String(PIN).split('')) { await page.keyboard.press(d); await page.waitForTimeout(130) }
    await page.locator('.pinlock').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(800)
  } catch { /* no lock shown */ }
}

async function shoot(page, name, ms) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await settle(page, ms)
    await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 })
    console.log(`  captured ${name}.jpg`)
    return true
  } catch (e) {
    console.error(`  FAILED ${name} — ${e.message}`)
    return false
  }
}

async function detectSlug(page) {
  const grab = () => page.evaluate(() => {
    // eslint-disable-next-line no-undef
    const a = [...document.querySelectorAll('a[href*="/m/"],a[href*="/t/"]')].map((x) => x.getAttribute('href') || '')
    for (const href of a) { const m = href.match(/\/[mt]\/([^/?#]+)/); if (m) return m[1] }
    return null
  })
  let s = await grab().catch(() => null)
  if (s) return s
  await page.goto(`${BASE}/admin/tables`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await settle(page, 2000)
  return grab().catch(() => null)
}

const run = async () => {
  const browser = await launch()
  const done = []
  const desk = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: 'ar' })
  const page = await desk.newPage()

  console.log('signing in…')
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.locator('input[type="password"]').press('Enter')
  await page.waitForURL(/\/(admin|onboarding|platform)/, { timeout: 20000 }).catch(() => {})
  await settle(page, 2500)
  if (/\/login/.test(page.url())) { console.error('login failed — check .env.shots'); await browser.close(); process.exit(1) }
  console.log('signed in — unlocking device…')
  await unlock(page)

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' }); await unlock(page)
  if (await shoot(page, 'dashboard', 3600)) done.push('dashboard')

  // grab the real slug from links before leaving the admin
  const slug = SLUG && SLUG !== 'Mazagfal' ? SLUG : (await detectSlug(page)) || (SLUG ? SLUG.toLowerCase() : null)

  await page.goto(`${BASE}/cashier`, { waitUntil: 'domcontentloaded' }); await unlock(page)
  if (await shoot(page, 'cashier', 3200)) done.push('cashier')

  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' }); await unlock(page)
  await settle(page, 2200)
  let tabbed = false
  for (const loc of [
    page.getByRole('button', { name: 'الاستوديو' }),
    page.getByText('الاستوديو', { exact: true }),
    page.locator('button:has-text("الاستوديو")'),
    page.locator('button:has-text("المظهر")'),
  ]) {
    try {
      const el = loc.first()
      if (await el.isVisible({ timeout: 1500 })) { await el.scrollIntoViewIfNeeded().catch(() => {}); await el.click(); tabbed = true; await settle(page, 2200); break }
    } catch { /* try next */ }
  }
  if (!tabbed) console.error('  note: could not switch to the Studio/appearance tab — captured general settings')
  if (await shoot(page, 'themes', 2400)) done.push('themes')

  // --- mobile: public menu (try detected slug, env slug, lowercase) ---
  const candidates = [...new Set([slug, SLUG, SLUG && SLUG.toLowerCase()].filter(Boolean))]
  const mob = await browser.newContext({ viewport: { width: 402, height: 860 }, deviceScaleFactor: 2, locale: 'ar', isMobile: true, hasTouch: true })
  const mp = await mob.newPage()
  let menuOk = false
  for (const c of candidates) {
    await mp.goto(`${BASE}/m/${c}`, { waitUntil: 'domcontentloaded' })
    await mp.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
    await settle(mp, 2600)
    const missing = await mp.getByText('غير موجودة').count().catch(() => 0)
    if (!missing) { await mp.screenshot({ path: `${OUT}/menu.jpg`, type: 'jpeg', quality: 82 }); console.log(`  captured menu.jpg (slug: ${c})`); done.push('menu'); menuOk = true; break }
  }
  if (!menuOk) console.error(`  FAILED menu — venue not found for: ${candidates.join(', ') || '(no slug)'}`)

  await browser.close()
  console.log(`\nDone — captured: ${done.join(', ') || 'nothing'}. Files in ${OUT}/`)
}

run().catch((e) => { console.error(e); process.exit(1) })
