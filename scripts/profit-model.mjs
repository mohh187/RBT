// ============================ نموذج الربحية ============================
// يحسب: كم تكلّف المنشأة الواحدة، وكم تربح المنصة، وكيف يتغيّر ذلك مع النمو.
//
// لماذا سكربت لا جدول: أسعار الوحدة تُقرأ من functions/spend.js مباشرة، فلا
// يمكن أن تنحرف الدراسة عن ما يفرضه النظام فعلياً. وكل افتراض تشغيلي مكتوب
// في ASSUMPTIONS أدناه باسمه ومصدره — غيّره وأعد التشغيل:
//
//     node scripts/profit-model.mjs
//     node scripts/profit-model.mjs --price 899 --venues 10,50,100,500,1000
//
// مصادر الأسعار (تحقّق أوّلي 2026-07-28، انظر SPEND_SOCIAL_RESEARCH.md):
//   Meta WhatsApp السعودية · ai.google.dev/pricing · firebase.google.com/pricing
//   cloud.google.com/firestore/pricing · resend.com/pricing
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const spend = require('../functions/spend.js')

const { UNIT_COST_USD, USD_TO_SAR, CHANNEL_AR } = spend

// ---------------------------------------------------------------- المدخلات
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const PRICE_SAR = Number(arg('price', 899))            // سعر الانطلاقة الحالي
const SCALES = String(arg('venues', '10,50,100,500,1000')).split(',').map(Number)

// ------------------------------------------------------------- الافتراضات
const ASSUMPTIONS = {
  // نافذة الـ 24 ساعة: قوالب Utility داخل محادثة خدمة مفتوحة مجانية. اليوم لا
  // يوجد webhook يتتبع النافذة، فالتقدير المحافظ أن 40% فقط تقع داخلها.
  // --window 0.8 يحاكي أثر بناء webhook متابعة النافذة (المرحلة 2 في الخطة).
  waFreeWindowShare: Number(arg('window', 0.40)),

  // رسوم بوابة الدفع على كل اشتراك محصَّل. Moyasar/mada النموذجية.
  // ليست في الكود — أدخلها الرقم الحقيقي من عقدك.
  paymentFeePct: 0.0275,
  paymentFeeFixedSar: 1.0,

  // نِسَب مشتقة من عدد الطلبات اليومية
  statusMsgsPerOrder: 2.0,    // مقبول + جاهز (الحالات الأخرى غالباً غير مفعّلة)
  receiptMsgsPerOrder: 0.6,   // الإيصال يُرسل للمدفوع أونلاين/المسجّل هاتفه
  emailShareOfOrders: 0.15,   // نسبة الطلبات التي أعطت بريداً
  dinerAiShareOfOrders: 0.10, // نسبة الضيوف الذين يستخدمون الطلب بالصورة/الصوت
  menuOpensPerOrder: 4.0,     // من يفتح المنيو ولا يطلب

  // Firestore لكل فتح منيو: tenant + categories + items + offers + stories…
  readsPerMenuOpen: 60,
  writesPerOrder: 8,
  // شاشات الإدارة (كاشير/طلبات/KDS) مفتوحة طوال الدوام على onSnapshot
  adminReadsPerVenueDay: 6000,

  // جدولة followupMessages كل 15 دقيقة: تقرأ كل المنشآت دائماً، ثم 300 طلب
  // لكل منشأة *مفعِّلة* للمتابعة فقط (الشرط fu.enabled !== true يتخطى البقية).
  followupEnabledShare: 0.35,
  followupOrderReadCap: 300,
  schedulerRunsPerMonth: (60 / 15) * 24 * 30,     // كل 15 دقيقة
  campaignRunsPerMonth: (60 / 5) * 24 * 30,       // processCampaigns كل 5 دقائق
}

// أسعار Firebase المؤكدة (دولار)
const GCP = {
  readPer100k: 0.03,
  writePer100k: 0.09,
  freeReadsPerDay: 50000,
  freeWritesPerDay: 20000,
  functionInvocationsFreeM: 2,
  functionPerMillion: 0.40,
  hostingTransferPerGb: 0.15,
  hostingFreeGbPerDay: 0.36,
  storagePerGb: 0.026,
  schedulerJobPerMonth: 0.10,
  schedulerFreeJobs: 3,
  schedulerJobCount: 8,           // عدد الوظائف المجدولة في المشروع
}

