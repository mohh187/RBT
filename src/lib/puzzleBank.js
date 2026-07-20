// «بنك الألغاز» — generators + curated logic puzzles. Data and pure functions
// only, no UI, no React.
//
// HONESTY CONTRACT:
//   • A generator is only allowed to exist if the correct answer is COMPUTED
//     here, never assumed. Every family below either derives its answer from a
//     formula (grid sticks, grid squares, sequences, arithmetic word problems,
//     polyomino rotation) or is hand-curated with a written justification.
//   • Odd-one-out generators run an explicit ambiguity check: if any element
//     other than the intended intruder is unique on a simple numeric feature
//     (prime / square / parity / divisible by 3 or 5 / digit count) the puzzle
//     is thrown away and regenerated. A puzzle with two defensible answers is
//     a broken puzzle.
//   • Lateral-thinking riddles are the classic ones whose reasoning genuinely
//     holds; each carries a `explain` that closes the loop.
//   • Everything is driven by a SEEDED rng, so a stage can be regenerated
//     identically from (seed, stageIndex) when the player resumes.

// ---------------------------------------------------------------- rng ----
// mulberry32 — small, fast, deterministic.
export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ri = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1))
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]
const shuf = (rnd, arr) => {
  const r = [...arr]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

// Wrap a computed answer + distractors into a 4-choice puzzle. Returns null if
// four DISTINCT options could not be formed — the caller then retries, so a
// malformed puzzle can never reach the player.
function choice4(rnd, answer, distractors) {
  const seen = new Set([String(answer)])
  const wrong = []
  for (const d of distractors) {
    const s = String(d)
    if (wrong.length >= 3) break
    if (seen.has(s)) continue
    seen.add(s)
    wrong.push(s)
  }
  if (wrong.length < 3) return null
  const opts = shuf(rnd, [String(answer), ...wrong])
  return { choices: opts.map((label) => ({ label, art: null })), answer: opts.indexOf(String(answer)) }
}

// ------------------------------------------------------------ families ----
export const PUZZLE_FAMILIES = [
  { id: 'seq', ar: 'إكمال المتتابعة', en: 'Sequences', icon: 'arrowUpDown' },
  { id: 'odd', ar: 'الشاذ من المجموعة', en: 'Odd one out', icon: 'shapes' },
  { id: 'analogy', ar: 'التناظر اللفظي', en: 'Analogies', icon: 'arrowLeftRight' },
  { id: 'sticks', ar: 'أعواد ومربعات', en: 'Sticks and squares', icon: 'grid' },
  { id: 'math', ar: 'استدلال حسابي', en: 'Arithmetic reasoning', icon: 'scale' },
  { id: 'rot', ar: 'تدوير الأشكال', en: 'Spatial rotation', icon: 'reload' },
  { id: 'mem', ar: 'مدى الذاكرة', en: 'Memory span', icon: 'zap' },
  { id: 'riddle', ar: 'تفكير جانبي', en: 'Lateral thinking', icon: 'sparkles' },
]

// ------------------------------------------------------ 1. sequences ----
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43]

function genSeq(rnd, level) {
  const kinds = level <= 1
    ? ['arith', 'fib', 'geom2']
    : level === 2
      ? ['arith', 'fib', 'geom', 'sq', 'tri']
      : ['geom', 'fib', 'sq', 'alt', 'dbl', 'prime']
  const kind = pick(rnd, kinds)
  let terms = []
  let next = 0
  let rule = ''

  if (kind === 'arith') {
    const a = ri(rnd, 2, 14); const d = ri(rnd, 2, 9)
    for (let i = 0; i < 5; i++) terms.push(a + i * d)
    next = a + 5 * d
    rule = `متتابعة حسابية، يُضاف ${d} في كل خطوة.`
  } else if (kind === 'geom2') {
    const a = ri(rnd, 2, 6)
    for (let i = 0; i < 5; i++) terms.push(a * 2 ** i)
    next = a * 2 ** 5
    rule = 'كل حد ضعف الحد الذي قبله.'
  } else if (kind === 'geom') {
    const a = ri(rnd, 1, 4); const r = ri(rnd, 2, 3)
    for (let i = 0; i < 5; i++) terms.push(a * r ** i)
    next = a * r ** 5
    rule = `متتابعة هندسية، كل حد يساوي ما قبله مضروباً في ${r}.`
  } else if (kind === 'fib') {
    let a = ri(rnd, 1, 6); let b = ri(rnd, 2, 9)
    terms = [a, b]
    for (let i = 0; i < 3; i++) { const c = a + b; terms.push(c); a = b; b = c }
    next = a + b
    rule = 'كل حد هو مجموع الحدين السابقين له.'
  } else if (kind === 'sq') {
    const n0 = ri(rnd, 1, 5)
    for (let i = 0; i < 5; i++) terms.push((n0 + i) ** 2)
    next = (n0 + 5) ** 2
    rule = 'الحدود مربعات أعداد متتالية.'
  } else if (kind === 'tri') {
    const n0 = ri(rnd, 1, 5)
    const tri = (n) => (n * (n + 1)) / 2
    for (let i = 0; i < 5; i++) terms.push(tri(n0 + i))
    next = tri(n0 + 5)
    rule = 'أعداد مثلثية: يُضاف في كل خطوة عدد أكبر بواحد من سابقه.'
  } else if (kind === 'alt') {
    const a = ri(rnd, 3, 9); const d = ri(rnd, 2, 6)
    let cur = a
    terms.push(cur)
    for (let i = 0; i < 5; i++) { cur = i % 2 === 0 ? cur + d : cur * 2; terms.push(cur) }
    next = terms.pop()
    rule = `العمليات تتناوب: نضيف ${d} ثم نضرب في اثنين.`
  } else if (kind === 'dbl') {
    const a = ri(rnd, 2, 7); const k = ri(rnd, 1, 4)
    let cur = a
    terms.push(cur)
    for (let i = 0; i < 5; i++) { cur = cur * 2 - k; terms.push(cur) }
    next = terms.pop()
    rule = `كل حد يساوي ضعف ما قبله ناقص ${k}.`
  } else {
    const s = ri(rnd, 0, PRIMES.length - 6)
    terms = PRIMES.slice(s, s + 5)
    next = PRIMES[s + 5]
    rule = 'الحدود أعداد أولية متتالية.'
  }

  const gap = Math.max(1, Math.abs(next - terms[terms.length - 1]))
  const c = choice4(rnd, next, [next + 1, next - 1, next + gap, Math.max(1, next - gap), next + 2, next * 2])
  if (!c) return null
  return {
    family: 'seq',
    kind: 'choice',
    prompt: 'ما الحد التالي في المتتابعة؟',
    sub: `${terms.join('  -  ')}  -  ?`,
    art: null,
    ...c,
    explain: `${rule} الحد التالي هو ${next}.`,
    hint: 'انظر إلى الفرق أو النسبة بين كل حدّين متتاليين.',
  }
}

// ------------------------------------------------- 2. odd one out ----
const isSquare = (n) => Number.isInteger(Math.sqrt(n))
const isPrime = (n) => {
  if (n < 2) return false
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false
  return true
}
const FEATS = [isPrime, isSquare, (n) => n % 2 === 0, (n) => n % 3 === 0, (n) => n % 5 === 0, (n) => String(n).length]

// The whole point: refuse a set where any NON-intruder is also uniquely
// distinguishable — that would give the player a second defensible answer.
function unambiguous(list, intruderIdx) {
  for (const f of FEATS) {
    const vals = list.map(f)
    for (let i = 0; i < vals.length; i++) {
      if (i === intruderIdx) continue
      if (vals.filter((v) => v === vals[i]).length === 1) return false
    }
  }
  return true
}

