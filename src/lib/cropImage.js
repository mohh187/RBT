// Crops an image (from react-easy-crop pixel area) to a fixed output size via canvas,
// returning a WebP Blob ready to upload.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// SHAPE IS HONOURED, NOT JUST PREVIEWED.
//
// The logo cropper has always shown a ROUND viewport (ImageCropper passes
// cropShape="round" for CROP_KINDS.logo) and then written a plain rectangular
// blob, because the shape was never passed down here. So a venue framed its
// mark in a circle and got a square file. Every admin surface re-rounded it in
// CSS (`border-radius:50%`), which hid the mismatch completely — until email,
// where CSS cannot clip and the square corners showed.
//
// With `round`, the corners are made TRANSPARENT here, in the pixels. That is
// «مفرّغ»: correct in email, in Outlook's Word engine, in a PDF, anywhere.
//
// FORMAT follows from that: WebP keeps alpha but desktop Outlook (Word) cannot
// display WebP at all, so a masked logo is written as PNG — which keeps the
// transparency and renders everywhere. Unmasked images stay WebP for size.
export async function getCroppedBlob(imageSrc, pixelCrop, output, { round = false } = {}) {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = output.width
  canvas.height = output.height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (round) {
    ctx.save()
    ctx.beginPath()
    // Inset by half a pixel so the edge antialiases instead of leaving a hard
    // stair-step against whatever the mark is later placed on.
    ctx.arc(output.width / 2, output.height / 2, Math.min(output.width, output.height) / 2 - 0.5, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
  }
  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, output.width, output.height,
  )
  if (round) ctx.restore()
  const type = round ? 'image/png' : 'image/webp'
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9))
}
