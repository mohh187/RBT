// Free-form print studio — shapes/elements library.
// Every entry: { id, ar, cat, svg }. The svg string is a COMPLETE inline <svg>
// using currentColor for its fill/stroke so recoloring works identically in the
// DOM editor, the print output and the PNG rasterizer (which string-replaces
// currentColor before rasterizing). No external assets. All geometry is
// hand-authored here (some paths computed by tiny local helpers for precision).

const N = (v) => Math.round(v * 100) / 100

// full-svg wrapper — preserveAspectRatio none so w/h fully control the shape
const S = (vb, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="none">${inner}</svg>`
// line-icon wrapper (food icons): clean 2px strokes on a 48 grid, kept proportional
const L = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" preserveAspectRatio="xMidYMid meet"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`

// -- geometry helpers ---------------------------------------------------------
function starPoints(cx, cy, spikes, R, r, rot = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < spikes * 2; i++) {
    const rad = i % 2 === 0 ? R : r
    const a = rot + (i * Math.PI) / spikes
    pts.push(`${N(cx + Math.cos(a) * rad)},${N(cy + Math.sin(a) * rad)}`)
  }
  return pts.join(' ')
}
function polygonPoints(cx, cy, n, R, rot = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n
    pts.push(`${N(cx + Math.cos(a) * R)},${N(cy + Math.sin(a) * R)}`)
  }
  return pts.join(' ')
}
// scalloped seal edge: arcs bulging outward between points on a circle
function scallopPath(cx, cy, lobes, R) {
  const chord = 2 * R * Math.sin(Math.PI / lobes)
  const ar = N(chord * 0.62)
  let d = ''
  for (let i = 0; i <= lobes; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / lobes
    const x = N(cx + Math.cos(a) * R)
    const y = N(cy + Math.sin(a) * R)
    d += i === 0 ? `M${x},${y}` : ` A${ar},${ar} 0 0 1 ${x},${y}`
  }
  return d + ' Z'
}
function wavePath(x0, y, w, cycles, amp) {
  const half = N(w / cycles / 2)
  let d = `M${x0},${y}`
  for (let i = 0; i < cycles * 2; i++) d += ` q${N(half / 2)},${i % 2 === 0 ? -amp : amp} ${half},0`
  return d
}
function zigzagPoints(x0, y, w, cycles, amp) {
  const step = w / (cycles * 2)
  const pts = [`${x0},${y}`]
  for (let i = 1; i <= cycles * 2; i++) pts.push(`${N(x0 + i * step)},${i % 2 === 1 ? N(y - amp) : y}`)
  return pts.join(' ')
}
function dotRow(x0, y, w, count, r) {
  const gap = w / (count - 1)
  let out = ''
  for (let i = 0; i < count; i++) out += `<circle cx="${N(x0 + i * gap)}" cy="${y}" r="${r}" fill="currentColor"/>`
  return out
}
function halftoneGrid(cols, rows, box, maxR) {
  const gx = box / cols
  let out = ''
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const r = N(maxR * (1 - (i + j) / (cols + rows - 2) * 0.75))
      out += `<circle cx="${N(gx / 2 + i * gx)}" cy="${N(gx / 2 + j * gx)}" r="${r}" fill="currentColor"/>`
    }
  }
  return out
}
function hatchLines(box, n) {
  let out = ''
  const step = (box * 2) / n
  for (let i = 1; i < n; i++) {
    const o = N(i * step)
    out += `<line x1="${N(o - box)}" y1="${box}" x2="${o}" y2="0" stroke="currentColor" stroke-width="2.5"/>`
  }
  return out
}
// eight-pointed islamic star (khatam): two overlapping squares
function khatam(cx, cy, R, rot = 0) {
  const a = polygonPoints(cx, cy, 4, R, rot)
  const b = polygonPoints(cx, cy, 4, R, rot + Math.PI / 4)
  return { a, b }
}

const k1 = khatam(50, 50, 44)
const k2 = khatam(50, 50, 40)

