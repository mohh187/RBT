// Turn a browser File into an attachment the assistant can analyse.
// images        -> shrunk base64 inlineData for Gemini
// pdf           -> rendered to downscaled page-images (+ extracted text) so ANY
//                  size / graphic-only menu works within the inline request cap
// csv/txt/json  -> text
// xlsx/xls      -> parsed CSV text
import { shrinkImage } from './storage.js'

export const ACCEPT = 'image/*,application/pdf,.csv,.txt,.json,.xlsx,.xls'
const MAX_TEXT = 24000
// A menu PDF can be huge (design exports). We never inline the raw file — we
// rasterise each page to a downscaled JPEG, so the request stays small no matter
// the source size. Caps keep the request sane on very long documents.
const MAX_PDF_PAGES = 15
const PDF_PAGE_WIDTH = 1400 // px — legible enough for names/prices
const PDF_PAGE_QUALITY = 0.82

const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })
const readAsText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file) })

// Rasterise a PDF to page-images (+ any embedded text). Handles graphic-only
// menus (no text layer) because it renders pixels, and huge files because every
// page is downscaled. Returns { pages:[{mime,data}], text, truncated }.
async function pdfToParts(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const total = pdf.numPages
  const count = Math.min(total, MAX_PDF_PAGES)
  const pages = []
  const textParts = []

  for (let i = 1; i <= count; i++) {
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, PDF_PAGE_WIDTH / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    // Flatten transparency onto white so the model sees the menu as printed.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', PDF_PAGE_QUALITY)
    pages.push({ mime: 'image/jpeg', data: String(dataUrl).split(',')[1] })
    try {
      const tc = await page.getTextContent()
      const line = tc.items.map((it) => it.str).join(' ').trim()
      if (line) textParts.push(`— صفحة ${i} —\n${line}`)
    } catch (_) { /* image-only page: rely on the rendered image */ }
    canvas.width = 0; canvas.height = 0 // free the bitmap
  }
  await pdf.destroy().catch(() => {})
  return { pages, text: textParts.join('\n\n').slice(0, MAX_TEXT), truncated: total > count, total }
}

export async function fileToAttachment(file) {
  const name = file.name || 'file'
  const type = file.type || ''
  if (type.startsWith('image/')) {
    const small = await shrinkImage(file, 1024, 0.85).catch(() => file)
    const dataUrl = await readAsDataURL(small)
    return { kind: 'image', mime: small.type || 'image/jpeg', data: String(dataUrl).split(',')[1], name, preview: dataUrl }
  }
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
    try {
      const { pages, text, truncated, total } = await pdfToParts(file)
      if (pages.length) {
        return {
          kind: 'pdf', name, pages, text,
          note: truncated ? `تمّت معالجة أول ${pages.length} من ${total} صفحة.` : '',
        }
      }
    } catch (_) { /* fall back to raw inline below */ }
    // Fallback: small/simple PDFs can still be inlined whole.
    const dataUrl = await readAsDataURL(file)
    return { kind: 'pdf', mime: 'application/pdf', data: String(dataUrl).split(',')[1], name }
  }
  if (/\.(xlsx|xls)$/i.test(name)) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const parts = wb.SheetNames.map((s) => `# Sheet: ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`)
    return { kind: 'text', name, text: parts.join('\n\n').slice(0, MAX_TEXT) }
  }
  const text = await readAsText(file).catch(() => '')
  return { kind: 'text', name, text: String(text).slice(0, MAX_TEXT) }
}