function genOddNumeric(rnd, level) {
  const rules = level >= 3 ? ['prime', 'square', 'mult'] : ['mult', 'square']
  const rule = pick(rnd, rules)
  const lo = level >= 3 ? 20 : 10
  const hi = level >= 3 ? 99 : 60

  for (let tries = 0; tries < 60; tries++) {
    let good = []
    let text = ''
    if (rule === 'mult') {
      const k = pick(rnd, [3, 4, 6, 7, 8, 9])
      for (let n = lo; n <= hi; n++) if (n % k === 0) good.push(n)
      text = `كل الأعداد من مضاعفات ${k} عدا واحداً.`
    } else if (rule === 'square') {
      for (let n = lo; n <= hi; n++) if (isSquare(n)) good.push(n)
      text = 'كل الأعداد مربعات كاملة عدا واحداً.'
    } else {
      for (let n = lo; n <= hi; n++) if (isPrime(n)) good.push(n)
      text = 'كل الأعداد أولية عدا واحداً.'
    }
    if (good.length < 4) continue
    const three = shuf(rnd, good).slice(0, 3)
    const parity = three[0] % 2
    const digits = String(three[0]).length
    if (!three.every((n) => n % 2 === parity && String(n).length === digits)) continue

    const badPool = []
    for (let n = lo; n <= hi; n++) {
      if (good.includes(n)) continue
      if (n % 2 !== parity || String(n).length !== digits) continue
      badPool.push(n)
    }
    if (!badPool.length) continue
    const intruder = pick(rnd, badPool)
    const list = shuf(rnd, [...three, intruder])
    const idx = list.indexOf(intruder)
    if (!unambiguous(list, idx)) continue

    return {
      family: 'odd',
      kind: 'choice',
      prompt: 'أي عدد لا ينتمي إلى المجموعة؟',
      sub: null,
      art: null,
      choices: list.map((n) => ({ label: String(n), art: null })),
      answer: idx,
      explain: `${text} العدد ${intruder} هو الشاذ.`,
      hint: 'جرّب القسمة على الأعداد الصغيرة، وانظر إن كان العدد مربعاً كاملاً.',
    }
  }
  return null
}

// Curated word sets. Each one names a single, unarguable shared property.
export const ODD_WORDS = [
  [['تفاح', 'موز', 'برتقال', 'جزر'], 3, 'الجزر خضار، والبقية فواكه.'],
  [['أسد', 'نمر', 'صقر', 'فهد'], 2, 'الصقر طائر، والبقية ثدييات مفترسة.'],
  [['الرياض', 'جدة', 'الدمام', 'القاهرة'], 3, 'القاهرة خارج السعودية، والبقية مدن سعودية.'],
  [['ذهب', 'فضة', 'خشب', 'حديد'], 2, 'الخشب ليس معدناً.'],
  [['عين', 'أذن', 'أنف', 'قلم'], 3, 'القلم أداة، والبقية أعضاء حسّية.'],
  [['قهوة', 'شاي', 'عصير', 'كرسي'], 3, 'الكرسي ليس مشروباً.'],
  [['مربع', 'مثلث', 'دائرة', 'مكعب'], 3, 'المكعب مجسم ثلاثي الأبعاد، والبقية أشكال مستوية.'],
  [['حزين', 'فرح', 'غاضب', 'طاولة'], 3, 'الطاولة اسم جامد، والبقية حالات شعورية.'],
  [['نيسان', 'مارس', 'يوليو', 'الأحد'], 3, 'الأحد يوم، والبقية أشهر.'],
  [['هيل', 'قرفة', 'زعفران', 'سكر'], 3, 'السكر محلٍّ وليس بهاراً عطرياً.'],
  [['المشتري', 'زحل', 'القمر', 'المريخ'], 2, 'القمر تابع وليس كوكباً.'],
  [['طبيب', 'مهندس', 'معلم', 'مستشفى'], 3, 'المستشفى مكان، والبقية مهن.'],
  [['سباحة', 'جري', 'قفز', 'ملعب'], 3, 'الملعب مكان، والبقية رياضات.'],
  [['كتاب', 'مجلة', 'صحيفة', 'مكتبة'], 3, 'المكتبة مكان يضم البقية.'],
  [['نحاس', 'ألومنيوم', 'زجاج', 'رصاص'], 2, 'الزجاج ليس معدناً.'],
  [['قمح', 'أرز', 'شعير', 'تمر'], 3, 'التمر ثمرة، والبقية حبوب.'],
  [['سيارة', 'دراجة', 'طائرة', 'طريق'], 3, 'الطريق ليس وسيلة نقل.'],
  [['أزرق', 'أخضر', 'أصفر', 'كبير'], 3, 'كلمة «كبير» ليست لوناً.'],
  [['ثلج', 'بخار', 'ماء', 'رمل'], 3, 'الرمل ليس من حالات الماء.'],
  [['ساعة', 'دقيقة', 'ثانية', 'متر'], 3, 'المتر وحدة طول، والبقية وحدات زمن.'],
]

function genOddWords(rnd, used) {
  const idxs = ODD_WORDS.map((_, i) => i).filter((i) => !used.has(`oddw-${i}`))
  if (!idxs.length) return null
  const i = pick(rnd, idxs)
  const [words, ans, why] = ODD_WORDS[i]
  const order = shuf(rnd, words.map((_, k) => k))
  return {
    id: `oddw-${i}`,
    family: 'odd',
    kind: 'choice',
    prompt: 'أي كلمة لا تنتمي إلى المجموعة؟',
    sub: null,
    art: null,
    choices: order.map((k) => ({ label: words[k], art: null })),
    answer: order.indexOf(ans),
    explain: why,
    hint: 'ابحث عن الصفة المشتركة بين ثلاث كلمات، ثم اسأل: أيها لا تنطبق عليه؟',
  }
}

// ---------------------------------------------------- 3. analogies ----
// [A, B, C, correct D, three distractors, why]
export const ANALOGIES = [
  ['طبيب', 'مستشفى', 'معلم', 'مدرسة', ['كتاب', 'طالب', 'سبورة'], 'العلاقة: صاحب المهنة ومكان عمله.'],
  ['قلم', 'كتابة', 'سكين', 'تقطيع', ['مطبخ', 'حديد', 'طعام'], 'العلاقة: أداة والغرض منها.'],
  ['سمكة', 'ماء', 'طائر', 'هواء', ['عش', 'ريش', 'شجرة'], 'العلاقة: كائن والوسط الذي يتحرك فيه.'],
  ['جوع', 'طعام', 'عطش', 'ماء', ['كوب', 'حرارة', 'صحراء'], 'العلاقة: حاجة وما يزيلها.'],
  ['كتاب', 'فصل', 'بناية', 'طابق', ['طوب', 'مهندس', 'باب'], 'العلاقة: كل وجزء مكوّن له.'],
  ['حبة بن', 'قهوة', 'حبة قمح', 'خبز', ['حقل', 'مطحنة', 'فلاح'], 'العلاقة: مادة خام والمنتج النهائي منها.'],
  ['ساعة', 'وقت', 'ميزان', 'وزن', ['حديد', 'سوق', 'كفة'], 'العلاقة: أداة وما تقيسه.'],
  ['نار', 'دخان', 'مطر', 'غيوم', ['برد', 'مظلة', 'نهر'], 'العلاقة: ظاهرة وما يصاحبها أو ينشأ عنها.'],
  ['أعمى', 'بصر', 'أصم', 'سمع', ['كلام', 'أذن', 'صوت'], 'العلاقة: فقدان حاسة واسم تلك الحاسة.'],
  ['نحلة', 'عسل', 'بقرة', 'حليب', ['مرعى', 'قرن', 'حظيرة'], 'العلاقة: حيوان وما ينتجه.'],
  ['بذرة', 'شجرة', 'طفل', 'رجل', ['أم', 'لعبة', 'مدرسة'], 'العلاقة: طور مبكر وطور مكتمل.'],
  ['مفتاح', 'قفل', 'كلمة السر', 'حساب', ['هاتف', 'شاشة', 'برنامج'], 'العلاقة: وسيلة الفتح وما تفتحه.'],
  ['طبيب', 'مريض', 'محامٍ', 'موكّل', ['محكمة', 'قانون', 'قاضٍ'], 'العلاقة: مهني ومن يقدّم له خدمته.'],
  ['قدم', 'حذاء', 'يد', 'قفاز', ['ساعة', 'خاتم', 'أصابع'], 'العلاقة: عضو وما يُلبس عليه لحمايته كاملاً.'],
  ['شمس', 'نهار', 'قمر', 'ليل', ['نجم', 'سماء', 'ظلام'], 'العلاقة: جرم والوقت الذي يرتبط به.'],
  ['برد', 'معطف', 'مطر', 'مظلة', ['شتاء', 'ماء', 'حذاء'], 'العلاقة: ظرف جوي وما يقي منه.'],
  ['كلمة', 'جملة', 'حرف', 'كلمة', ['نقطة', 'صفحة', 'قصة'], 'العلاقة: وحدة أصغر تتركب منها الوحدة الأكبر.'],
  ['ريشة', 'رسام', 'مبضع', 'جراح', ['مريض', 'دواء', 'ممرض'], 'العلاقة: أداة ومن يستخدمها في عمله.'],
  ['سؤال', 'جواب', 'مشكلة', 'حل', ['صعوبة', 'وقت', 'عقل'], 'العلاقة: موقف وما ينهيه.'],
  ['ثلج', 'بارد', 'جمر', 'ساخن', ['أسود', 'خفيف', 'قاسٍ'], 'العلاقة: مادة والصفة الحرارية الملازمة لها.'],
  ['خريطة', 'أرض', 'مخطط', 'مبنى', ['قلم', 'ورق', 'مدينة'], 'العلاقة: تمثيل مصغّر والشيء الحقيقي.'],
  ['جيش', 'جندي', 'أسطول', 'سفينة', ['بحر', 'قائد', 'ميناء'], 'العلاقة: مجموعة والوحدة المكونة لها.'],
  ['أذن', 'سماع', 'عين', 'رؤية', ['نظارة', 'دمعة', 'نور'], 'العلاقة: عضو ووظيفته.'],
  ['ماء', 'بخار', 'جليد', 'ماء', ['ثلج', 'برودة', 'مطر'], 'العلاقة: حالة المادة وما تتحول إليه عند التسخين.'],
]