// حزم Resend: أرخص خطة تكفي العدد
const RESEND_TIERS = [
  { emails: 3000, usd: 0 }, { emails: 50000, usd: 20 }, { emails: 100000, usd: 35 },
  { emails: 200000, usd: 160 }, { emails: 500000, usd: 350 }, { emails: 1000000, usd: 650 },
]
const resendCost = (emails) => (RESEND_TIERS.find((t) => emails <= t.emails) || { usd: 650 + Math.ceil((emails - 1e6) / 1000) * 0.65 }).usd

// ---------------------------------------------------- ملفات الاستخدام
// ثلاث منشآت حقيقية بأحجام مختلفة. الطلبات اليومية هي المحرّك؛ الباقي مشتق.
const PROFILES = [
  { key: 'light', ar: 'مقهى صغير', ordersPerDay: 15, customers: 400, campaignsPerMonth: 1, aiText: 120, aiImage: 5, ar3d: 0, tableImage: 2 },
  { key: 'typical', ar: 'مطعم متوسط', ordersPerDay: 50, customers: 1200, campaignsPerMonth: 2, aiText: 400, aiImage: 15, ar3d: 2, tableImage: 4 },
  { key: 'heavy', ar: 'مطعم مزدحم', ordersPerDay: 150, customers: 3000, campaignsPerMonth: 4, aiText: 900, aiImage: 40, ar3d: 6, tableImage: 8 },
]

const A = ASSUMPTIONS
const sar = (usd) => usd * USD_TO_SAR
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2)

// استهلاك القنوات لمنشأة واحدة في الشهر
function channelUsage(p) {
  const orders = p.ordersPerDay * 30
  return {
    waUtility: Math.round(orders * (A.statusMsgsPerOrder + A.receiptMsgsPerOrder)),
    waMarketing: Math.round(p.customers * p.campaignsPerMonth),
    email: Math.round(orders * A.emailShareOfOrders),
    aiText: p.aiText,
    aiImage: p.aiImage,
    ar3d: p.ar3d,
    tableImage: p.tableImage,
    dinerAi: Math.round(orders * A.dinerAiShareOfOrders),
  }
}

// تكلفة القنوات بالدولار (واتساب المعاملات بالحصة المفوترة فقط)
function channelCost(usage) {
  const out = {}
  let total = 0
  for (const [ch, qty] of Object.entries(usage)) {
    const billable = ch === 'waUtility' ? qty * (1 - A.waFreeWindowShare) : qty
    const usd = billable * (UNIT_COST_USD[ch] || 0)
    out[ch] = usd
    total += usd
  }
  return { perChannel: out, total }
}

// ما يسمح به النظام فعلياً: الطلب مقصوصاً على سقوف الباقة.
// الفرق بين هذا وسابقه هو بالضبط ما يفعله المقياس بفاتورتك.
const PLAN_FOR_PRICE = 'enterprise'   // 899 ريال = الباقة الكاملة
function cappedUsage(usage) {
  const out = {}
  for (const [ch, qty] of Object.entries(usage)) {
    const lim = spend.limitsFor({ plan: PLAN_FOR_PRICE }, ch)
    out[ch] = lim.month < 0 ? qty : Math.min(qty, lim.month)
  }
  return out
}

// Firestore لمنشأة واحدة (قبل خصم الحصة المجانية المشتركة)
function firestoreOps(p) {
  const orders = p.ordersPerDay * 30
  const menuOpens = orders * A.menuOpensPerOrder
  const reads = menuOpens * A.readsPerMenuOpen + A.adminReadsPerVenueDay * 30
  const writes = orders * A.writesPerOrder
  return { reads, writes }
}