// =============================================================================
export const SHAPE_CATS = [
  { id: 'badge', ar: 'شارات وأختام' },
  { id: 'frame', ar: 'إطارات' },
  { id: 'divider', ar: 'فواصل' },
  { id: 'basic', ar: 'أشكال أساسية' },
  { id: 'food', ar: 'طعام' },
  { id: 'arab', ar: 'زخارف عربية' },
]

export const PRINT_SHAPES = [
  // ===================== شارات وأختام (badges & seals) ======================
  { id: 'seal-scallop', ar: 'ختم مموج', cat: 'badge', svg: S('0 0 100 100', `<path d="${scallopPath(50, 50, 12, 45)}" fill="currentColor"/>`) },
  { id: 'seal-scallop-fine', ar: 'ختم مموج ناعم', cat: 'badge', svg: S('0 0 100 100', `<path d="${scallopPath(50, 50, 20, 45)}" fill="currentColor"/>`) },
  { id: 'seal-ring', ar: 'ختم بحلقة', cat: 'badge', svg: S('0 0 100 100', `<path d="${scallopPath(50, 50, 14, 46)}" fill="currentColor"/><circle cx="50" cy="50" r="34" fill="none" stroke="#ffffff" stroke-width="2"/>`) },
  { id: 'burst-12', ar: 'انفجار 12 شعاعاً', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 12, 48, 38)}" fill="currentColor"/>`) },
  { id: 'burst-16', ar: 'انفجار 16 شعاعاً', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 16, 48, 40)}" fill="currentColor"/>`) },
  { id: 'burst-24', ar: 'انفجار دقيق', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 24, 48, 42)}" fill="currentColor"/>`) },
  { id: 'burst-sale', ar: 'نجمة عرض حادة', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 14, 49, 30)}" fill="currentColor"/>`) },
  { id: 'star-5', ar: 'نجمة خماسية', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 54, 5, 48, 19)}" fill="currentColor"/>`) },
  { id: 'star-6', ar: 'نجمة سداسية', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 6, 48, 24)}" fill="currentColor"/>`) },
  { id: 'ribbon-banner', ar: 'شريط عنوان', cat: 'badge', svg: S('0 0 200 60', `<path d="M30,10 H170 V50 H30 Z" fill="currentColor"/><path d="M30,18 L2,30 L30,42 Z" fill="currentColor" opacity="0.8"/><path d="M170,18 L198,30 L170,42 Z" fill="currentColor" opacity="0.8"/>`) },
  { id: 'ribbon-flag', ar: 'راية مشقوقة', cat: 'badge', svg: S('0 0 120 160', `<path d="M20,0 H100 V150 L60,122 L20,150 Z" fill="currentColor"/>`) },
  { id: 'badge-shield', ar: 'درع', cat: 'badge', svg: S('0 0 100 110', `<path d="M50,4 L94,18 V56 C94,84 74,100 50,108 C26,100 6,84 6,56 V18 Z" fill="currentColor"/>`) },
  { id: 'badge-rosette', ar: 'وسام بذيلين', cat: 'badge', svg: S('0 0 100 130', `<path d="M32,70 L20,126 L50,108 L80,126 L68,70 Z" fill="currentColor" opacity="0.75"/><path d="${scallopPath(50, 44, 12, 40)}" fill="currentColor"/><circle cx="50" cy="44" r="26" fill="none" stroke="#ffffff" stroke-width="2.5"/>`) },
  { id: 'price-tag', ar: 'بطاقة سعر', cat: 'badge', svg: S('0 0 120 70', `<path d="M34,4 H110 A6,6 0 0 1 116,10 V60 A6,6 0 0 1 110,66 H34 L4,35 Z" fill="currentColor"/><circle cx="26" cy="35" r="6" fill="#ffffff"/>`) },
  { id: 'burst-speech', ar: 'فقاعة مدوية', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 10, 48, 32, -Math.PI / 2 + 0.3)}" fill="currentColor"/>`) },
  { id: 'badge-hex', ar: 'شارة سداسية', cat: 'badge', svg: S('0 0 100 100', `<polygon points="${polygonPoints(50, 50, 6, 47)}" fill="currentColor"/><polygon points="${polygonPoints(50, 50, 6, 38)}" fill="none" stroke="#ffffff" stroke-width="2"/>`) },

  // ============================ إطارات (frames) =============================
  { id: 'frame-thin', ar: 'إطار رفيع', cat: 'frame', svg: S('0 0 100 100', `<rect x="2" y="2" width="96" height="96" fill="none" stroke="currentColor" stroke-width="1.5"/>`) },
  { id: 'frame-bold', ar: 'إطار سميك', cat: 'frame', svg: S('0 0 100 100', `<rect x="4" y="4" width="92" height="92" fill="none" stroke="currentColor" stroke-width="6"/>`) },
  { id: 'frame-double', ar: 'إطار مزدوج', cat: 'frame', svg: S('0 0 100 100', `<rect x="2" y="2" width="96" height="96" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="8" width="84" height="84" fill="none" stroke="currentColor" stroke-width="1.5"/>`) },
  { id: 'frame-thick-thin', ar: 'إطار سميك ورفيع', cat: 'frame', svg: S('0 0 100 100', `<rect x="3" y="3" width="94" height="94" fill="none" stroke="currentColor" stroke-width="4"/><rect x="11" y="11" width="78" height="78" fill="none" stroke="currentColor" stroke-width="1"/>`) },
  { id: 'frame-rounded', ar: 'إطار مدوّر', cat: 'frame', svg: S('0 0 100 100', `<rect x="3" y="3" width="94" height="94" rx="14" fill="none" stroke="currentColor" stroke-width="2.5"/>`) },
  { id: 'frame-double-rounded', ar: 'مدوّر مزدوج', cat: 'frame', svg: S('0 0 100 100', `<rect x="2.5" y="2.5" width="95" height="95" rx="14" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="9" width="82" height="82" rx="9" fill="none" stroke="currentColor" stroke-width="1.6"/>`) },
  { id: 'frame-dashed', ar: 'إطار متقطع', cat: 'frame', svg: S('0 0 100 100', `<rect x="3" y="3" width="94" height="94" rx="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="7 5"/>`) },
  { id: 'frame-dotted', ar: 'إطار منقط', cat: 'frame', svg: S('0 0 100 100', `<rect x="3" y="3" width="94" height="94" rx="6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="0.1 6" stroke-linecap="round"/>`) },
  { id: 'frame-corners', ar: 'أقواس زوايا', cat: 'frame', svg: S('0 0 100 100', `<path d="M4,26 V4 H26 M74,4 H96 V26 M96,74 V96 H74 M26,96 H4 V74" fill="none" stroke="currentColor" stroke-width="3.2"/>`) },
  { id: 'frame-flourish', ar: 'زوايا مزخرفة', cat: 'frame', svg: S('0 0 100 100', `<path d="M4,30 V12 Q4,4 12,4 H30 M4,20 Q14,20 20,14 Q26,8 26,4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M70,4 H88 Q96,4 96,12 V30 M80,4 Q80,14 86,20 Q92,26 96,26" fill="none" stroke="currentColor" stroke-width="2"/><path d="M96,70 V88 Q96,96 88,96 H70 M96,80 Q86,80 80,86 Q74,92 74,96" fill="none" stroke="currentColor" stroke-width="2"/><path d="M30,96 H12 Q4,96 4,88 V70 M20,96 Q20,86 14,80 Q8,74 4,74" fill="none" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'frame-arch', ar: 'إطار مقوس', cat: 'frame', svg: S('0 0 100 130', `<path d="M6,124 V52 Q6,8 50,8 Q94,8 94,52 V124 Z" fill="none" stroke="currentColor" stroke-width="2.6"/>`) },
  { id: 'frame-oval', ar: 'إطار بيضاوي', cat: 'frame', svg: S('0 0 100 130', `<ellipse cx="50" cy="65" rx="46" ry="60" fill="none" stroke="currentColor" stroke-width="2.4"/>`) },
  { id: 'frame-ticket', ar: 'إطار تذكرة', cat: 'frame', svg: S('0 0 140 90', `<path d="M6,6 H134 V36 A9,9 0 0 0 134,54 V84 H6 V54 A9,9 0 0 0 6,36 Z" fill="none" stroke="currentColor" stroke-width="2.6"/>`) },
  { id: 'frame-cut', ar: 'زوايا مشطوفة', cat: 'frame', svg: S('0 0 100 100', `<path d="M18,3 H82 L97,18 V82 L82,97 H18 L3,82 V18 Z" fill="none" stroke="currentColor" stroke-width="2.6"/>`) },
  { id: 'frame-pill', ar: 'إطار كبسولة', cat: 'frame', svg: S('0 0 160 70', `<rect x="4" y="4" width="152" height="62" rx="31" fill="none" stroke="currentColor" stroke-width="2.6"/>`) },
  { id: 'frame-deco', ar: 'إطار مع معين', cat: 'frame', svg: S('0 0 140 100', `<rect x="4" y="12" width="132" height="76" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="70,2 80,12 70,22 60,12" fill="currentColor"/><polygon points="70,78 80,88 70,98 60,88" fill="currentColor"/>`) },

  // ============================ فواصل (dividers) ============================
  { id: 'div-line', ar: 'خط بسيط', cat: 'divider', svg: S('0 0 240 24', `<line x1="4" y1="12" x2="236" y2="12" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'div-double', ar: 'خط مزدوج', cat: 'divider', svg: S('0 0 240 24', `<line x1="4" y1="8" x2="236" y2="8" stroke="currentColor" stroke-width="2"/><line x1="4" y1="16" x2="236" y2="16" stroke="currentColor" stroke-width="1"/>`) },
  { id: 'div-dashed', ar: 'خط متقطع', cat: 'divider', svg: S('0 0 240 24', `<line x1="4" y1="12" x2="236" y2="12" stroke="currentColor" stroke-width="2" stroke-dasharray="10 6"/>`) },
  { id: 'div-dotted', ar: 'خط منقط', cat: 'divider', svg: S('0 0 240 24', dotRow(8, 12, 224, 20, 2.4)) },
  { id: 'div-wave', ar: 'موجة', cat: 'divider', svg: S('0 0 240 24', `<path d="${wavePath(4, 12, 232, 8, 7)}" fill="none" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'div-wave-double', ar: 'موجتان', cat: 'divider', svg: S('0 0 240 30', `<path d="${wavePath(4, 11, 232, 8, 6)}" fill="none" stroke="currentColor" stroke-width="2"/><path d="${wavePath(4, 20, 232, 8, 6)}" fill="none" stroke="currentColor" stroke-width="1.2"/>`) },
  { id: 'div-zigzag', ar: 'متعرج', cat: 'divider', svg: S('0 0 240 24', `<polyline points="${zigzagPoints(4, 17, 232, 12, 10)}" fill="none" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'div-diamond', ar: 'خط بمعين', cat: 'divider', svg: S('0 0 240 24', `<line x1="4" y1="12" x2="104" y2="12" stroke="currentColor" stroke-width="1.6"/><line x1="136" y1="12" x2="236" y2="12" stroke="currentColor" stroke-width="1.6"/><polygon points="120,3 129,12 120,21 111,12" fill="currentColor"/>`) },
  { id: 'div-circle', ar: 'خط بدائرة', cat: 'divider', svg: S('0 0 240 24', `<line x1="4" y1="12" x2="106" y2="12" stroke="currentColor" stroke-width="1.6"/><line x1="134" y1="12" x2="236" y2="12" stroke="currentColor" stroke-width="1.6"/><circle cx="120" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'div-dots3', ar: 'ثلاث نقاط', cat: 'divider', svg: S('0 0 240 24', `<line x1="4" y1="12" x2="92" y2="12" stroke="currentColor" stroke-width="1.4"/><line x1="148" y1="12" x2="236" y2="12" stroke="currentColor" stroke-width="1.4"/>${dotRow(106, 12, 28, 3, 3)}`) },
  { id: 'div-scroll', ar: 'زخرفة وسطية', cat: 'divider', svg: S('0 0 240 28', `<line x1="4" y1="14" x2="92" y2="14" stroke="currentColor" stroke-width="1.6"/><line x1="148" y1="14" x2="236" y2="14" stroke="currentColor" stroke-width="1.6"/><path d="M96,14 Q104,4 112,14 Q116,19 120,14 Q124,9 128,14 Q136,24 144,14" fill="none" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'div-taper', ar: 'خط مدبب', cat: 'divider', svg: S('0 0 240 24', `<path d="M4,12 L120,8.6 L236,12 L120,15.4 Z" fill="currentColor"/>`) },
  { id: 'div-arrows', ar: 'خط بسهمين', cat: 'divider', svg: S('0 0 240 24', `<line x1="16" y1="12" x2="224" y2="12" stroke="currentColor" stroke-width="2"/><path d="M16,12 L28,5 M16,12 L28,19" fill="none" stroke="currentColor" stroke-width="2"/><path d="M224,12 L212,5 M224,12 L212,19" fill="none" stroke="currentColor" stroke-width="2"/>`) },
  { id: 'div-braid', ar: 'ضفيرة', cat: 'divider', svg: S('0 0 240 24', `<path d="${wavePath(4, 12, 232, 10, 7)}" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="${wavePath(4, 12, 232, 10, -7)}" fill="none" stroke="currentColor" stroke-width="1.8"/>`) },

  // ========================= أشكال أساسية (basics) ==========================
  { id: 'circle', ar: 'دائرة', cat: 'basic', svg: S('0 0 100 100', `<circle cx="50" cy="50" r="48" fill="currentColor"/>`) },
  { id: 'ring', ar: 'حلقة', cat: 'basic', svg: S('0 0 100 100', `<circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-width="8"/>`) },
  { id: 'rect', ar: 'مستطيل', cat: 'basic', svg: S('0 0 100 100', `<rect x="0" y="0" width="100" height="100" fill="currentColor"/>`) },
  { id: 'rect-rounded', ar: 'مستطيل مدوّر', cat: 'basic', svg: S('0 0 100 100', `<rect x="0" y="0" width="100" height="100" rx="16" fill="currentColor"/>`) },
  { id: 'pill', ar: 'كبسولة', cat: 'basic', svg: S('0 0 160 64', `<rect x="0" y="0" width="160" height="64" rx="32" fill="currentColor"/>`) },
  { id: 'triangle', ar: 'مثلث', cat: 'basic', svg: S('0 0 100 100', `<polygon points="50,4 98,96 2,96" fill="currentColor"/>`) },
  { id: 'diamond', ar: 'معين', cat: 'basic', svg: S('0 0 100 100', `<polygon points="50,2 98,50 50,98 2,50" fill="currentColor"/>`) },
  { id: 'hexagon', ar: 'سداسي', cat: 'basic', svg: S('0 0 100 100', `<polygon points="${polygonPoints(50, 50, 6, 48)}" fill="currentColor"/>`) },
  { id: 'pentagon', ar: 'خماسي', cat: 'basic', svg: S('0 0 100 100', `<polygon points="${polygonPoints(50, 52, 5, 48)}" fill="currentColor"/>`) },
  { id: 'semicircle', ar: 'نصف دائرة', cat: 'basic', svg: S('0 0 100 50', `<path d="M0,50 A50,50 0 0 1 100,50 Z" fill="currentColor"/>`) },
  { id: 'quarter', ar: 'ربع دائرة', cat: 'basic', svg: S('0 0 100 100', `<path d="M0,100 V0 A100,100 0 0 1 100,100 Z" fill="currentColor"/>`) },
  { id: 'blob-1', ar: 'شكل عضوي 1', cat: 'basic', svg: S('0 0 100 100', `<path d="M50,4 C72,4 96,16 96,42 C96,66 84,96 54,96 C26,96 4,80 4,54 C4,26 26,4 50,4 Z" fill="currentColor"/>`) },
  { id: 'blob-2', ar: 'شكل عضوي 2', cat: 'basic', svg: S('0 0 100 100', `<path d="M58,6 C80,10 98,28 94,52 C90,78 70,98 46,94 C20,90 2,72 6,44 C10,18 36,2 58,6 Z" fill="currentColor"/>`) },
  { id: 'blob-3', ar: 'شكل عضوي 3', cat: 'basic', svg: S('0 0 100 100', `<path d="M52,8 C68,2 90,10 94,32 C98,52 88,64 90,78 C92,92 74,98 56,94 C36,90 8,92 6,66 C4,42 14,30 22,22 C30,14 38,13 52,8 Z" fill="currentColor"/>`) },
  { id: 'halftone', ar: 'نقاط متدرجة', cat: 'basic', svg: S('0 0 96 96', halftoneGrid(6, 6, 96, 6.5)) },
  { id: 'hatch', ar: 'خطوط مائلة', cat: 'basic', svg: S('0 0 100 100', hatchLines(100, 14)) },

  // ========================= طعام (food line icons) =========================
  { id: 'food-cup', ar: 'فنجان قهوة', cat: 'food', svg: L(`<path d="M8,20 H34 V32 A10,10 0 0 1 24,42 H18 A10,10 0 0 1 8,32 Z"/><path d="M34,22 H38 A5,5 0 0 1 38,32 H34"/><path d="M6,46 H40"/><path d="M15,14 Q13,11 15,8 M22,14 Q20,11 22,8 M29,14 Q27,11 29,8"/>`) },
  { id: 'food-togo', ar: 'كوب سفري', cat: 'food', svg: L(`<path d="M13,14 H35 L32,44 H16 Z"/><path d="M11,10 H37 V14 H11 Z"/><path d="M15,22 H33"/><path d="M20,6 H28 V10 H20 Z"/>`) },
  { id: 'food-teapot', ar: 'إبريق', cat: 'food', svg: L(`<path d="M16,18 H36 C40,24 40,34 36,40 H16 C12,34 12,24 16,18 Z"/><path d="M16,24 L6,20 L8,30 L14,32"/><path d="M36,26 H42 V32 H36"/><path d="M20,18 V14 H32 V18"/><path d="M24,10 H28"/>`) },
  { id: 'food-plate', ar: 'طبق بغطاء', cat: 'food', svg: L(`<path d="M8,34 A16,16 0 0 1 40,34"/><path d="M4,38 H44"/><path d="M22,18 V15 M26,18 V15"/><circle cx="24" cy="13" r="2"/>`) },
  { id: 'food-cutlery', ar: 'شوكة وسكين', cat: 'food', svg: L(`<path d="M16,6 V42"/><path d="M11,6 V16 A5,5 0 0 0 21,16 V6"/><path d="M32,6 C28,14 28,22 32,26 V42"/><path d="M32,6 C36,10 37,20 32,26"/>`) },
  { id: 'food-chef', ar: 'قبعة شيف', cat: 'food', svg: L(`<path d="M14,26 A8,8 0 0 1 12,10 A10,10 0 0 1 36,10 A8,8 0 0 1 34,26 V36 H14 Z"/><path d="M14,40 H34"/><path d="M20,28 V34 M28,28 V34"/>`) },
  { id: 'food-leaf', ar: 'ورقة نعناع', cat: 'food', svg: L(`<path d="M40,8 C40,30 28,42 12,40 C8,24 18,10 40,8 Z"/><path d="M12,40 Q22,28 34,14"/>`) },
  { id: 'food-wheat', ar: 'سنبلة قمح', cat: 'food', svg: L(`<path d="M24,44 V12"/><path d="M24,16 Q18,14 16,8 Q22,8 24,12 Q26,8 32,8 Q30,14 24,16 Z"/><path d="M24,26 Q18,24 16,18 Q22,18 24,22 Q26,18 32,18 Q30,24 24,26 Z"/><path d="M24,36 Q18,34 16,28 Q22,28 24,32 Q26,28 32,28 Q30,34 24,36 Z"/>`) },
  { id: 'food-fish', ar: 'سمكة', cat: 'food', svg: L(`<path d="M6,24 C14,14 26,12 34,18 L42,12 V36 L34,30 C26,36 14,34 6,24 Z"/><circle cx="14" cy="22" r="1" fill="currentColor" stroke="none"/><path d="M24,16 Q28,24 24,32"/>`) },
  { id: 'food-flame', ar: 'لهب', cat: 'food', svg: L(`<path d="M24,4 C28,12 36,16 36,28 A12,12 0 0 1 12,28 C12,20 18,16 18,10 C21,13 23,15 24,18 Z"/><path d="M24,38 A5,5 0 0 1 19,33 C19,30 22,28 24,24 C26,28 29,30 29,33 A5,5 0 0 1 24,38 Z"/>`) },
  { id: 'food-bean', ar: 'حبة بن', cat: 'food', svg: L(`<ellipse cx="24" cy="24" rx="13" ry="18" transform="rotate(28 24 24)"/><path d="M17,9 C26,17 22,31 31,39" transform="rotate(0 24 24)"/>`) },
  { id: 'food-cake', ar: 'قطعة كيك', cat: 'food', svg: L(`<path d="M8,40 H40 V26 L8,32 Z"/><path d="M8,32 L36,10 C40,14 42,20 40,26"/><path d="M22,29 V21 M30,27 V17"/><circle cx="36" cy="8" r="2"/>`) },
  { id: 'food-burger', ar: 'برجر', cat: 'food', svg: L(`<path d="M8,20 A16,10 0 0 1 40,20 H8 Z"/><path d="M8,26 H40"/><path d="M6,32 H42 M10,32 Q14,36 18,32 Q22,28 26,32 Q30,36 34,32"/><path d="M10,38 H38 A4,4 0 0 1 34,42 H14 A4,4 0 0 1 10,38 Z"/>`) },
  { id: 'food-icecream', ar: 'مثلجات', cat: 'food', svg: L(`<path d="M14,22 A10,10 0 0 1 34,22"/><path d="M12,22 H36 L24,44 Z"/><path d="M20,22 L24,34 L28,22"/>`) },

  // ========================= زخارف عربية (arabesque) ========================
  { id: 'arab-khatam', ar: 'نجمة ثمانية', cat: 'arab', svg: S('0 0 100 100', `<polygon points="${k1.a}" fill="currentColor"/><polygon points="${k1.b}" fill="currentColor"/>`) },
  { id: 'arab-khatam-line', ar: 'نجمة ثمانية مفرغة', cat: 'arab', svg: S('0 0 100 100', `<polygon points="${k2.a}" fill="none" stroke="currentColor" stroke-width="2.4"/><polygon points="${k2.b}" fill="none" stroke="currentColor" stroke-width="2.4"/>`) },
  { id: 'arab-star-12', ar: 'نجمة اثنا عشرية', cat: 'arab', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 12, 48, 30)}" fill="currentColor"/><circle cx="50" cy="50" r="14" fill="#ffffff"/><circle cx="50" cy="50" r="14" fill="currentColor" opacity="0.25"/>`) },
  { id: 'arab-tile', ar: 'بلاطة نجمية', cat: 'arab', svg: S('0 0 100 100', `<polygon points="${starPoints(50, 50, 8, 46, 30)}" fill="currentColor"/><polygon points="${polygonPoints(50, 50, 8, 16, -Math.PI / 2)}" fill="#ffffff"/>`) },
  { id: 'arab-zellige', ar: 'زليج معين', cat: 'arab', svg: S('0 0 100 100', `<polygon points="50,2 98,50 50,98 2,50" fill="currentColor"/><polygon points="50,20 80,50 50,80 20,50" fill="none" stroke="#ffffff" stroke-width="2.4"/><polygon points="50,34 66,50 50,66 34,50" fill="#ffffff"/>`) },
  { id: 'arab-girih', ar: 'تربيعة هندسية', cat: 'arab', svg: S('0 0 100 100', `<polygon points="${polygonPoints(50, 50, 6, 46)}" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M50,4 L73,84 M50,4 L27,84 M96,50 L12,66 M96,50 L27,16 M4,50 L88,66 M4,50 L73,16" stroke="currentColor" stroke-width="1.4" fill="none"/>`) },
  { id: 'arab-arch', ar: 'قوس حدوة', cat: 'arab', svg: S('0 0 100 120', `<path d="M14,116 V56 A36,36 0 0 1 12,38 A38,38 0 0 1 88,38 A36,36 0 0 1 86,56 V116 H74 V54 A26,26 0 1 0 26,54 V116 Z" fill="currentColor"/>`) },
  { id: 'arab-arch-pointed', ar: 'قوس مدبب', cat: 'arab', svg: S('0 0 100 120', `<path d="M10,116 V50 Q10,16 50,6 Q90,16 90,50 V116 H78 V52 Q78,26 50,18 Q22,26 22,52 V116 Z" fill="currentColor"/>`) },
  { id: 'arab-dome', ar: 'قبة', cat: 'arab', svg: S('0 0 100 110', `<path d="M50,8 C78,26 90,44 90,66 A40,26 0 0 1 10,66 C10,44 22,26 50,8 Z" fill="currentColor"/><rect x="6" y="92" width="88" height="10" rx="3" fill="currentColor"/><path d="M50,8 V0" stroke="currentColor" stroke-width="3"/>`) },
  { id: 'arab-mashrabiya', ar: 'شبك مشربية', cat: 'arab', svg: S('0 0 96 96', (() => {
    let cells = ''
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cells += `<circle cx="${12 + i * 24}" cy="${12 + j * 24}" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="${12 + i * 24}" cy="${12 + j * 24}" r="3" fill="currentColor"/>`
    return cells
  })()) },
  { id: 'arab-band', ar: 'شريط زخرفي', cat: 'arab', svg: S('0 0 240 32', (() => {
    let d = ''
    for (let i = 0; i < 10; i++) d += `<polygon points="${starPoints(12 + i * 24, 16, 4, 11, 4.5)}" fill="currentColor"/>`
    return d
  })()) },
  { id: 'arab-lantern', ar: 'فانوس', cat: 'arab', svg: L(`<path d="M24,4 V8"/><path d="M18,8 H30"/><path d="M16,12 H32 L34,30 A10,6 0 0 1 14,30 Z"/><path d="M20,12 L19,34 M28,12 L29,34 M24,12 V36"/><path d="M20,38 H28 M24,38 V42"/>`) },
]

export const shapeById = (id) => PRINT_SHAPES.find((s) => s.id === id)

export const shapesByCat = (cat) => PRINT_SHAPES.filter((s) => s.cat === cat)

// Produce the final svg markup for an element's {fill, stroke, strokeW}.
// currentColor → fill; strokeW replaces authored stroke-widths (line shapes);
// stroke (when set on a FILLED shape with no own strokes) becomes an outline.
export function renderShapeSvg(shape, { fill = '#1c1c1e', stroke = '', strokeW = 0 } = {}) {
  if (!shape) return ''
  let s = shape.svg
  if (strokeW > 0) s = s.replace(/stroke-width="[0-9.]+"/g, `stroke-width="${strokeW}"`)
  if (stroke && !/stroke="currentColor"/.test(s)) {
    s = s.replace(/<svg /, `<svg stroke="${stroke}" stroke-width="${strokeW || 2}" `)
  }
  s = s.split('currentColor').join(fill)
  return s
}