function genAnalogy(rnd, used) {
  const idxs = ANALOGIES.map((_, i) => i).filter((i) => !used.has(`ana-${i}`))
  if (!idxs.length) return null
  const i = pick(rnd, idxs)
  const [a, b, c, d, wrong, why] = ANALOGIES[i]
  const opts = shuf(rnd, [d, ...wrong])
  return {
    id: `ana-${i}`,
    family: 'analogy',
    kind: 'choice',
    prompt: 'أكمل التناظر',
    sub: `${a} : ${b}  ::  ${c} : ?`,
    art: null,
    choices: opts.map((label) => ({ label, art: null })),
    answer: opts.indexOf(d),
    explain: why,
    hint: 'صِغ العلاقة بين الكلمتين الأوليين في جملة، ثم طبّقها حرفياً على الثالثة.',
  }
}

// --------------------------------------- 4. sticks and squares (grids) ----
// Every answer here is a closed-form count, so it is provably right:
//   sticks in an n x n grid of unit squares = 2n(n+1)
//   squares of all sizes                    = n(n+1)(2n+1)/6
//   rectangles of all sizes                 = (n(n+1)/2)^2
function genSticks(rnd, level) {
  const n = level <= 1 ? ri(rnd, 2, 3) : level === 2 ? ri(rnd, 3, 4) : ri(rnd, 4, 5)
  const kinds = level >= 3 ? ['count', 'squares', 'rects'] : ['count', 'squares']
  const kind = pick(rnd, kinds)

  if (kind === 'count') {
    const ans = 2 * n * (n + 1)
    const c = choice4(rnd, ans, [4 * n * n, n * (n + 1), 2 * n * (n + 2), ans + 2, ans - 2])
    if (!c) return null
    return {
      family: 'sticks',
      kind: 'choice',
      prompt: `كم عود ثقاب يلزم لبناء شبكة مربعات ${n} × ${n}؟`,
      sub: null,
      art: { type: 'grid', n },
      ...c,
      explain: `الأعواد الأفقية ${n + 1} صفاً في كل صف ${n} عوداً، ومثلها رأسياً، فالمجموع ${2 * n * (n + 1)} عوداً، وقانونه 2n(n+1).`,
      hint: 'اعدّ الأعواد الأفقية والرأسية كل مجموعة على حدة.',
    }
  }
  if (kind === 'squares') {
    let ans = 0
    for (let k = 1; k <= n; k++) ans += k * k
    const c = choice4(rnd, ans, [n * n, n * n + 1, (n * (n + 1)) / 2, ans + 1, ans - 1, 2 * n * n])
    if (!c) return null
    return {
      family: 'sticks',
      kind: 'choice',
      prompt: `كم مربعاً بجميع الأحجام تجد في هذه الشبكة ${n} × ${n}؟`,
      sub: null,
      art: { type: 'grid', n },
      ...c,
      explain: `المربعات ${n} × ${n} عددها واحد، والأصغر منها أكثر: المجموع ${ans}، وقانونه مجموع مربعات الأعداد من واحد إلى ${n}.`,
      hint: 'لا تعدّ المربعات الصغيرة فقط — احسب أيضاً المربعات الأكبر المكوّنة من عدة خانات.',
    }
  }
  const half = (n * (n + 1)) / 2
  const ans = half * half
  let sq = 0
  for (let k = 1; k <= n; k++) sq += k * k
  const c = choice4(rnd, ans, [sq, n * n, ans - n, ans + n, half])
  if (!c) return null
  return {
    family: 'sticks',
    kind: 'choice',
    prompt: `كم مستطيلاً (بما فيها المربعات) تجد في شبكة ${n} × ${n}؟`,
    sub: null,
    art: { type: 'grid', n },
    ...c,
    explain: `تختار خطين أفقيين من ${n + 1} وخطين رأسيين من ${n + 1}، فيكون العدد ${half} × ${half} = ${ans}.`,
    hint: 'كل مستطيل يتحدد باختيار خطين أفقيين وخطين رأسيين.',
  }
}