// تكلفة البنية على مستوى المنصة عند عدد منشآت معيّن
function infraCost(n, profile) {
  const per = firestoreOps(profile)
  // الجدولة: قراءة كل المنشآت في كل تشغيل + قراءات الطلبات للمفعِّلين فقط
  const schedTenantReads = A.schedulerRunsPerMonth * n + A.campaignRunsPerMonth * 1
  const schedOrderReads = A.schedulerRunsPerMonth * n * A.followupEnabledShare * A.followupOrderReadCap
  const reads = per.reads * n + schedTenantReads + schedOrderReads
  const writes = per.writes * n

  const freeReads = GCP.freeReadsPerDay * 30
  const freeWrites = GCP.freeWritesPerDay * 30
  const readUsd = Math.max(0, reads - freeReads) / 100000 * GCP.readPer100k
  const writeUsd = Math.max(0, writes - freeWrites) / 100000 * GCP.writePer100k

  // الاستدعاءات: كل رسالة/طلب/تشغيل مجدول
  const invocations = writes * 2 + schedTenantReads / 50 + n * 3000
  const fnUsd = Math.max(0, invocations - GCP.functionInvocationsFreeM * 1e6) / 1e6 * GCP.functionPerMillion

  const hostingGb = n * 0.9   // ~0.9 GB نقل شهرياً لكل منشأة
  const hostUsd = Math.max(0, hostingGb - GCP.hostingFreeGbPerDay * 30) * GCP.hostingTransferPerGb
  const storeUsd = n * 2 * GCP.storagePerGb   // ~2 GB وسائط لكل منشأة
  const schedUsd = Math.max(0, GCP.schedulerJobCount - GCP.schedulerFreeJobs) * GCP.schedulerJobPerMonth

  const emails = channelUsage(profile).email * n
  const resendUsd = resendCost(emails)

  return {
    reads, writes, readUsd, writeUsd, fnUsd, hostUsd, storeUsd, schedUsd, resendUsd,
    total: readUsd + writeUsd + fnUsd + hostUsd + storeUsd + schedUsd + resendUsd,
  }
}

// ------------------------------------------------------------------ التقرير
const line = (s = '') => console.log(s)
const hr = () => line('-'.repeat(78))

line('')
line('==================== دراسة ربحية RBT360 ====================')
line(`سعر الاشتراك المحسوب عليه: ${PRICE_SAR} ريال/شهر · 1 USD = ${USD_TO_SAR} SAR`)
line('')

// --- 1. تكلفة القنوات لكل ملف استخدام ---
line('### 1) تكلفة القنوات للمنشأة الواحدة (ريال/شهر)')
hr()
const header = ['القناة', ...PROFILES.map((p) => p.ar)]
line(header.map((h, i) => (i ? h.padStart(16) : h.padEnd(22))).join(''))
hr()
const usages = PROFILES.map(channelUsage)
const costs = usages.map(channelCost)
for (const ch of Object.keys(usages[0])) {
  const cells = costs.map((c, i) => `${f2(sar(c.perChannel[ch]))} (${usages[i][ch]})`.padStart(16))
  line((CHANNEL_AR[ch] || ch).padEnd(22) + cells.join(''))
}
hr()
line('مجموع القنوات'.padEnd(22) + costs.map((c) => f2(sar(c.total)).padStart(16)).join(''))
line('')

// --- 1ب. ما يسمح به النظام فعلياً ---
const cappedUsages = usages.map(cappedUsage)
const cappedCosts = cappedUsages.map(channelCost)
line('### 1ب) نفس المنشآت — بعد سقوف الباقة الكاملة (ما يحدث فعلاً اليوم)')
hr()
line('القناة'.padEnd(22) + PROFILES.map((p) => p.ar.padStart(16)).join(''))
hr()
for (const ch of Object.keys(usages[0])) {
  const cells = cappedCosts.map((c, i) => {
    const clipped = cappedUsages[i][ch] < usages[i][ch] ? '*' : ''
    return `${f2(sar(c.perChannel[ch]))}${clipped} (${cappedUsages[i][ch]})`.padStart(16)
  })
  line((CHANNEL_AR[ch] || ch).padEnd(22) + cells.join(''))
}
hr()
line('مجموع القنوات'.padEnd(22) + cappedCosts.map((c) => f2(sar(c.total)).padStart(16)).join(''))
line('(*) قُصَّ على سقف الباقة — الفرق هو ما وفّره المقياس')
line('')

// --- 2. الربحية لكل منشأة عند أحجام مختلفة ---
line('### 2) الربح لكل منشأة (ريال/شهر) — قبل البنية التحتية')
hr()
const feeOf = (price) => price * A.paymentFeePct + A.paymentFeeFixedSar
const netRevenue = PRICE_SAR - feeOf(PRICE_SAR)
line(`الإيراد ${PRICE_SAR} − رسوم الدفع ${f2(feeOf(PRICE_SAR))} = صافي ${f2(netRevenue)} ريال`)
hr()
PROFILES.forEach((p, i) => {
  const raw = sar(costs[i].total)
  const cap = sar(cappedCosts[i].total)
  const grossRaw = netRevenue - raw
  const grossCap = netRevenue - cap
  line(`${p.ar.padEnd(14)} بلا سقوف: تكلفة ${f2(raw).padStart(9)} → ${f2(grossRaw).padStart(10)} (${((grossRaw / PRICE_SAR) * 100).toFixed(0)}%)`)
  line(`${''.padEnd(14)} بالسقوف : تكلفة ${f2(cap).padStart(9)} → ${f2(grossCap).padStart(10)} (${((grossCap / PRICE_SAR) * 100).toFixed(0)}%)`)
})
line('')

