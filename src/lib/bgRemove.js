// Client-side background removal (@imgly/background-removal — WASM model runs
// fully in the browser; first use downloads the model (~tens of MB) then it's
// cached). Lazy-imported so the heavy bundle loads only when someone actually
// taps «إزالة الخلفية».
let _mod = null

async function lib() {
  if (!_mod) _mod = await import('@imgly/background-removal')
  return _mod
}

// input: File | Blob | URL string → returns a PNG Blob with transparent background.
export async function removeBackground(input, { onProgress } = {}) {
  const m = await lib()
  const blob = await m.removeBackground(input, {
    progress: onProgress ? (key, current, total) => onProgress(key, current, total) : undefined,
    output: { format: 'image/png' },
  })
  return blob
}

// Convenience: strip bg then hand back a File ready for the existing upload path.
export async function removeBackgroundToFile(input, name = 'cutout.png', opts) {
  const blob = await removeBackground(input, opts)
  return new File([blob], name, { type: 'image/png' })
}