// ------------------------------------------ 5. arithmetic reasoning ----
function genMath(rnd, level) {
  const kinds = level <= 1 ? ['split', 'rate', 'chain'] : level === 2 ? ['split', 'rate', 'chain', 'age', 'pct'] : ['age', 'pct', 'chain', 'work', 'rate']
  const kind = pick(rnd, kinds)

  if (kind === 'split') {
    const n = ri(rnd, 3, 6); const each = ri(rnd, 12, 40); const total = n * each
    const c = choice4(rnd, each, [each + 1, each - 1, total - n, Math.round(total / (n + 1)), each + n])
    if (!c) return null
    return {
      family: 'math', kind: 'choice',
      prompt: `فاتورة مجموعها ${total} ريالاً اقتسمها ${n} أشخاص بالتساوي. كم دفع كل واحد؟`,
      sub: null, art: null, ...c,
      explain: `${total} ÷ ${n} = ${each} ريالاً لكل شخص.`,
      hint: 'قسمة بسيطة: المجموع على عدد الأشخاص.',
    }
  }
  if (kind === 'rate') {
    const per = ri(rnd, 3, 9); const step = ri(rnd, 2, 5); const target = step * ri(rnd, 3, 8)
    const ans = (target / step) * per
    const c = choice4(rnd, ans, [ans + per, ans - per, per * target, ans + step, Math.round(ans / 2)])
    if (!c) return null
    return {
      family: 'math', kind: 'choice',
      prompt: `آلة تحضير القهوة تُخرج ${cups(per)} كل ${mins(step)}. كم كوباً تُخرج في ${mins(target)}؟`,
      sub: null, art: null, ...c,
      explain: `${target} ÷ ${step} = ${target / step} فترة، وكل فترة ${cups(per)}، فالناتج ${ans}.`,
      hint: 'احسب كم مرة تتكرر الفترة الزمنية أولاً.',
    }
  }
  if (kind === 'chain') {
    const x = ri(rnd, 3, 12); const a = ri(rnd, 2, 5); const b = ri(rnd, 3, 15); const d = ri(rnd, 1, 6)
    const ans = x * a + b - d
    const c = choice4(rnd, ans, [x * a + b + d, x * a - b + d, (x + b) * a - d, ans + a, ans - a])
    if (!c) return null
    return {
      family: 'math', kind: 'choice',
      prompt: `فكّر بالعدد ${x}: اضربه في ${a}، ثم أضف ${b}، ثم اطرح ${d}. ما الناتج؟`,
      sub: null, art: null, ...c,
      explain: `${x} × ${a} = ${x * a}، ثم + ${b} = ${x * a + b}، ثم − ${d} = ${ans}.`,
      hint: 'نفّذ العمليات بالترتيب المذكور تماماً.',
    }
  }
  if (kind === 'age') {
    const small = ri(rnd, 4, 18); const big = small * 2; const sum = small + big
    const c = choice4(rnd, small, [big, sum - small - 1, small + 2, Math.round(sum / 2), small - 2])
    if (!c) return null
    return {
      family: 'math', kind: 'choice',
      prompt: `عمر الأخ الأكبر ضعف عمر الأصغر، ومجموع عمريهما ${sum} سنة. كم عمر الأصغر؟`,
      sub: null, art: null, ...c,
      explain: `إذا كان الأصغر س فالأكبر 2س، فيكون 3س = ${sum}، ومنه س = ${small}.`,
      hint: 'سمِّ عمر الأصغر مجهولاً واكتب المجموع بدلالته.',
    }
  }
  if (kind === 'pct') {
    const p = pick(rnd, [10, 20, 25, 50])
    const orig = pick(rnd, [80, 120, 160, 200, 240, 400])
    const ans = orig - (orig * p) / 100
    const c = choice4(rnd, ans, [orig + (orig * p) / 100, (orig * p) / 100, ans + 10, ans - 10, orig])
    if (!c) return null
    return {
      family: 'math', kind: 'choice',
      prompt: `سعر صنف ${orig} ريالاً وعليه خصم ${p} في المئة. كم السعر بعد الخصم؟`,
      sub: null, art: null, ...c,
      explain: `قيمة الخصم ${(orig * p) / 100} ريالاً، فيصبح السعر ${ans} ريالاً.`,
      hint: 'احسب قيمة الخصم أولاً ثم اطرحها من السعر.',
    }
  }
  // Only pairs whose combined time is EXACT in one decimal place — a rounded
  // answer presented as exact would be a lie, so those pairs are excluded.
  const [h1, h2, exact] = pick(rnd, [[2, 3, '1.2'], [2, 6, '1.5'], [3, 6, '2'], [4, 6, '2.4'], [3, 2, '1.2'], [6, 4, '2.4']])
  const c = choice4(rnd, exact, [String(h1 + h2), String((h1 + h2) / 2), String(Math.min(h1, h2)), String(Number(exact) + 1), String(Number(exact) / 2), String(Math.abs(h1 - h2))])
  if (!c) return null
  return {
    family: 'math', kind: 'choice',
    prompt: `عامل ينظّف الصالة في ${hrs(h1)}، وآخر ينظّفها في ${hrs(h2)}. كم يستغرقان معاً؟`,
    sub: null, art: null, ...c,
    explain: `في الساعة ينجز الأول 1/${h1} من العمل والثاني 1/${h2}، فمجموعهما ${h1 + h2}/${h1 * h2} في الساعة، والزمن ${exact} ساعة.`,
    hint: 'اجمع ما ينجزه كل واحد في الساعة الواحدة، لا الأزمنة نفسها.',
  }
}

// Arabic counted nouns: the dual and the 3-10 plural are not interchangeable,
// so the prompts read naturally instead of «2 ساعات».
const hrs = (n) => (n === 1 ? 'ساعة' : n === 2 ? 'ساعتين' : `${n} ساعات`)
const mins = (n) => (n === 1 ? 'دقيقة' : n === 2 ? 'دقيقتين' : n <= 10 ? `${n} دقائق` : `${n} دقيقة`)
const cups = (n) => (n === 1 ? 'كوباً' : n === 2 ? 'كوبين' : n <= 10 ? `${n} أكواب` : `${n} كوباً`)

// ------------------------------------------ 6. spatial rotation (SVG) ----
// Chiral pentominoes/tetrominoes: their mirror image is genuinely a different
// shape, so a mirrored distractor is a fair (not misleading) wrong answer.
const PIECES = [
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 1], [1, 1], [2, 1], [2, 0]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 1], [0, 2], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  [[0, 2], [1, 0], [1, 1], [1, 2], [2, 0]],
]

const normalize = (cells) => {
  const minR = Math.min(...cells.map((c) => c[0]))
  const minC = Math.min(...cells.map((c) => c[1]))
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
}
const rot90 = (cells) => {
  const maxR = Math.max(...cells.map((c) => c[0]))
  return normalize(cells.map(([r, c]) => [c, maxR - r]))
}
const mirror = (cells) => {
  const maxC = Math.max(...cells.map((c) => c[1]))
  return normalize(cells.map(([r, c]) => [r, maxC - c]))
}
const key = (cells) => normalize(cells).map((c) => c.join(',')).join(';')
const artOf = (cells) => {
  const nn = normalize(cells)
  return {
    type: 'poly',
    cells: nn,
    h: Math.max(...nn.map((c) => c[0])) + 1,
    w: Math.max(...nn.map((c) => c[1])) + 1,
  }
}

function genRot(rnd, level) {
  const turns = level >= 3 ? pick(rnd, [1, 2, 3]) : 1
  for (let tries = 0; tries < 40; tries++) {
    const base = pick(rnd, PIECES)
    let target = normalize(base)
    for (let i = 0; i < turns; i++) target = rot90(target)

    const cands = [mirror(target), rot90(target), normalize(base), rot90(rot90(target))]
    const seen = new Set([key(target)])
    const wrong = []
    for (const cd of cands) {
      if (wrong.length >= 3) break
      const k = key(cd)
      if (seen.has(k)) continue
      seen.add(k)
      wrong.push(cd)
    }
    if (wrong.length < 3) continue

    const opts = shuf(rnd, [target, ...wrong])
    const deg = turns * 90
    return {
      family: 'rot',
      kind: 'choice',
      prompt: `أي شكل هو الشكل نفسه بعد تدويره ${deg} درجة مع اتجاه عقارب الساعة؟`,
      sub: null,
      art: artOf(base),
      choices: opts.map((cells) => ({ label: '', art: artOf(cells) })),
      answer: opts.findIndex((cells) => key(cells) === key(target)),
      explain: `التدوير ${deg} درجة يحافظ على شكل القطعة تماماً، والانعكاس (الصورة في المرآة) ينتج شكلاً مختلفاً لا يمكن الوصول إليه بالتدوير.`,
      hint: 'تتبّع الخانة البارزة في الشكل وتخيّل أين تستقر بعد الدوران.',
    }
  }
  return null
}

// ---------------------------------------------------- 7. memory span ----
// The component shows `show` for `showMs`, hides it, then asks. Answer is
// derived from the generated sequence, so it is always right.
function genMem(rnd, level) {
  const len = level <= 1 ? 4 : level === 2 ? 5 : 6
  const digits = []
  while (digits.length < len) {
    const d = ri(rnd, 1, 9)
    if (!digits.includes(d)) digits.push(d)
  }
  const askPos = ri(rnd, 1, len)
  const ans = digits[askPos - 1]
  const order = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس']
  const c = choice4(rnd, ans, shuf(rnd, digits.filter((d) => d !== ans)).concat(shuf(rnd, [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !digits.includes(d)))))
  if (!c) return null
  return {
    family: 'mem',
    kind: 'memory',
    show: digits.join('  '),
    showMs: 1200 + len * 500,
    prompt: `ما الرقم ${order[askPos - 1]} في السلسلة التي ظهرت؟`,
    sub: null,
    art: null,
    ...c,
    explain: `السلسلة كانت ${digits.join(' - ')}، والرقم ${order[askPos - 1]} هو ${ans}.`,
    hint: 'قسّم السلسلة إلى مجموعتين قصيرتين — الذاكرة العاملة تتحمل الأجزاء أفضل من السلسلة الطويلة.',
  }
}