// --- 3. مع النمو ---
line('### 3) صورة المنصة كاملة مع النمو (ملف «مطعم متوسط»)')
hr()
line('منشآت'.padEnd(9) + 'إيراد'.padStart(12) + 'قنوات'.padStart(12) + 'بنية'.padStart(11) + 'ربح'.padStart(13) + 'هامش'.padStart(9) + 'بنية/منشأة'.padStart(13))
hr()
const typical = PROFILES[1]
const typicalCost = sar(channelCost(cappedUsage(channelUsage(typical))).total)
for (const n of SCALES) {
  const rev = netRevenue * n
  const chan = typicalCost * n
  const infra = sar(infraCost(n, typical).total)
  const profit = rev - chan - infra
  line(
    String(n).padEnd(9)
    + f2(rev).padStart(12) + f2(chan).padStart(12) + f2(infra).padStart(11)
    + f2(profit).padStart(13) + `${((profit / rev) * 100).toFixed(1)}%`.padStart(9)
    + f2(infra / n).padStart(13),
  )
}
line('')

// --- 4. تفصيل البنية عند كل حجم ---
line('### 4) أين تذهب فاتورة البنية (ريال/شهر، ملف متوسط)')
hr()
line('منشآت'.padEnd(9) + 'قراءات FS'.padStart(12) + 'كتابات'.padStart(10) + 'دوال'.padStart(10) + 'استضافة'.padStart(11) + 'تخزين'.padStart(10) + 'Resend'.padStart(10))
hr()
for (const n of SCALES) {
  const c = infraCost(n, typical)
  line(
    String(n).padEnd(9)
    + f2(sar(c.readUsd)).padStart(12) + f2(sar(c.writeUsd)).padStart(10)
    + f2(sar(c.fnUsd)).padStart(10) + f2(sar(c.hostUsd)).padStart(11)
    + f2(sar(c.storeUsd)).padStart(10) + f2(sar(c.resendUsd)).padStart(10),
  )
}
line('')
// كم من القراءات سببها الجدولة وحدها
for (const n of SCALES) {
  const sched = A.schedulerRunsPerMonth * n + A.schedulerRunsPerMonth * n * A.followupEnabledShare * A.followupOrderReadCap
  const all = infraCost(n, typical).reads
  line(`  عند ${String(n).padStart(4)} منشأة: الجدولة وحدها ${((sched / all) * 100).toFixed(1)}% من قراءات Firestore (${(sched / 1e6).toFixed(1)}M من ${(all / 1e6).toFixed(1)}M)`)
}
line('')

// --- 5. نقطة التعادل ---
line('### 5) سعر التعادل لكل ملف استخدام (ريال/شهر)')
hr()
PROFILES.forEach((p, i) => {
  const c = sar(costs[i].total) + sar(infraCost(100, p).total / 100)
  // سعر يغطي التكلفة + رسوم الدفع
  const breakeven = (c + A.paymentFeeFixedSar) / (1 - A.paymentFeePct)
  line(`${p.ar.padEnd(14)} تكلفة كاملة ${f2(c).padStart(9)} → تعادل عند ${f2(breakeven).padStart(9)} ريال`)
})
line('')

// --- 6. ربحية حزم الرصيد ---
line('### 6) هامش حزم الرصيد المباعة')
hr()
line('القناة'.padEnd(22) + 'الحزمة'.padStart(10) + 'السعر'.padStart(9) + 'التكلفة'.padStart(10) + 'الربح'.padStart(10) + 'المضاعف'.padStart(10))
hr()
for (const [ch, packs] of Object.entries(spend.SPEND_PACKS)) {
  for (const p of packs) {
    const cost = sar(p.qty * (UNIT_COST_USD[ch] || 0) * (ch === 'waUtility' ? (1 - A.waFreeWindowShare) : 1))
    const profit = p.sar - cost
    line(
      (CHANNEL_AR[ch] || ch).padEnd(22)
      + String(p.qty).padStart(10) + String(p.sar).padStart(9)
      + f2(cost).padStart(10) + f2(profit).padStart(10)
      + `${(p.sar / Math.max(cost, 0.01)).toFixed(1)}x`.padStart(10),
    )
  }
}
line('')
line('ملاحظة: كل رقم أعلاه مشتق من ASSUMPTIONS في رأس هذا الملف — غيّرها وأعد التشغيل.')
line('')
