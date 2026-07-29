// Rasterise the official Saudi Riyal mark to PNG, for EMAIL.
//
// WHY A PNG AT ALL. The app draws the mark as inline SVG (src/components/
// Riyal.jsx) and that is right for a browser. An inbox is not a browser:
// Gmail strips inline <svg> entirely, and blocks data: URIs in <img src>. So
// the only form of the symbol that survives a mailbox is a hosted raster.
//
// Two weights, because an email has two grounds:
//   riyal.png        dark ink  — for a light plate or a white body
//   riyal-light.png  white ink — for a brand-coloured band
//
// Rendered at 4x the largest size any email uses, so it stays crisp on a
// retina phone, which is where these are actually read.
//
// Usage: node scripts/make-riyal-png.mjs
import { chromium } from 'playwright-core'
import { writeFileSync, existsSync } from 'node:fs'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const exe = existsSync(EDGE) ? EDGE : existsSync(CHROME) ? CHROME : null
if (!exe) { console.error('no Edge/Chrome found to rasterise with'); process.exit(1) }

// The exact path data from src/components/Riyal.jsx — one source for the mark,
// so a future artwork change cannot leave the email version behind.
const PATHS = [
  'M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z',
  'M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z',
]
const SIZE = 128 // 4x the 32px an email ever paints

const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" width="${SIZE}" height="${SIZE}">`
  + PATHS.map((d) => `<path d="${d}" fill="${fill}"/>`).join('') + '</svg>'

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
for (const [name, fill] of [['riyal.png', '#14151a'], ['riyal-light.png', '#ffffff']]) {
  await page.setContent(
    `<body style="margin:0;background:transparent;">${svg(fill)}</body>`,
    { waitUntil: 'load' }
  )
  const buf = await page.locator('svg').screenshot({ omitBackground: true })
  writeFileSync(new URL(`../public/brand/${name}`, import.meta.url), buf)
  console.log(`wrote public/brand/${name}  ${buf.length}B`)
}
await browser.close()