// ------------------------------------------------ 8. lateral thinking ----
// Classic puzzles whose reasoning actually closes. No trick answers that need
// information the player was never given.
export const RIDDLES = [
  ['وقع حادث لأب وابنه، ونُقل الابن إلى المستشفى. نظر الجرّاح إليه وقال: لا أستطيع إجراء العملية، فهذا ابني. كيف؟',
    ['الجرّاح هو أمه', 'الابن له أبوان', 'الجرّاح أخطأ في التعرف', 'كان الأب هو الجرّاح'], 0,
    'الافتراض غير المعلن هو أن الجرّاح رجل. الجرّاحة هي أم الطفل، فلا تناقض في القصة أصلاً.'],
  ['رجل يسكن الطابق العاشر، يركب المصعد صباحاً إلى الأرضي. وفي العودة يصعد إلى السابع ثم يكمل السلّم، إلا في الأيام الممطرة أو حين يرافقه أحد فيصل إلى العاشر. لماذا؟',
    ['المصعد معطل جزئياً', 'قصير القامة ولا يبلغ إلا زر السابع', 'يمارس الرياضة', 'الطابق العاشر مغلق'], 1,
    'الاستثناءان يفسران كل شيء: المظلة تطيل يده، ورفيقه يضغط الزر بدلاً عنه.'],
  ['متسابق تجاوز صاحب المركز الثاني في نهاية السباق. في أي مركز أنهى السباق؟',
    ['الأول', 'الثاني', 'الثالث', 'الرابع'], 1,
    'من يتجاوز صاحب المركز الثاني يأخذ مكانه، فيصبح ثانياً لا أولاً.'],
  ['دخلت غرفة مظلمة فيها مصباح زيت وشمعة ومدفأة، ولا تملك سوى عود ثقاب واحد. ماذا تشعل أولاً؟',
    ['المصباح', 'الشمعة', 'عود الثقاب', 'المدفأة'], 2,
    'لا يمكن إشعال أي منها قبل إشعال العود نفسه.'],
  ['بعض الأشهر فيها واحد وثلاثون يوماً، وبعضها ثلاثون. كم شهراً فيه ثمانية وعشرون يوماً؟',
    ['شهر واحد', 'شهران', 'كل الأشهر', 'لا يوجد'], 2,
    'كل شهر يحتوي على ثمانية وعشرين يوماً على الأقل، والسؤال لم يقل «ثمانية وعشرين فقط».'],
  ['كم مرة يمكنك طرح العدد خمسة من العدد خمسة وعشرين؟',
    ['مرة واحدة', 'خمس مرات', 'أربع مرات', 'عشر مرات'], 0,
    'بعد الطرح الأول لم يعد العدد خمسة وعشرين بل عشرين، فالطرح التالي يكون من عدد آخر.'],
  ['إذا كان أمامك ثلاث تفاحات وأخذت اثنتين، كم تفاحة صارت معك؟',
    ['واحدة', 'اثنتان', 'ثلاث', 'لا شيء'], 1,
    'السؤال عمّا صار معك أنت، وهو ما أخذته: اثنتان.'],
  ['أعطى الطبيب مريضاً ثلاث حبات دواء وقال: حبة كل نصف ساعة. متى ينتهي من آخر حبة؟',
    ['بعد نصف ساعة', 'بعد ساعة', 'بعد ساعة ونصف', 'بعد ساعتين'], 1,
    'الحبة الأولى فوراً، والثانية بعد نصف ساعة، والثالثة بعد ساعة — الفواصل اثنان لا ثلاثة.'],
  ['امرأة أطلقت النار على زوجها، ثم غمرته في الماء خمس دقائق، ثم علّقته. وبعد قليل تعشّيا معاً. كيف؟',
    ['كان حلماً', 'هي مصورة والصورة هي المقصودة', 'الزوج نجا بأعجوبة', 'الحكاية مستحيلة'], 1,
    'كل الأفعال من مفردات التصوير الفوتوغرافي القديم: التقاط اللقطة، التحميض، ثم التعليق حتى تجف.'],
  ['أخوان وُلدا في اليوم نفسه، من الأم نفسها، وفي العام نفسه، لكنهما ليسا توأمين. كيف؟',
    ['أحدهما بالتبني', 'هما اثنان من ثلاثة توائم', 'ولدا في مدينتين', 'اختلاف في التقويم'], 1,
    'التوأم يعني اثنين فقط؛ أما إذا كانوا ثلاثة فكل اثنين منهم ليسا «توأمين».'],
  ['شاحنة سوداء تسير بلا أضواء في ليلة بلا قمر ولا مصابيح شارع، وامرأة ترتدي الأسود تعبر الطريق، فتوقّف السائق في الوقت المناسب. كيف رآها؟',
    ['استخدم الرادار', 'كان الوقت نهاراً', 'سمع صوتها', 'كان يعرف الطريق'], 1,
    'القصة لم تذكر أنها ليلة أصلاً؛ «بلا قمر ولا مصابيح» ينطبق تماماً على وضح النهار.'],
  ['ما الشيء الذي كلما أخذت منه كبر؟',
    ['الجبل', 'الحفرة', 'النهر', 'الرصيد'], 1,
    'كلما أزلت من التراب اتسعت الحفرة، فالأخذ منها زيادة فيها.'],
  ['مزارع لديه سبع عشرة شاة، ماتت كلها إلا تسعاً. كم بقي عنده؟',
    ['ثماني', 'تسع', 'سبع عشرة', 'لا شيء'], 1,
    '«ماتت كلها إلا تسعاً» تعني أن التسع هي الناجية، فالباقي تسع.'],
  ['رجل يدفع فاتورة قهوته كل يوم بالمبلغ نفسه، ورغم أن السعر ارتفع لم يتغير ما يدفعه. لماذا؟',
    ['يشتري كمية أقل', 'لديه اشتراك بسعر ثابت', 'المقهى يجامله', 'دفع مسبقاً لسنة'], 0,
    'المبلغ ثابت لأن الكمية تقلّ، وهذا ما يفعله التضخم بالقوة الشرائية في الحياة الواقعية.'],
]

function genRiddle(rnd, used) {
  const idxs = RIDDLES.map((_, i) => i).filter((i) => !used.has(`rdl-${i}`))
  if (!idxs.length) return null
  const i = pick(rnd, idxs)
  const [q, opts, ans, why] = RIDDLES[i]
  const order = shuf(rnd, opts.map((_, k) => k))
  return {
    id: `rdl-${i}`,
    family: 'riddle',
    kind: 'choice',
    prompt: q,
    sub: null,
    art: null,
    choices: order.map((k) => ({ label: opts[k], art: null })),
    answer: order.indexOf(ans),
    explain: why,
    hint: 'ابحث عن الافتراض الذي أدخلته أنت على القصة ولم تذكره القصة نفسها.',
  }
}

// -------------------------------------------------------- stage build ----
const FAMILY_PLAN = [
  ['seq', 'odd', 'analogy'],
  ['seq', 'odd', 'analogy', 'sticks', 'math'],
  ['seq', 'odd', 'sticks', 'math', 'rot', 'analogy'],
  ['seq', 'math', 'rot', 'mem', 'sticks', 'odd'],
  ['rot', 'mem', 'math', 'sticks', 'riddle', 'seq'],
  ['riddle', 'rot', 'mem', 'math', 'sticks', 'analogy', 'odd', 'seq'],
]

export const STAGE_COUNT = 8
export const stageLevel = (stage) => (stage <= 1 ? 1 : stage <= 4 ? 2 : 3)

/**
 * Build one stage deterministically.
 * @param stage 0-based stage index
 * @param count how many puzzles
 * @param seed  session seed — (seed, stage) always rebuilds the same stage
 * @param used  ids of curated puzzles already served this session
 * @returns array of puzzles; each carries a stable `id`
 */
