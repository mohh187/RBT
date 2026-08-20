// node src/lib/duotone.test.mjs
//
// The recolour rewrites a venue's photographs, and its failure mode is a
// picture that looks subtly wrong rather than an exception. These pin the two
// properties the whole feature rests on: the ramp lands on its own colours at
// the ends, and DETAIL SURVIVES, i.e. two pixels that differed in brightness
// still differ after the recolour.
import assert from 'node:assert/strict'
import { hexToRgb, rgbToHex, rampTable, sampleRamp, duotonePixels, duotoneActive } from './duotone.js'

const px = (...vals) => Uint8ClampedArray.from(vals)
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

// --- colour parsing ---------------------------------------------------------
assert.deepEqual(hexToRgb('#fff'), [255, 255, 255])
assert.deepEqual(hexToRgb('#000000'), [0, 0, 0])
assert.deepEqual(hexToRgb('d8a76c'), [216, 167, 108], 'a missing hash still parses')
assert.equal(hexToRgb('#12'), null, 'half typed colour must not become black')
assert.equal(hexToRgb(''), null)
assert.equal(hexToRgb(undefined), null)
assert.equal(rgbToHex([216, 167, 108]), '#d8a76c')

// --- the ramp ---------------------------------------------------------------
assert.equal(rampTable(['#000000']), null, 'one colour is not a duotone')
assert.equal(rampTable([]), null)
assert.deepEqual(rampTable(['#000000', '#bad']).r, [0, 0xbb / 255], 'a three digit hex expands, so #bad is a real colour')
assert.equal(rampTable(['#000000', '#zzzz']), null, 'an unparseable stop is dropped, leaving one, which is not a duotone')
const t = rampTable(['#000000', '#ffffff'])
assert.deepEqual(t.r, [0, 1])
assert.deepEqual(t.g, [0, 1])
assert.deepEqual(sampleRamp(['#000000', '#ffffff'], 0.5), [127.5, 127.5, 127.5])
assert.deepEqual(sampleRamp(['#ff0000', '#00ff00', '#0000ff'], 0.5), [0, 255, 0], 'the middle stop lands at the middle')

// --- the active gate --------------------------------------------------------
assert.equal(duotoneActive({ on: true, colors: ['#000', '#fff'], intensity: 1 }), true)
assert.equal(duotoneActive({ on: false, colors: ['#000', '#fff'], intensity: 1 }), false)
assert.equal(duotoneActive({ on: true, colors: ['#000'], intensity: 1 }), false)
assert.equal(duotoneActive({ on: true, colors: ['#000', '#fff'], intensity: 0 }), false)
assert.equal(duotoneActive(null), false)

// --- the ends of the ramp ---------------------------------------------------
const COLORS = ['#241309', '#d8a76c'] // walnut
{
  const d = px(0, 0, 0, 255, 255, 255, 255, 255)
  duotonePixels(d, COLORS, 1)
  assert.ok(near(d[0], 0x24) && near(d[1], 0x13) && near(d[2], 0x09), `black -> shadow colour, got ${d[0]},${d[1]},${d[2]}`)
  assert.ok(near(d[4], 0xd8) && near(d[5], 0xa7) && near(d[6], 0x6c), `white -> highlight colour, got ${d[4]},${d[5]},${d[6]}`)
}

// --- THE PROPERTY THAT MATTERS: detail survives -----------------------------
{
  // eight steps of a grey ramp, i.e. the texture of any real photograph
  const src = []
  for (let i = 0; i < 8; i += 1) { const v = i * 36; src.push(v, v, v, 255) }
  const d = px(...src)
  duotonePixels(d, COLORS, 1)
  let lastLum = -1
  for (let i = 0; i < 8; i += 1) {
    const o = i * 4
    const lum = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]
    assert.ok(lum > lastLum, `step ${i} must stay brighter than the one before it: ${lum} vs ${lastLum}`)
    lastLum = lum
  }
}

// two pixels of the SAME brightness but different hue collapse to one colour,
// which is the whole point of a duotone and worth pinning so nobody "fixes" it
{
  const d = px(255, 0, 0, 255, 0, 0, 255, 255)
  duotonePixels(d, ['#000000', '#ffffff'], 1)
  const redOut = [d[0], d[1], d[2]]
  const blueOut = [d[4], d[5], d[6]]
  assert.ok(redOut[0] !== blueOut[0], 'red and blue have different luminance, so they must not collapse')
}

// --- intensity --------------------------------------------------------------
{
  const orig = [120, 60, 30]
  const d0 = px(...orig, 255)
  duotonePixels(d0, COLORS, 0)
  assert.deepEqual([d0[0], d0[1], d0[2]], orig, 'intensity 0 leaves the pixel exactly as it was')

  const full = px(...orig, 255)
  duotonePixels(full, COLORS, 1)
  const half = px(...orig, 255)
  duotonePixels(half, COLORS, 0.5)
  for (let c = 0; c < 3; c += 1) {
    assert.ok(near(half[c], (orig[c] + full[c]) / 2), `channel ${c} at half strength sits midway: ${half[c]}`)
  }
}

// --- alpha ------------------------------------------------------------------
{
  // a cutout: opaque food, fully transparent margin
  const d = px(200, 180, 160, 255, 9, 9, 9, 0, 100, 100, 100, 128)
  const before = Array.from(d)
  duotonePixels(d, COLORS, 1)
  assert.equal(d[3], 255, 'alpha is never touched')
  assert.equal(d[7], 0)
  assert.equal(d[11], 128, 'a semi transparent pixel keeps its alpha')
  assert.deepEqual([d[4], d[5], d[6]], before.slice(4, 7), 'a fully transparent pixel is skipped, so cutouts gain no colour fringe')
  assert.notDeepEqual([d[8], d[9], d[10]], before.slice(8, 11), 'a semi transparent pixel IS recoloured')
}

// --- three stops ------------------------------------------------------------
{
  const d = px(128, 128, 128, 255)
  duotonePixels(d, ['#ff0000', '#00ff00', '#0000ff'], 1)
  assert.ok(d[1] > 200 && d[0] < 60 && d[2] < 60, `mid grey lands on the middle stop, got ${d[0]},${d[1]},${d[2]}`)
}

console.log('duotone: all checks passed')
