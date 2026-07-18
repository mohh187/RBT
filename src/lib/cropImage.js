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

export async function getCroppedBlob(imageSrc, pixelCrop, output) {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = output.width
  canvas.height = output.height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, output.width, output.height,
  )
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.9))
}