export function buildStage(stage = 0, count = 6, seed = 1, used = []) {
  const rnd = makeRng((Number(seed) || 1) * 7919 + stage * 104729)
  const level = stageLevel(stage)
  const plan = FAMILY_PLAN[Math.min(stage, FAMILY_PLAN.length - 1)]
  const usedSet = used instanceof Set ? new Set(used) : new Set(used || [])
  const out = []

  for (let i = 0; out.length < count && i < count * 12; i++) {
    const fam = plan[out.length % plan.length]
    const p = genOne(fam, rnd, level, usedSet)
    if (!p) continue
    const id = p.id || `${fam}-s${stage}-${out.length}-${Math.floor(rnd() * 1e6)}`
    if (usedSet.has(id)) continue
    usedSet.add(id)
    out.push({ ...p, id, level, points: 10 + level * 5 })
  }
  return out
}

function genOne(fam, rnd, level, usedSet) {
  switch (fam) {
    case 'seq': return genSeq(rnd, level)
    case 'odd': return rnd() < 0.5 ? genOddNumeric(rnd, level) : (genOddWords(rnd, usedSet) || genOddNumeric(rnd, level))
    case 'analogy': return genAnalogy(rnd, usedSet)
    case 'sticks': return genSticks(rnd, level)
    case 'math': return genMath(rnd, level)
    case 'rot': return genRot(rnd, level)
    case 'mem': return genMem(rnd, level)
    case 'riddle': return genRiddle(rnd, usedSet) || genSeq(rnd, level)
    default: return null
  }
}

// =========================================================================
// WORD BANK — Arabic vocabulary / proverbs / riddles, used by WordRiddles.
// All curated. Meanings are standard dictionary meanings; proverbs are the
// widely-circulated forms. Nothing here is generated blindly.
// =========================================================================

// [كلمة, المرادف الصحيح, [ثلاثة خاطئة], ملاحظة]
export const SYNONYMS = [
  ['بَهيّ', 'جميل', ['ثقيل', 'بعيد', 'قديم'], 'البهاء الحسن والجمال.'],
  ['سَقيم', 'مريض', ['قوي', 'سريع', 'كريم'], 'السقم المرض، ومنه «سقيم» أي عليل.'],
  ['الغَيث', 'المطر', ['الريح', 'البرق', 'الغبار'], 'الغيث المطر النافع، ومنه «الإغاثة».'],
  ['الظمأ', 'العطش', ['الجوع', 'التعب', 'البرد'], 'الظمأ شدة العطش.'],
  ['السَّغَب', 'الجوع', ['العطش', 'النعاس', 'الغضب'], 'السغب الجوع، وردت في اللغة الفصحى.'],
  ['الليث', 'الأسد', ['الذئب', 'الصقر', 'الفهد'], 'الليث من أسماء الأسد.'],
  ['الوَهَن', 'الضعف', ['القوة', 'الكرم', 'الحزن'], 'الوهن ضعف في البدن أو العزم.'],
  ['الحُبور', 'السرور', ['الحزن', 'الخوف', 'الملل'], 'الحبور شدة الفرح.'],
  ['السَّنا', 'الضوء', ['الظل', 'الصوت', 'الرمل'], 'السنا الضوء الساطع، ويختلف عن «السناء» بمعنى الرفعة.'],
  ['الفُلك', 'السفينة', ['النجم', 'الجبل', 'الطريق'], 'الفلك السفينة، وتأتي مفردة وجمعاً.'],
  ['الكَرى', 'النعاس', ['الجري', 'الكرم', 'الصمت'], 'الكرى النوم أو النعاس.'],
  ['الوَجَل', 'الخوف', ['الفرح', 'التعب', 'الشوق'], 'الوجل خوف يخالطه اضطراب.'],
  ['الحِجا', 'العقل', ['اليد', 'الحجر', 'الطريق'], 'الحجا العقل والفطنة.'],
  ['الشَّجَن', 'الحزن', ['النشاط', 'الغنى', 'الحكمة'], 'الشجن الهم والحزن.'],
  ['اليَمّ', 'البحر', ['الجبل', 'الوادي', 'السهل'], 'اليم البحر أو النهر الكبير.'],
  ['النِّبراس', 'المصباح', ['الكرسي', 'الجدار', 'الباب'], 'النبراس المصباح، ويُستعار للقدوة.'],
  ['البُهتان', 'الكذب', ['الصدق', 'الكرم', 'الصبر'], 'البهتان الكذب الذي يُبهت سامعه.'],
  ['الرَّوض', 'البستان', ['الصحراء', 'الميناء', 'السوق'], 'الروضة أرض ذات نبات وخضرة.'],
  ['الأناة', 'التمهّل', ['العجلة', 'القسوة', 'الغفلة'], 'الأناة الرفق وعدم التسرع.'],
  ['الصَّفح', 'العفو', ['العقاب', 'الطرد', 'الحرمان'], 'الصفح ترك المؤاخذة.'],
  ['الجَلَد', 'الصبر', ['الجزع', 'الكسل', 'الطمع'], 'الجلد القوة على الاحتمال.'],
  ['المَرء', 'الإنسان', ['المكان', 'الزمان', 'الطعام'], 'المرء الإنسان، ومؤنثها «المرأة».'],
]

// [كلمة, الضد الصحيح, [ثلاثة خاطئة], ملاحظة]
export const ANTONYMS = [
  ['الجُود', 'البخل', ['الكرم', 'السخاء', 'العطاء'], 'الجود كثرة العطاء، وضده البخل.'],
  ['الظلام', 'النور', ['الليل', 'السحاب', 'الظل'], 'النور نقيض الظلام.'],
  ['العُسر', 'اليُسر', ['الشدة', 'الضيق', 'التعب'], 'قوبل بينهما في اللغة كثيراً.'],
  ['الغِنى', 'الفقر', ['الثراء', 'المال', 'الكسب'], 'الغنى كثرة المال، وضده الفقر.'],
  ['الوفاء', 'الغدر', ['العهد', 'الصدق', 'الأمانة'], 'الغدر نقض العهد، وهو ضد الوفاء.'],
  ['التواضع', 'الكِبْر', ['اللين', 'الرفق', 'الحياء'], 'الكبر رفع النفس فوق قدرها.'],
  ['الاجتماع', 'الفُرقة', ['اللقاء', 'الوصال', 'الجمع'], 'الفرقة ضد الاجتماع.'],
  ['الحِلم', 'الطيش', ['الأناة', 'الصبر', 'العقل'], 'الحلم ضبط النفس، وضده الطيش والتسرع.'],
  ['الشدّة', 'الرخاء', ['الضيق', 'المحنة', 'البلاء'], 'الرخاء سعة العيش، وهو ضد الشدة.'],
  ['الجَهر', 'السرّ', ['الصوت', 'النداء', 'الإعلان'], 'الجهر إظهار الشيء، وضده الإسرار.'],
  ['القُرب', 'البُعد', ['الجوار', 'الدنو', 'الوصل'], 'البعد نقيض القرب.'],
  ['اللؤم', 'الكرم', ['الخسة', 'الدناءة', 'البخل'], 'اللؤم ضد الكرم وأصل الخصال الدنيئة.'],
  ['الحاضر', 'الغائب', ['المقيم', 'الشاهد', 'القريب'], 'الغائب من ليس بحاضر.'],
  ['البداية', 'النهاية', ['المقدمة', 'الافتتاح', 'الانطلاق'], 'النهاية آخر الشيء.'],
  ['الرخيص', 'الغالي', ['الزهيد', 'البخس', 'اليسير'], 'الغالي مرتفع الثمن.'],
  ['الصدق', 'الكذب', ['الأمانة', 'الإخلاص', 'الوضوح'], 'الكذب ضد الصدق.'],
]

// [الكلمة, موضع الحرف الناقص, [ثلاثة حروف خاطئة], تعريف يحدد الكلمة بلا لبس]
export const MISSING_LETTER = [
  ['مفتاح', 2, ['ب', 'س', 'ن'], 'أداة تُفتح بها الأقفال'],
  ['مدرسة', 1, ['ر', 'ز', 'ن'], 'مكان يتلقى فيه الطلاب التعليم'],
  ['قهوة', 2, ['ي', 'ن', 'ب'], 'مشروب يُحضَّر من حبوب البن'],
  ['مصباح', 2, ['ت', 'ن', 'ل'], 'ما يُضيء الغرفة'],
  ['سيارة', 3, ['ز', 'د', 'ن'], 'وسيلة نقل بأربع عجلات'],
  ['كتاب', 1, ['ذ', 'ن', 'ر'], 'مجموعة صفحات تُقرأ'],
  ['حديقة', 2, ['و', 'ن', 'ل'], 'مكان فيه أشجار وزهور'],
  ['طبيب', 2, ['ر', 'ن', 'و'], 'من يعالج المرضى'],
  ['مطار', 1, ['ن', 'د', 'ك'], 'مكان إقلاع الطائرات وهبوطها'],
  ['مكتبة', 2, ['س', 'ر', 'ن'], 'مكان تُحفظ فيه الكتب'],
  ['سحاب', 1, ['ب', 'ر', 'ن'], 'ما يحمل المطر في السماء'],
  ['نجمة', 1, ['ع', 'س', 'خ'], 'جرم يلمع في سماء الليل'],
  ['بستان', 1, ['ر', 'ط', 'ح'], 'أرض فيها أشجار مثمرة'],
  ['صديق', 2, ['و', 'ن', 'ه'], 'من تأنس بصحبته وتثق به'],
  ['مطبخ', 2, ['ر', 'ل', 'ن'], 'مكان إعداد الطعام'],
  ['فنجان', 1, ['ر', 'ل', 'ت'], 'إناء صغير تُشرب فيه القهوة'],
  ['عصير', 2, ['و', 'ه', 'ن'], 'شراب يُستخرج من الفواكه'],
  ['مسافر', 3, ['ط', 'ع', 'ك'], 'من يشد الرحال إلى بلد آخر'],
  ['زهرة', 1, ['م', 'ك', 'ب'], 'نبتة ملونة ذات رائحة'],
  ['حاسوب', 3, ['ي', 'ن', 'ر'], 'جهاز يعالج البيانات ويشغّل البرامج'],
]

// [نص المثل مع فراغ, التتمة الصحيحة, [ثلاث خاطئة], شرح المعنى]
export const PROVERBS = [
  ['الجار قبل', 'الدار', ['السفر', 'المال', 'العمل'], 'اختر الجيران قبل أن تختار البيت.'],
  ['الصيف ضيّعتِ', 'اللبن', ['الزرع', 'الوقت', 'المال'], 'يُضرب لمن فرّط في وقت الإمكان ثم طلب بعد فواته.'],
  ['من جدّ', 'وجد', ['سعد', 'قعد', 'ربح'], 'من بذل الجهد بلغ مطلوبه.'],
  ['خير الكلام ما قلّ', 'ودلّ', ['وطال', 'وحلا', 'وصدق'], 'الإيجاز مع وضوح المعنى غاية البلاغة.'],
  ['الطيور على أشكالها', 'تقع', ['تطير', 'تحلّق', 'تهاجر'], 'المرء يميل إلى من يشبهه.'],
  ['في التأني السلامة وفي العجلة', 'الندامة', ['الراحة', 'الخسارة', 'الشجاعة'], 'التسرع مظنة الخطأ والندم.'],
  ['رُبّ أخٍ لك لم تلده', 'أمك', ['دارك', 'أرضك', 'عمتك'], 'قد يكون الصديق أقرب من القريب.'],
  ['الوقت كالسيف إن لم تقطعه', 'قطعك', ['مضى', 'ضاع', 'انتهى'], 'إهمال الوقت يضر صاحبه.'],
  ['لكل جوادٍ', 'كبوة', ['فارس', 'ميدان', 'سرج'], 'حتى المتقن قد يخطئ مرة.'],
  ['عند الشدائد تُعرف', 'الإخوان', ['الأوطان', 'الأزمان', 'البلدان'], 'المحن تكشف صدق الصداقة.'],
  ['إن غداً لناظره', 'قريب', ['بعيد', 'غريب', 'عجيب'], 'ما يُنتظر من الغد آتٍ عن قرب.'],
  ['من سار على الدرب', 'وصل', ['تعب', 'ضلّ', 'رجع'], 'المواظبة على الطريق الصحيح تبلغ الغاية.'],
  ['الصديق وقت', 'الضيق', ['الرخاء', 'الفرح', 'السفر'], 'الصديق الحق يظهر عند الحاجة.'],
  ['اتقِ شرّ الحليم إذا', 'غضب', ['سكت', 'تكلّم', 'رضي'], 'من طال حلمه كان غضبه شديداً حين يقع.'],
  ['يد واحدة', 'لا تصفّق', ['تبني', 'تكفي', 'تعطي'], 'العمل الجماعي أقدر من الفرد وحده.'],
  ['ما حكّ جلدك', 'مثل ظفرك', ['إلا يدك', 'غير أخيك', 'سوى جارك'], 'تولَّ أمرك بنفسك فأنت أدرى به.'],
  ['الحاجة أم', 'الاختراع', ['العلم', 'الصبر', 'الحكمة'], 'الحاجة تدفع الناس إلى ابتكار الحلول.'],
  ['من طلب العلا سهر', 'الليالي', ['السنين', 'الأيام', 'الشهور'], 'المراتب العالية تُنال بالتعب.'],
  ['أعط الخبز', 'لخبّازه', ['لأهله', 'لجارك', 'لصانعه'], 'أوكل العمل لأهل الاختصاص فيه.'],
  ['الحديث ذو', 'شجون', ['فنون', 'عيون', 'سكون'], 'الكلام يجرّ بعضه بعضاً.'],
]

// [اللغز, الجواب, [ثلاثة خاطئة], شرح يغلق المنطق]
export const WORD_RIDDLES = [
  ['ما الشيء الذي يمشي بلا قدمين ويبكي بلا عينين؟', 'السحاب', ['الريح', 'النهر', 'الظل'], 'السحاب يسير في السماء وينزل منه المطر كأنه بكاء.'],
  ['ما الشيء الذي له أسنان ولا يعضّ؟', 'المشط', ['الكتاب', 'الحبل', 'الكوب'], 'أسنان المشط اسم لأطرافه المتقاربة.'],
  ['ما الشيء الذي يكتب ولا يقرأ؟', 'القلم', ['الكتاب', 'الدفتر', 'المعلم'], 'القلم أداة الكتابة ولا يقرأ ما يخطه.'],
  ['ما الشيء الذي يوجد في وسط كلمة «باريس»؟', 'حرف الراء', ['برج إيفل', 'نهر السين', 'حرف الباء'], 'حروف الكلمة: ب ا ر ي س، والحرف الأوسط هو الراء.'],
  ['ما الشيء الذي إذا لمسته صرخ؟', 'الجرس', ['الحجر', 'الكتاب', 'المرآة'], 'الجرس يصدر صوته بمجرد ملامسته.'],
  ['ما الشيء الذي له رقبة وليس له رأس؟', 'القارورة', ['الكرسي', 'الشجرة', 'الطاولة'], 'رقبة القارورة اسم للجزء الضيق أعلاها.'],
  ['أخضر في الأرض، أسود في السوق، أحمر في البيت. ما هو؟', 'الشاي', ['التمر', 'العنب', 'البن'], 'ورقة خضراء تُجفف فتسودّ، ثم يصير لون منقوعها أحمر.'],
  ['ما الشيء الذي يُرى ولا يُلمس؟', 'الظل', ['الماء', 'الرمل', 'الحجر'], 'الظل غياب الضوء لا جسم مادي.'],
  ['ما الشيء الذي يدخل الماء ولا يبتلّ؟', 'الضوء', ['القماش', 'الورق', 'الإسفنج'], 'الضوء ينفذ في الماء وليس جسماً يمتص الرطوبة.'],
  ['ما الشيء الذي يتكلم بكل لغات العالم؟', 'الصدى', ['المذياع', 'المترجم', 'الكتاب'], 'الصدى يعيد أي صوت أياً كانت لغته.'],
  ['ما الشيء الذي يزداد كلما أنفقت منه؟', 'العلم', ['المال', 'الطعام', 'الوقود'], 'تعليم غيرك يرسّخ علمك ويزيده.'],
  ['ما الحرف الذي تراه في كلمة «الليل» ثلاث مرات وفي «النهار» مرة واحدة؟', 'اللام', ['الألف', 'النون', 'الهاء'], 'الليل: ا ل ل ي ل فيها ثلاث لامات، والنهار: ا ل ن ه ا ر فيها لام واحدة.'],
  ['ما الشيء الذي يكسو الناس وهو عارٍ؟', 'الإبرة', ['القطن', 'الصوف', 'المغزل'], 'الإبرة تخيط الثياب للناس ولا تُكسى هي.'],
  ['ما الشيء الذي كلما أخذت منه كبر؟', 'الحفرة', ['الجبل', 'النهر', 'الرصيد'], 'كل ما تخرجه من التراب يزيد اتساعها.'],
]

// [السؤال, الجواب, [ثلاثة خاطئة], ملاحظة صرفية]
export const WORD_FORMS = [
  ['ما جمع كلمة «كتاب»؟', 'كتب', ['كتابات', 'كواتب', 'كتيبات'], 'جمع تكسير على وزن «فُعُل».'],
  ['ما مفرد كلمة «أقلام»؟', 'قلم', ['قلمة', 'قليم', 'أقلم'], 'أقلام جمع تكسير لمفرد «قلم».'],
  ['ما جمع كلمة «قلب»؟', 'قلوب', ['أقلاب', 'قلبات', 'قوالب'], 'جمع تكسير على وزن «فُعول».'],
  ['ما جمع كلمة «باب»؟', 'أبواب', ['بوب', 'بابات', 'أبابيب'], 'جمع تكسير على وزن «أفعال».'],
  ['ما مفرد كلمة «أطباء»؟', 'طبيب', ['طب', 'طبّاء', 'مطبب'], 'أطباء جمع تكسير لمفرد «طبيب».'],
  ['ما جمع كلمة «صديق»؟', 'أصدقاء', ['صدائق', 'أصادق', 'صديقات'], 'جمع تكسير على وزن «أفعلاء».'],
  ['ما مفرد كلمة «رجال»؟', 'رجل', ['راجل', 'رجيل', 'مرجل'], 'رجال جمع تكسير لمفرد «رجل».'],
  ['ما جمع كلمة «بيت»؟', 'بيوت', ['بيتات', 'بوائت', 'مبيوت'], 'جمع تكسير على وزن «فُعول».'],
  ['ما مفرد كلمة «عيون»؟', 'عين', ['عيان', 'عوين', 'معين'], 'عيون جمع تكسير لمفرد «عين».'],
  ['ما جمع كلمة «طالب»؟', 'طلاب', ['طوالب', 'مطالب', 'طليبات'], 'من جموع «طالب» المشهورة: طلاب وطلبة.'],
  ['ما جمع كلمة «نجم»؟', 'نجوم', ['نجمات', 'نواجم', 'نجائم'], 'جمع تكسير على وزن «فُعول».'],
  ['ما مفرد كلمة «أشجار»؟', 'شجرة', ['شجر', 'شواجر', 'مشجر'], 'أشجار جمع لمفرد «شجرة».'],
]

export const WORD_FAMILIES = [
  { id: 'syn', ar: 'المرادف', icon: 'text' },
  { id: 'ant', ar: 'الضد', icon: 'arrowLeftRight' },
  { id: 'missing', ar: 'الحرف الناقص', icon: 'penLine' },
  { id: 'proverb', ar: 'إكمال المثل', icon: 'message' },
  { id: 'riddle', ar: 'لغز شعبي', icon: 'sparkles' },
  { id: 'form', ar: 'الجمع والمفرد', icon: 'layers' },
]

const WORD_PLAN = [
  ['syn', 'ant'],
  ['syn', 'ant', 'missing'],
  ['missing', 'proverb', 'syn'],
  ['proverb', 'riddle', 'form'],
  ['riddle', 'form', 'ant', 'missing'],
  ['riddle', 'proverb', 'syn', 'ant', 'missing', 'form'],
]

export const WORD_STAGE_COUNT = 8

function fromPairs(rnd, used, tag, rows, promptOf) {
  const idxs = rows.map((_, i) => i).filter((i) => !used.has(`${tag}-${i}`))
  if (!idxs.length) return null
  const i = pick(rnd, idxs)
  const [a, right, wrong, note] = rows[i]
  const opts = shuf(rnd, [right, ...wrong])
  return {
    id: `${tag}-${i}`,
    family: tag,
    kind: 'choice',
    prompt: promptOf(a),
    sub: null,
    art: null,
    choices: opts.map((label) => ({ label, art: null })),
    answer: opts.indexOf(right),
    explain: note,
  }
}

function genMissing(rnd, used) {
  const idxs = MISSING_LETTER.map((_, i) => i).filter((i) => !used.has(`mis-${i}`))
  if (!idxs.length) return null
  const i = pick(rnd, idxs)
  const [word, blank, wrong, clue] = MISSING_LETTER[i]
  const letters = [...word]
  const right = letters[blank]
  const opts = shuf(rnd, [right, ...wrong])
  return {
    id: `mis-${i}`,
    family: 'missing',
    kind: 'choice',
    prompt: 'ما الحرف الناقص؟',
    sub: clue,
    art: { type: 'letters', letters, blank },
    choices: opts.map((label) => ({ label, art: null })),
    answer: opts.indexOf(right),
    explain: `الكلمة هي «${word}»، والحرف الناقص هو «${right}».`,
  }
}

/**
 * Build one WordRiddles stage deterministically from (seed, stage).
 * Same contract as buildStage: pass the ids already served in `used` so a
 * curated item is never repeated inside a session.
 */
export function buildWordStage(stage = 0, count = 6, seed = 1, used = []) {
  const rnd = makeRng((Number(seed) || 1) * 6151 + stage * 92821)
  const plan = WORD_PLAN[Math.min(stage, WORD_PLAN.length - 1)]
  const usedSet = used instanceof Set ? new Set(used) : new Set(used || [])
  const out = []

  for (let i = 0; out.length < count && i < count * 14; i++) {
    const fam = plan[out.length % plan.length]
    let p = null
    if (fam === 'syn') p = fromPairs(rnd, usedSet, 'syn', SYNONYMS, (w) => `ما مرادف كلمة «${w}»؟`)
    else if (fam === 'ant') p = fromPairs(rnd, usedSet, 'ant', ANTONYMS, (w) => `ما ضد كلمة «${w}»؟`)
    else if (fam === 'missing') p = genMissing(rnd, usedSet)
    else if (fam === 'proverb') p = fromPairs(rnd, usedSet, 'prv', PROVERBS, (t) => `أكمل المثل: ${t} ...`)
    else if (fam === 'riddle') p = fromPairs(rnd, usedSet, 'wrd', WORD_RIDDLES, (q) => q)
    else if (fam === 'form') p = fromPairs(rnd, usedSet, 'frm', WORD_FORMS, (q) => q)
    if (!p || usedSet.has(p.id)) continue
    usedSet.add(p.id)
    const level = stage <= 1 ? 1 : stage <= 4 ? 2 : 3
    out.push({ ...p, level, points: 10 + level * 5, hint: hintFor(p.family) })
  }
  return out
}

function hintFor(fam) {
  switch (fam) {
    case 'syn': return 'ضع الكلمة في جملة، ثم جرّب كل خيار مكانها.'
    case 'ant': return 'ابحث عن الكلمة التي تنفي المعنى تماماً لا التي تقاربه.'
    case 'missing': return 'اقرأ التعريف أولاً، ثم انطق الكلمة كاملة في ذهنك.'
    case 'prv': case 'proverb': return 'أغلب الأمثال تعتمد على السجع أو التقابل في المعنى.'
    case 'wrd': case 'riddle': return 'خذ الوصف حرفياً: كثير من الألغاز تلعب على معنى مجازي لكلمة مألوفة.'
    default: return 'تذكّر أوزان جموع التكسير المشهورة.'
  }
}

/** Total curated items — the hub can show how much content is left. */
export const WORD_TOTAL = SYNONYMS.length + ANTONYMS.length + MISSING_LETTER.length
  + PROVERBS.length + WORD_RIDDLES.length + WORD_FORMS.length

