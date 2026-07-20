// «ألعاب البصيرة» — the scoring/profiling engine.
//
// PURE MODULE: no React, no Firestore, no DOM. Everything here is data +
// arithmetic so it can be audited, unit-tested and reasoned about.
//
// ---------------------------------------------------------------------------
// INTELLECTUAL HONESTY (read before editing)
// ---------------------------------------------------------------------------
// This engine is grounded in mainstream personality psychology:
//   • The five broad factors (Big Five / OCEAN) are the most replicated
//     descriptive model of personality traits in the field.
//   • Two extra practical axes are added because hospitality decisions live on
//     them: decision style (intuitive <-> analytic, the dual-process
//     literature) and experience motive (familiarity/safety <-> exploration,
//     the sensation-seeking / variety-seeking literature).
//
// What this engine does NOT claim:
//   • It is not a clinical instrument. A dozen forced-choice items cannot
//     diagnose anything, and nothing here is medical.
//   • It contains no astrology, numerology, birth-date, name-letter or any
//     other divinatory mapping. A guest's result is produced ONLY from the
//     answers they gave in this session.
//   • Food/drink -> trait mappings are CORRELATIONAL TENDENCIES observed at
//     population level, with modest effect sizes. They are not deterministic
//     facts about an individual. Wherever the underlying evidence is weak or
//     contested (the sweet-taste / prosociality link is the clearest case) the
//     loading is deliberately kept small and the comment says so.
//
// The "how did it know" moment is earned through good item design and
// concrete behavioural predictions that follow from well-documented trait
// correlates — never by pretending to knowledge we do not have.
// ---------------------------------------------------------------------------

import { lex } from './venueTypes.js'

export const INSIGHT_VERSION = 1

// Shown by EVERY insight experience, without exception.
export const INSIGHT_DISCLAIMER_AR =
  'هذه تجربة ترفيهية مبنية على مقاييس الشخصية المعروفة في علم النفس (العوامل الخمسة الكبرى وأبحاث أسلوب القرار)، وليست تشخيصاً طبياً ولا قراءة غيبية — النتيجة مبنية على إجاباتك في هذه الجلسة فقط.'

export const INSIGHT_DISCLAIMER_EN =
  'An entertainment experience grounded in mainstream personality psychology (Big Five and decision-style research). Not a medical assessment and not fortune-telling — the result comes only from the answers you gave here.'

// ---------------------------------------------------------------------------
// THE TRAIT SPACE
// ---------------------------------------------------------------------------
// Every trait is reported on 0..1 where 0.5 means "no evidence either way".
// `low` / `high` are the honest labels for each pole — neither pole is a
// failing, and the copy must never treat one as better than the other.

export const TRAITS = [
  {
    id: 'openness',
    ar: 'الانفتاح على التجربة',
    short: 'انفتاح',
    en: 'Openness',
    low: 'عملي وملموس',
    high: 'فضولي ومتخيّل',
    note: 'الميل إلى الأفكار الجديدة والفن والتجريد مقابل التفضيل للملموس والمجرَّب.',
  },
  {
    id: 'conscientiousness',
    ar: 'الضمير الحي',
    short: 'انضباط',
    en: 'Conscientiousness',
    low: 'مرن وعفوي',
    high: 'منظّم ومثابر',
    note: 'التنظيم والالتزام وضبط النفس مقابل المرونة والعفوية.',
  },
  {
    id: 'extraversion',
    ar: 'الانبساط',
    short: 'انبساط',
    en: 'Extraversion',
    low: 'هادئ ومتأمل',
    high: 'اجتماعي ومتحمس',
    note: 'من أين تستمد طاقتك: من الناس والحركة، أم من الهدوء والمساحة الخاصة.',
  },
  {
    id: 'agreeableness',
    ar: 'التوافق',
    short: 'توافق',
    en: 'Agreeableness',
    low: 'صريح ومستقل',
    high: 'متعاطف ومجامل',
    note: 'الميل إلى التعاون ومراعاة الآخر مقابل الصراحة والاستقلال في الموقف.',
  },
  {
    id: 'stability',
    ar: 'الاتزان الانفعالي',
    short: 'اتزان',
    en: 'Emotional stability',
    low: 'شديد الإحساس',
    high: 'ثابت تحت الضغط',
    note: 'قطب موجب لعامل العصابية: كم يهزّك الضغط وعدم اليقين.',
  },
  {
    id: 'analysis',
    ar: 'أسلوب القرار',
    short: 'تحليل',
    en: 'Decision style',
    low: 'حدسي',
    high: 'تحليلي',
    note: 'هل تقرر من الإحساس السريع أم من المقارنة والتفصيل (أدبيات المسارين في اتخاذ القرار).',
  },
  {
    id: 'novelty',
    ar: 'دافع التجربة',
    short: 'تجديد',
    en: 'Novelty drive',
    low: 'ألفة وأمان',
    high: 'اكتشاف وتجديد',
    note: 'هل يريحك المعروف والمجرَّب أم يجذبك ما لم تجربه بعد.',
  },
]

export const TRAIT_IDS = TRAITS.map((t) => t.id)
export const traitById = (id) => TRAITS.find((t) => t.id === id) || null

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Regularisation constants.
//   PRIOR_MASS  — how much "evidence" a flat 0.5 prior is worth. With one weak
//                 answer the estimate barely moves; with a dozen consistent
//                 answers it approaches the pole. This is what stops a single
//                 tap from declaring someone a total extravert.
//   CONF_MASS   — evidence needed for ~50% confidence on a trait.
const PRIOR_MASS = 1.15
const CONF_MASS = 2.2

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------
// An "answer" is anything carrying trait loadings. Accepted shapes:
//   { openness: 0.8, novelty: 0.6 }
//   { loadings: { openness: 0.8 }, weight: 0.7 }
// Loadings are signed: positive pushes toward the trait's HIGH pole.

const readLoadings = (a) => {
  if (!a || typeof a !== 'object') return { loadings: null, weight: 0 }
  const loadings = a.loadings && typeof a.loadings === 'object' ? a.loadings : a
  const weight = a.loadings ? (a.weight == null ? 1 : num(a.weight)) : 1
  return { loadings, weight: weight > 0 ? weight : 0 }
}

// Raw accumulation, exported so a caller (or a test) can inspect the evidence
// behind a score instead of trusting the number.
export function accumulate(answers) {
  const sum = {}
  const mass = {}
  TRAIT_IDS.forEach((t) => { sum[t] = 0; mass[t] = 0 })
  let n = 0
  for (const a of (Array.isArray(answers) ? answers : [])) {
    const { loadings, weight } = readLoadings(a)
    if (!loadings || !weight) continue
    let touched = false
    for (const t of TRAIT_IDS) {
      const l = num(loadings[t])
      if (!l) continue
      sum[t] += l * weight
      mass[t] += Math.abs(l) * weight
      touched = true
    }
    if (touched) n += 1
  }
  return { sum, mass, count: n }
}

// scoreProfile(answers) -> { traits, mass, confidence, traitConfidence,
//                            topTraits, archetype, alt, answered }
export function scoreProfile(answers, opts = {}) {
  const { sum, mass, count } = accumulate(answers)
  const traits = {}
  const traitConfidence = {}
  for (const t of TRAIT_IDS) {
    // Shrunk toward 0.5 by PRIOR_MASS — a regularised estimate, not a raw mean.
    traits[t] = clamp01(0.5 + 0.5 * (sum[t] / (mass[t] + PRIOR_MASS)))
    traitConfidence[t] = clamp01(mass[t] / (mass[t] + CONF_MASS))
  }
  const confidence = clamp01(
    TRAIT_IDS.reduce((s, t) => s + traitConfidence[t], 0) / TRAIT_IDS.length,
  )

  const topTraits = TRAIT_IDS
    .map((t) => ({
      id: t,
      value: traits[t],
      // distance from the neutral middle, damped by how sure we are
      strength: Math.abs(traits[t] - 0.5) * (0.35 + 0.65 * traitConfidence[t]),
      dir: traits[t] >= 0.5 ? 'high' : 'low',
      confidence: traitConfidence[t],
    }))
    .sort((a, b) => b.strength - a.strength)

  const ranked = rankArchetypes(traits)
  return {
    traits,
    mass,
    confidence,
    traitConfidence,
    topTraits,
    archetype: ranked[0]?.archetype || ARCHETYPES[ARCHETYPES.length - 1],
    archetypeFit: ranked[0]?.fit ?? 0,
    alt: ranked[1]?.archetype || null,
    answered: count,
    source: opts.source || '',
    version: INSIGHT_VERSION,
  }
}

// ---------------------------------------------------------------------------
// ARCHETYPES
// ---------------------------------------------------------------------------
// Each archetype is a point in the seven-dimensional trait space plus honest
// copy. Nearest-centroid assignment: the traits an archetype actually commits
// to (those far from 0.5) weigh more in the distance, so «راعي المجموعة» is
// decided mostly by توافق/انبساط and barely by انفتاح.
//
// Copy tokens — filled at render time from the venue lexicon so a perfumery
// never reads like a cafe:
//   {place} {item} {items} {menu} {order} {guest}
//
// PREDICTIONS are the heart of the "seen" feeling. Every one of them is a
// documented behavioural correlate of the trait combination, phrased with
// hedges («غالباً» / «على الأرجح») because they are tendencies, not certainties.

export const ARCHETYPES = [
  {
    id: 'quietExplorer',
    ar: 'المستكشف الهادئ',
    en: 'The Quiet Explorer',
    centroid: { openness: 0.86, novelty: 0.82, extraversion: 0.24, analysis: 0.5, conscientiousness: 0.5, agreeableness: 0.55, stability: 0.6 },
    portrait:
      'فضولك أكبر بكثير مما يظهر عليك. تحب الجديد وتذهب إليه فعلاً، لكنك تفضّل أن تكتشفه بهدوء أولاً قبل أن تحكي عنه. الاكتشاف عندك تجربة شخصية لا حدثاً اجتماعياً.',
    strengths: [
      'ترى الفرص والتفاصيل التي يمرّ عليها غيرك بسرعة.',
      'تجرّب دون أن تحتاج إلى تشجيع أو رفقة.',
      'تكوّن رأيك بنفسك، فلا تنجرّ خلف الحماس العام.',
    ],
    blindSpot:
      'لأنك لا تعلن اكتشافاتك، قد يصل نصف ما تعرفه إلى الناس متأخراً — أو لا يصل. مشاركتك المبكرة ليست تباهياً، هي إفادة.',
    venue:
      'تدخل {place} وتقرأ {menu} كاملة قبل أن تقرر، وغالباً تختار شيئاً لم تجربه، وتفضّل الطاولة الجانبية على وسط المكان.',
    predictions: [
      'غالباً تجرّب المكان الجديد وحدك أول مرة، ثم تعود إليه مع من تحب.',
      'لديك مكان أو طريق أو صنف تعتبره «اكتشافك الخاص»، ويزعجك قليلاً حين يزدحم.',
      'تغادر التجمعات الكبيرة قبل نهايتها بقليل — ليس ضجراً، بل حاجةً لاستعادة هدوئك.',
    ],
  },
  {
    id: 'ritualMaker',
    ar: 'صانع الطقوس',
    en: 'The Ritual Maker',
    centroid: { conscientiousness: 0.86, novelty: 0.2, openness: 0.6, stability: 0.76, analysis: 0.6, extraversion: 0.4, agreeableness: 0.6 },
    portrait:
      'أنت لا تكرّر الأشياء من الجمود، بل لأنك بنيتها بعناية ووجدتها تعمل. الطقس عندك وسيلة راحة وسيطرة على يوم فوضوي، والتفاصيل الصغيرة الثابتة هي ما يجعل اليوم يومك.',
    strengths: [
      'يمكن الاعتماد عليك — ما تقوله يحدث في وقته.',
      'تبني عادات تصمد لسنوات لا لأسابيع.',
      'تحوّل الأشياء العادية إلى تجربة لها معنى.',
    ],
    blindSpot:
      'حين يُكسر الطقس لسبب خارج عن إرادتك، تتعكّر أكثر مما يستحق الموقف. مرونة يوم واحد لن تهدم ما بنيته.',
    venue:
      'لديك {item} ثابت تطلبه، وربما طاولة تفضّلها ووقت تأتي فيه. التغيير عندك يحتاج سبباً، لا مزاجاً.',
    predictions: [
      'لديك ترتيب ثابت لصباحك، وإذا اختلّ تشعر أن اليوم كله بدأ خطأ.',
      'غالباً تشتري نفس الصنف من نفس المكان منذ سنوات، وتعرف بالضبط متى تغيّر رأيك آخر مرة.',
      'تُحضّر أغراض الغد من الليلة السابقة، أو على الأقل تراجعها ذهنياً قبل النوم.',
    ],
  },
  {
    id: 'curiousAnalyst',
    ar: 'المُحلّل الفضولي',
    en: 'The Curious Analyst',
    centroid: { analysis: 0.9, openness: 0.8, conscientiousness: 0.74, novelty: 0.6, extraversion: 0.4, agreeableness: 0.45, stability: 0.55 },
    portrait:
      'تريد أن تفهم قبل أن تختار، ثم تريد أن تفهم لماذا اخترت. عقلك يحوّل أي قرار صغير إلى مسألة قابلة للمقارنة، وهذا يعطيك قرارات جيدة — بثمن من الوقت.',
    strengths: [
      'نادراً ما تقع في قرار سيّئ بسبب معلومة كان يمكن معرفتها.',
      'تكتشف التناقض في كلام الآخرين بسرعة.',
      'تشرح الأشياء المعقدة ببساطة لأنك فهمتها فعلاً.',
    ],
    blindSpot:
      'ليست كل القرارات تستحق هذا العمق. أحياناً الفارق بين الخيارين لا يساوي الساعة التي أنفقتها في المقارنة، والقرار «الكافي» قرار جيد.',
    venue:
      'تسأل عن المكوّنات وطريقة التحضير قبل أن تطلب، وتقارن بين خيارين لوقت أطول مما يتوقعه من معك.',
    predictions: [
      'تقرأ {menu} كاملة حتى حين تعرف مسبقاً ماذا ستطلب.',
      'قبل أي شراء متوسط الثمن تفتح عدة صفحات مقارنة، وربما أجّلت الشراء أسابيع بسببها.',
      'حين يسألك أحد رأيه في شيء، أول ما يخطر لك هو «يعتمد على…» قبل أن تجيب.',
    ],
  },
  {
    id: 'socialHeart',
    ar: 'القلب الاجتماعي',
    en: 'The Social Heart',
    centroid: { extraversion: 0.9, agreeableness: 0.85, novelty: 0.55, openness: 0.6, conscientiousness: 0.5, analysis: 0.35, stability: 0.6 },
    portrait:
      'الناس هم التجربة عندك، لا الخلفية لها. تلاحظ من لم يتكلم على الطاولة، وتشعر أن الجلسة لم تنجح إن لم يرتَح الجميع فيها. طاقتك تزيد بالناس لا تنقص.',
    strengths: [
      'تفتح الحديث مع الغرباء بسهولة تُحسد عليها.',
      'تلتقط مزاج المجموعة قبل أن ينطق به أحد.',
      'تجعل من حولك يشعرون أنهم مرئيون.',
    ],
    blindSpot:
      'انشغالك براحة الجميع قد يؤجّل سؤالك عن راحتك أنت. أن تقول «لا أريد» ليس تقصيراً في حق أحد.',
    venue:
      'أنت من يقترح المكان، ومن يسأل: هل الطاولة تكفينا؟ وغالباً تطلب شيئاً للمشاركة قبل أن تطلب لنفسك.',
    predictions: [
      'غالباً أنت من يفتح المجموعة ويحدد الموعد، ولو كنت أقل الجميع فراغاً.',
      'تتذكّر تفاصيل صغيرة عن أشخاص قابلتهم مرة واحدة.',
      'الصمت الطويل في السيارة أو على الطاولة يدفعك للكلام قبل غيرك.',
    ],
  },
  {
    id: 'flowIntuitive',
    ar: 'الحدسي المتدفق',
    en: 'The Flowing Intuitive',
    centroid: { analysis: 0.12, openness: 0.8, novelty: 0.8, conscientiousness: 0.34, extraversion: 0.6, agreeableness: 0.6, stability: 0.5 },
    portrait:
      'تعرف ما تريد قبل أن تستطيع شرحه. قرارك يأتي كاملاً في لحظة، والمقارنة الطويلة تُفسد عليك الإحساس بدل أن تحسّنه. تعيش الأشياء وأنت داخلها لا وأنت تخطط لها.',
    strengths: [
      'تقرر بسرعة، فتلحق فرصاً يفوّتها المتردّدون.',
      'حدسك مدرَّب أكثر مما تظن: هو خبرة متراكمة تظهر دفعة واحدة.',
      'لا تتجمّد أمام الخيارات الكثيرة.',
    ],
    blindSpot:
      'الحدس ممتاز في المجالات التي تمرّست فيها، وأضعف في القرارات النادرة الكبيرة. في هذه بالذات، خمس دقائق من الأرقام تحميك.',
    venue:
      'تُغلق {menu} بعد ثوانٍ وتطلب أول ما جذبك، وغالباً لا تندم — وإن ندمت لا تعلّق عليه طويلاً.',
    predictions: [
      'غالباً تطلب أول شيء يلفتك، وتنزعج ممن يبقى يقلّب في الخيارات.',
      'اشتريت شيئاً في لحظة دون تخطيط ثم أحببته أكثر مما اشتريته بعد بحث طويل.',
      'حين يسألونك «لماذا؟» تجد الإجابة صعبة رغم أنك واثق تماماً من قرارك.',
    ],
  },
  {
    id: 'steadyGuardian',
    ar: 'الحارس المطمئن',
    en: 'The Steady Guardian',
    centroid: { novelty: 0.12, conscientiousness: 0.8, agreeableness: 0.75, openness: 0.3, analysis: 0.55, extraversion: 0.4, stability: 0.7 },
    portrait:
      'تفضّل المؤكد على الواعد. ليس خوفاً من الجديد، بل لأنك جرّبت ما يكفي لتعرف قيمة الشيء الذي لا يخذلك. الناس حولك يرتاحون لأنك ثابت في زمن كثير التقلّب.',
    strengths: [
      'أنت خط الأمان في أي مجموعة أو عائلة.',
      'قراراتك قليلة الندم لأنك لا تراهن على المجهول.',
      'تحافظ على ما يستحق أن يُحافَظ عليه.',
    ],
    blindSpot:
      'بعض الأشياء الجيدة لا تعلن عن نفسها إلا بعد التجربة. تجربة واحدة صغيرة كل فترة لن تكلّفك شيئاً، وقد تضيف كثيراً.',
    venue:
      'تعرف ماذا ستطلب قبل أن تدخل {place}، وإن أوصاك أحد بشيء جديد تسأل: «وما الفرق عن المعتاد؟» قبل أن توافق.',
    predictions: [
      'غالباً تطلب نفس الصنف حتى في مكان جديد، لتقيس المكان به.',
      'تحتفظ بجهاز أو ملابس تعمل جيداً حتى بعد أن تصبح قديمة الطراز.',
      'قبل السفر تتأكد من الحجوزات مرة ثانية، وربما ثالثة.',
    ],
  },
  {
    id: 'preciseConnoisseur',
    ar: 'المُتذوّق الدقيق',
    en: 'The Precise Connoisseur',
    centroid: { analysis: 0.85, conscientiousness: 0.8, openness: 0.66, extraversion: 0.3, novelty: 0.45, agreeableness: 0.4, stability: 0.6 },
    portrait:
      'الفرق الصغير مهم عندك، وتراه فعلاً حيث لا يراه غيرك. لا تبحث عن الأكثر، بل عن الأصح: درجة الحرارة، النسبة، التوقيت. معاييرك مرتفعة لأنك طبّقتها على نفسك أولاً.',
    strengths: [
      'تميّز الجودة الحقيقية من العرض اللامع.',
      'تُتقن ما تختار أن تتعلمه، لا تكتفي بمستوى «مقبول».',
      'رأيك مطلوب لأن مدحك لا يُعطى مجاناً.',
    ],
    blindSpot:
      'المعيار العالي يحرمك أحياناً من الاستمتاع بشيء جيد لأنه ليس ممتازاً. ليس كل موقف يستحق التقييم.',
    venue:
      'تسأل عن التفاصيل التي لا يسألها أحد، وتلاحظ فوراً حين يختلف شيء عن المرة السابقة — وغالباً تكون محقاً.',
    predictions: [
      'لاحظت تغيّر مذاق أو جودة منتج تستهلكه قبل أن يتحدث عنه أحد.',
      'لديك أداة أو صنف واحد أنفقت عليه أكثر من اللازم لأن الفرق يهمّك.',
      'يستشيرك من حولك قبل الشراء في المجال الذي تهتم به.',
    ],
  },
  {
    id: 'boldAdventurer',
    ar: 'المُغامر الاجتماعي',
    en: 'The Bold Adventurer',
    centroid: { extraversion: 0.85, novelty: 0.9, openness: 0.8, analysis: 0.25, conscientiousness: 0.35, agreeableness: 0.6, stability: 0.62 },
    portrait:
      'الجديد يجذبك، والجديد مع الناس يجذبك أكثر. تُقنع مجموعة كاملة بتجربة لم يخطط لها أحد، وتحوّل ليلة عادية إلى قصة تُروى. الملل عندك ليس فراغاً بل إنذار.',
    strengths: [
      'تكسر الجمود وتحرّك المجموعة نحو التجربة.',
      'تتأقلم بسرعة مع المفاجئ.',
      'تجمع تجارب وذكريات أكثر من معظم من حولك.',
    ],
    blindSpot:
      'سرعة الانتقال إلى التالي قد تترك الجيّد قبل أن يعطيك كل ما فيه. بعض الأشياء لا تُظهر عمقها إلا في المرة الثالثة.',
    venue:
      'تسأل مباشرة: «ما الجديد عندكم؟» وتطلب ما لم تجربه، وتشجّع من معك على أن يطلب غير ما اعتاد.',
    predictions: [
      'غالباً أنت من يقترح تغيير الخطة في آخر لحظة، ويحمّس البقية عليها.',
      'نادراً ما تطلب نفس الشيء مرتين في نفس المكان.',
      'لديك أكثر من هواية بدأتها بحماس شديد ولم تكملها — وهذا لا يزعجك كثيراً.',
    ],
  },
  {
    id: 'reservedObserver',
    ar: 'الملاحظ المتحفّظ',
    en: 'The Reserved Observer',
    centroid: { extraversion: 0.12, analysis: 0.75, openness: 0.55, novelty: 0.35, conscientiousness: 0.6, agreeableness: 0.5, stability: 0.45 },
    portrait:
      'تتكلم قليلاً وتلاحظ كثيراً. الصمت عندك ليس غياباً بل انتباه، وحين تقول رأيك يكون مبنياً على ما رأيته لا على ما قيل لك. تحتاج مساحتك كما يحتاج غيرك الصحبة.',
    strengths: [
      'ترى ديناميكية المجموعة من الخارج بوضوح.',
      'كلامك محسوب، فيُسمع حين تتكلم.',
      'تعمل بعمق حين تُترك وحدك.',
    ],
    blindSpot:
      'ملاحظتك الدقيقة تصل متأخرة أحياناً لأنك تنتظر اللحظة المناسبة تماماً. رأيك في وقته أنفع من رأيك الكامل بعد فوات الأوان.',
    venue:
      'تختار الزاوية لا الوسط، وتراقب حركة المكان قبل أن تستقر، وتفضّل مكاناً هادئاً على مكان مشهور.',
    predictions: [
      'في اجتماع أو جلسة، تعرف من سيقول ماذا قبل أن يقوله.',
      'بعد يوم مليء بالناس تحتاج ساعة صمت قبل أن تشعر أنك عدت لنفسك.',
      'تراجع في ذهنك حواراً انتهى قبل أيام وتفكر فيما كان يمكن أن تقوله.',
    ],
  },
  {
    id: 'groupKeeper',
    ar: 'راعي المجموعة',
    en: 'The Group Keeper',
    centroid: { agreeableness: 0.92, extraversion: 0.68, conscientiousness: 0.66, openness: 0.5, novelty: 0.4, analysis: 0.45, stability: 0.6 },
    portrait:
      'تحمل عن الآخرين أكثر مما يطلبون. تتذكّر من لا يأكل ماذا، ومن لا يحب أين يجلس، وتنسّق كل ذلك بهدوء دون أن يلاحظ أحد. رضا الطاولة عندك جزء من متعتك.',
    strengths: [
      'تُبقي العلاقات متماسكة عبر السنين.',
      'تتوسّط في الخلاف دون أن تنحاز.',
      'يثق بك الناس بسرعة لأن نيتك ظاهرة.',
    ],
    blindSpot:
      'حين يكون رأيك مختلفاً تميل إلى ابتلاعه حفاظاً على الجو. الصراحة اللطيفة لا تكسر شيئاً، وغيابها يتراكم عليك.',
    venue:
      'أنت من يطلب للجميع، ويسأل عن تفضيلات كل واحد، ويحاول أن يدفع الفاتورة قبل أن يمدّ أحد يده.',
    predictions: [
      'غالباً تتأكد أن الجميع أخذ نصيبه قبل أن تبدأ أنت.',
      'وافقت على طلب لم يكن وقته مناسباً لك، لأن الرفض بدا لك قاسياً.',
      'تحتفظ بمواعيد وتفاصيل مهمة تخص أشخاصاً آخرين أكثر مما تحتفظ بمواعيدك.',
    ],
  },
  {
    id: 'restlessInnovator',
    ar: 'المُجدّد المندفع',
    en: 'The Restless Innovator',
    centroid: { novelty: 0.92, openness: 0.85, conscientiousness: 0.25, analysis: 0.2, extraversion: 0.6, agreeableness: 0.5, stability: 0.5 },
    portrait:
      'رأسك مليء بأفكار أكثر مما يسمح به يومك. تبدأ بسرعة وبحماس حقيقي، ثم تجرّك الفكرة التالية قبل أن تكتمل الأولى. الجديد ليس ترفاً عندك بل وقود.',
    strengths: [
      'تولّد أفكاراً وحلولاً بغزارة نادرة.',
      'لا تخاف من التجربة الأولى ولا من الفشل فيها.',
      'ترى الروابط بين أشياء لا يربطها غيرك.',
    ],
    blindSpot:
      'أفكارك تستحق أكثر مما تُعطيها من وقت. إنهاء فكرة واحدة يعطيك ما لا تعطيه عشر بدايات.',
    venue:
      'تطلب ما لم تسمع به، وتقترح تعديلاً على {item} لم يخطر للمكان نفسه، وتبحث عن {items} التي ليست في {menu}.',
    predictions: [
      'لديك مشاريع أو ملفات بدأتها ولم تكملها، وما زلت تنوي العودة إليها.',
      'غالباً تغيّر ترتيب الغرفة أو شاشة جوالك أكثر من الناس حولك.',
      'تحمّست لفكرة وشرحتها لأحدهم بتفصيل، ثم لم تعد إليها بعد أسبوعين.',
    ],
  },
  {
    id: 'practicalBalancer',
    ar: 'المُوازن العملي',
    en: 'The Practical Balancer',
    centroid: { stability: 0.72, conscientiousness: 0.6, analysis: 0.55, openness: 0.5, novelty: 0.5, extraversion: 0.5, agreeableness: 0.55 },
    portrait:
      'لا تميل إلى طرف على حساب طرف. تجرّب حين يستحق الأمر، وتثبت حين يستحق الثبات، وتقيس الموقف قبل أن تقرر أي وجه من وجوهك يظهر. هذا أصعب مما يبدو، وأندر مما يُقال.',
    strengths: [
      'تتكيّف مع المواقف المختلفة دون أن تفقد نفسك.',
      'قراراتك متزنة، فقلّما تتطرّف في اتجاه وتندم.',
      'يرتاح لك الناس على اختلاف طبائعهم.',
    ],
    blindSpot:
      'الاتزان قد يخفي تفضيلاً حقيقياً لم تعلنه. أحياناً يحتاج من حولك أن يعرف ماذا تريد أنت بالضبط، لا ما هو معقول.',
    venue:
      'تختار بسرعة معقولة، لا أول ما تراه ولا بعد مقارنة طويلة، وغالباً تكون سعيداً باختيارك.',
    predictions: [
      'أصدقاؤك من دوائر مختلفة تماماً لا تلتقي ببعضها.',
      'حين يختلف اثنان أمامك، ترى وجاهة الطرفين قبل أن تنحاز.',
      'نتيجتك هنا قريبة من الوسط في أكثر من محور — وهذا في حد ذاته نمط، لا غياب نمط.',
    ],
  },
]

// Weighted Euclidean distance. A trait the archetype does not commit to
// (centroid near 0.5) barely influences the match.
function archetypeDistance(traits, arch) {
  let acc = 0
  let wsum = 0
  for (const t of TRAIT_IDS) {
    const c = arch.centroid[t]
    if (c == null) continue
    const w = Math.abs(c - 0.5) + 0.22
    const d = (traits[t] ?? 0.5) - c
    acc += w * d * d
    wsum += w
  }
  return wsum ? Math.sqrt(acc / wsum) : 1
}

export function rankArchetypes(traits) {
  return ARCHETYPES
    .map((archetype) => {
      const dist = archetypeDistance(traits, archetype)
      return { archetype, dist, fit: clamp01(1 - dist / 0.55) }
    })
    .sort((a, b) => a.dist - b.dist)
}

export const archetypeById = (id) => ARCHETYPES.find((a) => a.id === id) || null

// Fill the venue tokens in any archetype string.
export function fillLex(text, tenant) {
  if (!text) return ''
  return String(text)
    .replace(/\{place\}/g, lex(tenant, 'place'))
    .replace(/\{items\}/g, lex(tenant, 'items'))
    .replace(/\{item\}/g, lex(tenant, 'item'))
    .replace(/\{menu\}/g, lex(tenant, 'menu'))
    .replace(/\{order\}/g, lex(tenant, 'order'))
    .replace(/\{guest\}/g, lex(tenant, 'guest'))
}

// The archetype with every token resolved for this venue.
export function archetypeCopy(arch, tenant) {
  if (!arch) return null
  return {
    ...arch,
    portrait: fillLex(arch.portrait, tenant),
    strengths: (arch.strengths || []).map((s) => fillLex(s, tenant)),
    blindSpot: fillLex(arch.blindSpot, tenant),
    venue: fillLex(arch.venue, tenant),
    predictions: (arch.predictions || []).map((p) => fillLex(p, tenant)),
  }
}

// ---------------------------------------------------------------------------
// FOOD / DRINK -> TRAIT MAPPING
// ---------------------------------------------------------------------------
// Derived ONLY from attributes the venue already stores on the item:
//   name, description, category, price, prepTime, calories, ingredients,
//   serves, featured.
//
// Evidence notes, honestly graded:
//   BITTER      — liking for bitter/acquired tastes tracks openness to
//                 experience and sensation seeking (repeated-exposure
//                 literature). MODERATE support. Weighted normally.
//   SPICY       — chili liking is one of the better-supported taste/personality
//                 links (sensation seeking / "benign masochism"). GOOD support.
//   SWEET       — the sweet-taste <-> prosociality finding is famous but its
//                 replications are MIXED. Deliberately weighted LOW here, and
//                 never used alone to drive a result.
//   SLOW/RITUAL — choosing a long-prep preparation over a fast one is a
//                 delay-of-gratification signal; self-control tracks
//                 conscientiousness. MODERATE support.
//   HEALTH      — dietary restraint tracks conscientiousness. GOOD support.
//   SHAREABLE   — choosing to share food is a social-orientation signal
//                 (extraversion/agreeableness). MODERATE support.
//   PRICE       — willingness to pay a premium tracks openness/quality-seeking;
//                 low price tracks prudence. WEAK-MODERATE. Small weights.
//   NOVEL/CLASSIC wording — the clearest signal in the set: it is a direct
//                 variety-seeking vs familiarity choice, which is exactly what
//                 the novelty axis measures.
//
// None of these is deterministic. A person may drink black coffee because it
// is what the office has. That is why no single attribute can move a trait far
// (PRIOR_MASS shrinkage) and why the games ask many rounds.

const KEYWORDS = {
  bitter: ['قهوة', 'اسبريسو', 'إسبريسو', 'اسبرسو', 'امريكانو', 'أمريكانو', 'ريستريتو', 'مكياتو', 'ماكياتو', 'كورتادو', 'مر', 'مرّ', 'داكن', 'تحميص داكن', 'ماتشا', 'شاي أخضر', 'شاي اخضر', 'جريب فروت', 'توني', 'كاكاو خام', 'espresso', 'americano', 'ristretto', 'macchiato', 'cortado', 'dark', 'bitter', 'matcha', 'green tea', 'black coffee', 'tonic'],
  sweet: ['حلو', 'حلوة', 'سكر', 'كراميل', 'شوكولاتة', 'شوكولا', 'عسل', 'كيك', 'دونات', 'وايت موكا', 'موكا', 'فانيلا', 'فانيليا', 'مارشميلو', 'نوتيلا', 'لوتس', 'كنافة', 'بسبوسة', 'تشيز كيك', 'براوني', 'sweet', 'caramel', 'chocolate', 'honey', 'vanilla', 'cake', 'donut', 'brownie', 'syrup', 'mocha'],
  spicy: ['حار', 'حارة', 'حارّ', 'سبايسي', 'فلفل', 'شطة', 'هالبينو', 'جالبينو', 'مسالا', 'كاري', 'تندوري', 'بهارات', 'محوج', 'ناري', 'spicy', 'hot ', 'chili', 'chilli', 'jalapeno', 'curry', 'masala', 'tandoori', 'peri'],
  novel: ['جديد', 'جديدة', 'خاص', 'خاصة', 'موسمي', 'موسمية', 'تجربة', 'ابتكار', 'مبتكر', 'فيوجن', 'حصري', 'حصرية', 'محدود', 'محدودة', 'تجريبي', 'مزيج', 'خلطة', 'new', 'special', 'seasonal', 'limited', 'fusion', 'signature', 'twist', 'experimental'],
  classic: ['كلاسيك', 'كلاسيكي', 'كلاسيكية', 'سادة', 'عادي', 'عادية', 'تقليدي', 'تقليدية', 'أصلي', 'اصلي', 'شعبي', 'بلدي', 'المعتاد', 'classic', 'original', 'plain', 'regular', 'traditional', 'house', 'standard'],
  share: ['مشاركة', 'للمشاركة', 'عائلي', 'عائلية', 'بلاتر', 'وليمة', 'مقبلات', 'تشكيلة', 'صينية', 'بوكس', 'مزة', 'مشكل', 'كبير', 'sharing', 'platter', 'family', 'combo', 'tray', 'mezze', 'box', 'large'],
  ritual: ['في60', 'v60', 'كيمكس', 'chemex', 'سيفون', 'syphon', 'siphon', 'تقطير', 'مقطرة', 'بور اوفر', 'بورأوفر', 'pour over', 'pour-over', 'ايروبريس', 'aeropress', 'كولد برو', 'cold brew', 'فرنش برس', 'french press', 'تخمير', 'مختص', 'مختصة', 'specialty', 'slow', 'brew', 'نقيع'],
  quick: ['سريع', 'سريعة', 'تيك اواي', 'takeaway', 'take away', 'to go', 'express', 'اكسبرس', 'شوت', 'shot', 'quick', 'فوري'],
  health: ['دايت', 'خفيف', 'خفيفة', 'صحي', 'صحية', 'بدون سكر', 'قليل السكر', 'لايت', 'قليل الدسم', 'بروتين', 'كيتو', 'ديتوكس', 'أخضر', 'اخضر', 'طبيعي', 'diet', 'light', 'healthy', 'sugar free', 'sugar-free', 'keto', 'detox', 'protein', 'natural'],
  comfort: ['دسم', 'كريمي', 'مقلي', 'مقلية', 'جبن', 'جبنة', 'زبدة', 'دبل', 'مضاعف', 'كبير الحجم', 'creamy', 'fried', 'cheese', 'butter', 'double', 'loaded'],
}

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[ـ]/g, '')       // tatweel
  .replace(/[ً-ْ]/g, '') // harakat
  .replace(/[إأآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')

const normKeys = (list) => list.map(norm)
const KEYS_N = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [k, normKeys(v)]))

const hits = (text, key) => {
  const n = norm(text)
  if (!n) return 0
  let c = 0
  for (const k of KEYS_N[key]) if (k && n.includes(k)) c += 1
  return c
}

export function itemText(item, catName = '') {
  return [
    item?.nameAr, item?.nameEn, item?.descAr, item?.descEn, catName,
    ...(Array.isArray(item?.ingredients) ? item.ingredients.map((g) => `${g?.nameAr || ''} ${g?.nameEn || ''}`) : []),
  ].filter(Boolean).join(' ')
}

export function itemName(item, lang = 'ar') {
  const a = String(item?.nameAr || '').trim()
  const e = String(item?.nameEn || '').trim()
  return (lang === 'en' ? (e || a) : (a || e)) || ''
}

// Percentile position of `v` inside a sorted numeric list, 0..1. Returns null
// when there is nothing to compare against — the mapping then simply skips
// that attribute instead of inventing a position.
function pct(sorted, v) {
  if (!sorted.length || !Number.isFinite(v)) return null
  let below = 0
  for (const x of sorted) { if (x < v) below += 1 }
  return sorted.length > 1 ? below / (sorted.length - 1) : 0.5
}

const statsCache = new WeakMap()

// Menu-relative statistics, computed once per items array.
export function menuStats(allItems) {
  const arr = Array.isArray(allItems) ? allItems : []
  if (statsCache.has(arr)) return statsCache.get(arr)
  const prices = arr.map((i) => Number(i?.price)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const preps = arr.map((i) => Number(i?.prepTime)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const cals = arr.map((i) => Number(i?.calories)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const ings = arr.map((i) => (Array.isArray(i?.ingredients) ? i.ingredients.length : 0)).filter((n) => n > 0).sort((a, b) => a - b)
  const out = { prices, preps, cals, ings, n: arr.length }
  statsCache.set(arr, out)
  return out
}

// traitsFromItemChoice(item, allItems, opts) -> signed loadings
//
// CORRELATIONAL, NOT DETERMINISTIC. See the evidence notes above. Every value
// here says "people who choose this tend, on average, to score somewhat higher
// on X" — never "this person is X".
export function traitsFromItemChoice(item, allItems = [], opts = {}) {
  const out = {}
  if (!item) return out
  const add = (t, v) => { out[t] = (out[t] || 0) + v }
  const st = menuStats(allItems.length ? allItems : [item])
  const text = itemText(item, opts.categoryName || '')

  // --- taste / sensory signals -------------------------------------------
  const bitter = hits(text, 'bitter')
  if (bitter) { add('openness', Math.min(0.5, 0.3 * bitter)); add('novelty', Math.min(0.3, 0.18 * bitter)) }

  const spicy = hits(text, 'spicy')
  if (spicy) { add('novelty', Math.min(0.55, 0.34 * spicy)); add('openness', Math.min(0.4, 0.24 * spicy)); add('stability', 0.12) }

  // Deliberately small: the sweet/prosociality literature does not replicate
  // cleanly, so it may nudge a result but never decide one.
  const sweet = hits(text, 'sweet')
  if (sweet) { add('agreeableness', Math.min(0.22, 0.12 * sweet)); add('openness', -0.08) }

  // --- variety seeking ----------------------------------------------------
  const novel = hits(text, 'novel')
  if (novel) { add('novelty', Math.min(0.6, 0.36 * novel)); add('openness', Math.min(0.4, 0.22 * novel)) }

  const classic = hits(text, 'classic')
  if (classic) { add('novelty', -Math.min(0.6, 0.36 * classic)); add('conscientiousness', 0.1) }

  // A venue's featured/popular pick is the safe, socially-endorsed choice.
  if (item.featured) { add('novelty', -0.16); add('agreeableness', 0.08) }

  // --- pace / ritual ------------------------------------------------------
  const ritual = hits(text, 'ritual')
  if (ritual) { add('conscientiousness', 0.3); add('analysis', 0.24); add('openness', 0.18); add('extraversion', -0.1) }

  const quick = hits(text, 'quick')
  if (quick) { add('analysis', -0.2); add('extraversion', 0.1); add('conscientiousness', -0.08) }

  const prepP = pct(st.preps, Number(item.prepTime))
  if (prepP != null && st.preps.length >= 4) {
    // long prep chosen over short = willingness to wait
    add('conscientiousness', (prepP - 0.5) * 0.34)
    add('analysis', (prepP - 0.5) * 0.2)
  }

  // --- restraint / indulgence --------------------------------------------
  const health = hits(text, 'health')
  if (health) { add('conscientiousness', Math.min(0.45, 0.28 * health)); add('stability', 0.08) }

  const comfort = hits(text, 'comfort')
  if (comfort) { add('conscientiousness', -Math.min(0.3, 0.16 * comfort)); add('agreeableness', 0.06) }

  const calP = pct(st.cals, Number(item.calories))
  if (calP != null && st.cals.length >= 4) add('conscientiousness', -(calP - 0.5) * 0.26)

  // --- social orientation -------------------------------------------------
  const share = hits(text, 'share')
  const serves = Number(item.serves) || 0
  if (share || serves > 1) {
    const w = (share ? 0.28 : 0) + (serves > 1 ? 0.24 : 0)
    add('extraversion', Math.min(0.5, w)); add('agreeableness', Math.min(0.34, w * 0.7))
  }

  // --- complexity ---------------------------------------------------------
  const ingCount = Array.isArray(item.ingredients) ? item.ingredients.length : 0
  const ingP = pct(st.ings, ingCount)
  if (ingP != null && st.ings.length >= 4 && ingCount > 0) {
    add('openness', (ingP - 0.5) * 0.3)
    add('analysis', (ingP - 0.5) * 0.16)
  }
  const descLen = String(item.descAr || item.descEn || '').trim().length
  if (descLen > 90) add('openness', 0.1)

  // --- price positioning (weak signal, small weights) --------------------
  const priceP = pct(st.prices, Number(item.price))
  if (priceP != null && st.prices.length >= 4) {
    add('openness', (priceP - 0.5) * 0.2)
    add('analysis', (priceP - 0.5) * 0.12)
    add('conscientiousness', -(priceP - 0.5) * 0.14) // low price ~ prudence
  }

  // Drop noise so the loadings stay readable/auditable.
  for (const k of Object.keys(out)) {
    out[k] = Math.max(-1, Math.min(1, Math.round(out[k] * 1000) / 1000))
    if (Math.abs(out[k]) < 0.03) delete out[k]
  }
  return out
}

// How much personality signal an item carries at all.
export function itemSignalStrength(item, allItems, opts) {
  const l = traitsFromItemChoice(item, allItems, opts)
  return Object.values(l).reduce((s, v) => s + Math.abs(v), 0)
}

// ---------------------------------------------------------------------------
// EITHER/OR ROUND BUILDER (TasteProfile)
// ---------------------------------------------------------------------------
// A round is only useful when the two options pull in DIFFERENT directions.
// Pairs are chosen to maximise trait contrast, and each option's loadings are
// the item's loadings minus the pair's shared component — so "chose A over B"
// scores the DIFFERENCE, which is what a forced choice actually measures.

export const MIN_TASTE_ITEMS = 6

export function buildTastePairs(items, count = 9, opts = {}) {
  const pool = (Array.isArray(items) ? items : []).filter(
    (i) => i && (i.available !== false) && itemName(i, 'ar'),
  )
  if (pool.length < MIN_TASTE_ITEMS) return null

  const catName = opts.categoryName || (() => '')
  const enriched = pool.map((it) => ({
    item: it,
    loadings: traitsFromItemChoice(it, pool, { categoryName: typeof catName === 'function' ? catName(it) : catName }),
  }))
  // items that say nothing about anyone are useless in a forced choice
  const usable = enriched.filter((e) => Object.keys(e.loadings).length > 0)
  const bank = usable.length >= MIN_TASTE_ITEMS ? usable : enriched
  if (bank.length < 2) return null

  const contrast = (a, b) => {
    let d = 0
    for (const t of TRAIT_IDS) d += Math.abs((a.loadings[t] || 0) - (b.loadings[t] || 0))
    return d
  }

  const MIN_CONTRAST = 0.08
  const MIN_PAIRS = 4

  // Build a pair record, or null when the two items are effectively identical.
  const makePair = (i, j, c) => {
    const A = bank[i]
    const B = bank[j]
    // Difference loadings: what choosing A over B actually tells us. Standard
    // paired-comparison scoring — the evidence IS the gap between the two, and
    // the mirrored option carries the same magnitude in the opposite direction.
    const diff = {}
    for (const t of TRAIT_IDS) {
      const d = (A.loadings[t] || 0) - (B.loadings[t] || 0)
      if (Math.abs(d) >= 0.05) diff[t] = Math.round(d * 1000) / 1000
    }
    if (!Object.keys(diff).length) return null
    const neg = {}
    for (const [k, v] of Object.entries(diff)) neg[k] = -v
    return {
      id: `tp-${String(A.item.id || i)}-${String(B.item.id || j)}`,
      a: { item: A.item, loadings: diff },
      b: { item: B.item, loadings: neg },
      contrast: Math.round(c * 100) / 100,
    }
  }

  const pairs = []
  const usedPairKeys = new Set()
  const target = Math.max(MIN_PAIRS, Math.min(count, bank.length))

  // Phase 1 — highest-contrast pairs with NO item repeated. These are the
  // cleanest rounds, so they come first and while supply lasts nothing repeats.
  const spent = new Set()
  while (pairs.length < target) {
    let best = null
    for (let i = 0; i < bank.length; i++) {
      if (spent.has(i)) continue
      for (let j = i + 1; j < bank.length; j++) {
        if (spent.has(j)) continue
        const c = contrast(bank[i], bank[j])
        if (!best || c > best.c) best = { i, j, c }
      }
    }
    if (!best || best.c < MIN_CONTRAST) break
    spent.add(best.i); spent.add(best.j)
    const p = makePair(best.i, best.j, best.c)
    if (!p) continue
    usedPairKeys.add(`${best.i}:${best.j}`)
    pairs.push(p)
  }

  // Phase 2 — a small menu runs out of fresh items long before it runs out of
  // useful comparisons. Reusing an item against a NEW opponent is a different
  // question and legitimate paired-comparison design, so top up from the
  // remaining combinations, preferring the least-used items to keep the rounds
  // from feeling like the same item over and over.
  if (pairs.length < target) {
    const uses = new Array(bank.length).fill(0)
    for (const key of usedPairKeys) {
      const [i, j] = key.split(':').map(Number)
      uses[i] += 1; uses[j] += 1
    }
    const combos = []
    for (let i = 0; i < bank.length; i++) {
      for (let j = i + 1; j < bank.length; j++) {
        if (usedPairKeys.has(`${i}:${j}`)) continue
        const c = contrast(bank[i], bank[j])
        if (c >= MIN_CONTRAST) combos.push({ i, j, c })
      }
    }
    while (pairs.length < target && combos.length) {
      combos.sort((x, y) => (uses[x.i] + uses[x.j]) - (uses[y.i] + uses[y.j]) || y.c - x.c)
      const next = combos.shift()
      const p = makePair(next.i, next.j, next.c)
      if (!p) continue
      uses[next.i] += 1; uses[next.j] += 1
      usedPairKeys.add(`${next.i}:${next.j}`)
      pairs.push(p)
    }
  }

  if (pairs.length < MIN_PAIRS) return null
  // strongest contrast first feels decisive early, then nuance
  return pairs.sort((x, y) => y.contrast - x.contrast)
}

// ---------------------------------------------------------------------------
// MIND MIRROR — the 12-question adaptive bank
// ---------------------------------------------------------------------------
// Items are concrete SITUATIONS, not adjective self-ratings: situational
// judgement items resist self-flattery better than "are you organised?".
//
//   core     — always asked, one anchor per axis
//   when(p)  — gate on the profile so far (this is the branching)
//   options  — each carries signed loadings
//
// Adaptive selection maximises information: after the core, the next question
// is the unasked, eligible one whose loadings sit on the traits we are least
// sure about. Deterministic, so a resumed session continues identically.

export const MIND_MIRROR_BANK = [
  {
    id: 'mm-new-place', core: true,
    text: 'فتح مكان جديد قرب بيتك ولا تعرف أحداً جرّبه بعد.',
    options: [
      { key: 'a', label: 'أذهب في أول أسبوع — أحب أن أكوّن رأيي بنفسي.', loadings: { novelty: 0.85, openness: 0.5, analysis: -0.15 } },
      { key: 'b', label: 'أنتظر حتى أسمع رأي أحد أثق به.', loadings: { novelty: -0.3, analysis: 0.35, agreeableness: 0.2 } },
      { key: 'c', label: 'أبقى على مكاني المعتاد؛ لا أرى سبباً للتغيير.', loadings: { novelty: -0.85, openness: -0.35, conscientiousness: 0.2 } },
    ],
  },
  {
    id: 'mm-appointment', core: true,
    text: 'أمامك موعد مهم بعد ساعة، والطريق معروف لك.',
    options: [
      { key: 'a', label: 'أصل قبل الموعد بوقت، وأنتظر مرتاحاً.', loadings: { conscientiousness: 0.85, stability: 0.25 } },
      { key: 'b', label: 'أحسبها بدقة لأصل في وقتي تماماً.', loadings: { conscientiousness: 0.3, analysis: 0.4 } },
      { key: 'c', label: 'أخرج في آخر لحظة، وغالباً أصل متأخراً قليلاً.', loadings: { conscientiousness: -0.8, novelty: 0.15 } },
    ],
  },
  {
    id: 'mm-free-night', core: true,
    text: 'انتهى أسبوع طويل، وأمامك ليلة فارغة تماماً.',
    options: [
      { key: 'a', label: 'أخرج مع مجموعة — الناس يعيدون لي طاقتي.', loadings: { extraversion: 0.85, novelty: 0.2 } },
      { key: 'b', label: 'ألتقي صديقاً واحداً في مكان هادئ.', loadings: { extraversion: 0.15, agreeableness: 0.3 } },
      { key: 'c', label: 'أبقى وحدي، وهذا بالضبط ما أحتاجه.', loadings: { extraversion: -0.85, openness: 0.1 } },
    ],
  },
  {
    id: 'mm-colleague', core: true,
    text: 'زميل أخطأ في عمل مشترك، وسيُسأل عنه أمام الجميع.',
    options: [
      { key: 'a', label: 'أوضّح ما حصل كما هو؛ الحقيقة أهم من الحرج.', loadings: { agreeableness: -0.7, analysis: 0.25 } },
      { key: 'b', label: 'أخفّف الأمر عليه قدر ما أستطيع.', loadings: { agreeableness: 0.75, extraversion: 0.1 } },
      { key: 'c', label: 'أتحدث معه على انفراد أولاً، ثم نقرر معاً.', loadings: { agreeableness: 0.4, conscientiousness: 0.35, analysis: 0.2 } },
    ],
  },
  {
    id: 'mm-late-message', core: true,
    text: 'وصلتك ليلاً رسالة عمل نصّها: «نحتاج أن نتكلم غداً».',
    options: [
      { key: 'a', label: 'أنام عادي؛ غداً سأعرف.', loadings: { stability: 0.85 } },
      { key: 'b', label: 'أفكر فيها قليلاً ثم أنام.', loadings: { stability: 0.15 } },
      { key: 'c', label: 'أبقى مستيقظاً أعيد قراءتها وأتخيّل السيناريوهات.', loadings: { stability: -0.85, analysis: 0.2 } },
    ],
  },
  {
    id: 'mm-buying', core: true,
    text: 'قررت شراء جهاز جديد، والخيارات أمامك كثيرة.',
    options: [
      { key: 'a', label: 'أفتح مقارنة تفصيلية بين الخيارات قبل أن أقرر.', loadings: { analysis: 0.85, conscientiousness: 0.3 } },
      { key: 'b', label: 'أسأل شخصاً أثق برأيه وأمشي على كلامه.', loadings: { analysis: -0.2, agreeableness: 0.4, extraversion: 0.15 } },
      { key: 'c', label: 'أختار ما ارتحت له، ولا أطيل.', loadings: { analysis: -0.85, novelty: 0.2 } },
    ],
  },

  // --- adaptive pool -----------------------------------------------------
  {
    id: 'mm-museum',
    text: 'أنت في معرض أو متحف مع وقت مفتوح.',
    options: [
      { key: 'a', label: 'أقف طويلاً أمام عمل واحد يشدّني.', loadings: { openness: 0.75, extraversion: -0.2 } },
      { key: 'b', label: 'أمرّ على كل شيء بسرعة لأرى الصورة كاملة.', loadings: { openness: 0.2, novelty: 0.35, conscientiousness: -0.1 } },
      { key: 'c', label: 'بصراحة، ليست تجربتي المفضلة.', loadings: { openness: -0.7 } },
    ],
  },
  {
    id: 'mm-unknown-dish',
    text: 'أمامك صنف لا تعرف مكوّناته ولا اسمه واضح.',
    options: [
      { key: 'a', label: 'أطلبه بلا أسئلة — هذه متعة التجربة.', loadings: { novelty: 0.8, openness: 0.4, analysis: -0.35 } },
      { key: 'b', label: 'أسأل عنه بالتفصيل ثم أقرر.', loadings: { analysis: 0.7, openness: 0.2 } },
      { key: 'c', label: 'أتركه وأطلب ما أعرفه.', loadings: { novelty: -0.75, conscientiousness: 0.15 } },
    ],
  },
  {
    id: 'mm-party',
    when: (p) => (p.extraversion ?? 0.5) >= 0.42,
    text: 'في مناسبة لا تعرف فيها إلا شخصاً واحداً، وقد انشغل عنك.',
    options: [
      { key: 'a', label: 'أعرّف بنفسي على أقرب مجموعة.', loadings: { extraversion: 0.8, stability: 0.25 } },
      { key: 'b', label: 'أنتظر حتى يبدأ أحد الحديث معي.', loadings: { extraversion: -0.4, agreeableness: 0.2 } },
      { key: 'c', label: 'أنشغل بجوالي حتى يعود صاحبي.', loadings: { extraversion: -0.7, stability: -0.2 } },
    ],
  },
  {
    id: 'mm-recharge',
    when: (p) => (p.extraversion ?? 0.5) <= 0.62,
    text: 'انتهى يوم مليء بالاجتماعات والناس.',
    options: [
      { key: 'a', label: 'أخرج مباشرة؛ ما زال عندي طاقة.', loadings: { extraversion: 0.75, stability: 0.2 } },
      { key: 'b', label: 'أحتاج ساعة صمت ثم أكون بخير.', loadings: { extraversion: -0.5 } },
      { key: 'c', label: 'أُلغي أي شيء آخر في ذلك اليوم.', loadings: { extraversion: -0.8, stability: -0.15 } },
    ],
  },
  {
    id: 'mm-trip',
    text: 'رحلة نهاية أسبوع مع أصدقاء، وأنت من سيخطط.',
    options: [
      { key: 'a', label: 'جدول بالساعة، وبديل لكل احتمال.', loadings: { conscientiousness: 0.8, analysis: 0.4, novelty: -0.2 } },
      { key: 'b', label: 'خطوط عريضة فقط، والباقي على الوضع.', loadings: { conscientiousness: 0.15, openness: 0.2 } },
      { key: 'c', label: 'نركب ونقرر في الطريق.', loadings: { conscientiousness: -0.75, novelty: 0.5 } },
    ],
  },
  {
    id: 'mm-queue',
    text: 'شخص تجاوز الطابور أمامك بوضوح.',
    options: [
      { key: 'a', label: 'أنبّهه مباشرة.', loadings: { agreeableness: -0.6, extraversion: 0.3, stability: 0.2 } },
      { key: 'b', label: 'أتضايق لكني لا أتكلم.', loadings: { agreeableness: 0.3, stability: -0.35, extraversion: -0.2 } },
      { key: 'c', label: 'أتجاهل الأمر؛ لا يستحق.', loadings: { agreeableness: 0.35, stability: 0.45 } },
    ],
  },
  {
    // Complementary branch with mm-waiting below: whoever reads as
    // anxious-leaning gets the mistake probe, steady-leaning gets the waiting
    // probe. Mutually exclusive gates, so both items stay reachable.
    id: 'mm-mistake',
    when: (p) => (p.stability ?? 0.5) <= 0.55,
    text: 'أخطأت خطأً واضحاً رآه من حولك.',
    options: [
      { key: 'a', label: 'أعتذر، أصلحه، وأنساه في نفس اليوم.', loadings: { stability: 0.8, conscientiousness: 0.3 } },
      { key: 'b', label: 'أصلحه، لكنه يبقى في بالي أياماً.', loadings: { stability: -0.6, conscientiousness: 0.25 } },
      { key: 'c', label: 'أفكر مطوّلاً كيف بدوت أمامهم.', loadings: { stability: -0.8, extraversion: -0.15 } },
    ],
  },
  {
    id: 'mm-after-decision',
    text: 'اتخذت قراراً كبيراً وانتهى الأمر.',
    options: [
      { key: 'a', label: 'أراجع أحياناً ماذا لو اخترت غيره.', loadings: { analysis: 0.6, stability: -0.35 } },
      { key: 'b', label: 'أمضي ولا ألتفت.', loadings: { analysis: -0.5, stability: 0.6 } },
      { key: 'c', label: 'أراجع مرة واحدة لأتعلّم، ثم أُغلق الملف.', loadings: { analysis: 0.35, conscientiousness: 0.4, stability: 0.3 } },
    ],
  },
  {
    id: 'mm-daily',
    when: (p) => (p.novelty ?? 0.5) >= 0.3,
    text: 'طلبك اليومي المعتاد — منذ متى وهو نفسه؟',
    options: [
      { key: 'a', label: 'نفسه منذ سنوات، ولا أنوي تغييره.', loadings: { novelty: -0.8, conscientiousness: 0.3 } },
      { key: 'b', label: 'أغيّره كل فترة حين أملّ.', loadings: { novelty: 0.35 } },
      { key: 'c', label: 'ليس عندي طلب معتاد أصلاً.', loadings: { novelty: 0.8, openness: 0.3, conscientiousness: -0.2 } },
    ],
  },
  {
    id: 'mm-favor',
    text: 'صديق طلب منك خدمة، ووقتها سيّئ جداً بالنسبة لك.',
    options: [
      { key: 'a', label: 'أعتذر بوضوح وأشرح ظرفي.', loadings: { agreeableness: -0.45, stability: 0.3, conscientiousness: 0.2 } },
      { key: 'b', label: 'أوافق وأتدبّر أمري.', loadings: { agreeableness: 0.8, conscientiousness: -0.1 } },
      { key: 'c', label: 'أوافق جزئياً وأقترح وقتاً آخر.', loadings: { agreeableness: 0.35, analysis: 0.35, conscientiousness: 0.3 } },
    ],
  },
  {
    id: 'mm-opposing-idea',
    text: 'سمعت فكرة تخالف قناعة راسخة عندك، وصاحبها يبدو جاداً.',
    options: [
      { key: 'a', label: 'أستمع بفضول حقيقي؛ ربما عندي ما أراجعه.', loadings: { openness: 0.8, agreeableness: 0.25 } },
      { key: 'b', label: 'أستمع، لكن غالباً سأعود لقناعتي.', loadings: { openness: -0.1, conscientiousness: 0.15 } },
      { key: 'c', label: 'أردّ عليها فوراً بما أعرف.', loadings: { openness: -0.5, agreeableness: -0.4, extraversion: 0.25 } },
    ],
  },
  {
    id: 'mm-side-project',
    when: (p) => (p.conscientiousness ?? 0.5) <= 0.72,
    text: 'مشروع شخصي بدأته بحماس قبل شهرين.',
    options: [
      { key: 'a', label: 'أكملته، أو ما زلت أعمل عليه بانتظام.', loadings: { conscientiousness: 0.8 } },
      { key: 'b', label: 'توقّف، لكني أنوي العودة إليه.', loadings: { conscientiousness: -0.4, novelty: 0.25 } },
      { key: 'c', label: 'انتقلت لفكرة أخرى أحلى.', loadings: { conscientiousness: -0.75, novelty: 0.6, openness: 0.3 } },
    ],
  },
  {
    id: 'mm-waiting',
    when: (p) => (p.stability ?? 0.5) > 0.55, // see mm-mistake
    text: 'تنتظر نتيجة مهمة، وموعد إعلانها بعد ثلاثة أيام.',
    options: [
      { key: 'a', label: 'أنشغل بشيء آخر تماماً.', loadings: { stability: 0.7, conscientiousness: 0.2 } },
      { key: 'b', label: 'أتابع أي مؤشر قد يوصلني للجواب أبكر.', loadings: { stability: -0.4, analysis: 0.5 } },
      { key: 'c', label: 'أفكر فيها يومياً، وأتوقع الأسوأ استعداداً.', loadings: { stability: -0.8 } },
    ],
  },
  {
    id: 'mm-gut-vs-numbers',
    text: 'الأرقام تقول شيئاً، وإحساسك يقول عكسه تماماً.',
    options: [
      { key: 'a', label: 'أمشي مع الأرقام؛ الإحساس يخدع.', loadings: { analysis: 0.8, stability: 0.2 } },
      { key: 'b', label: 'أمشي مع إحساسي؛ نادراً ما خذلني.', loadings: { analysis: -0.8, novelty: 0.25 } },
      { key: 'c', label: 'أؤجّل القرار حتى يتفقا أو يظهر جديد.', loadings: { analysis: 0.3, conscientiousness: 0.35, stability: -0.2 } },
    ],
  },
  {
    id: 'mm-compliment',
    text: 'مدحك أحدهم أمام مجموعة على عمل تفخر به.',
    options: [
      { key: 'a', label: 'أشكره وأكمل الحديث بارتياح.', loadings: { extraversion: 0.5, stability: 0.5 } },
      { key: 'b', label: 'أحوّل الفضل لغيري بسرعة.', loadings: { agreeableness: 0.6, extraversion: -0.25 } },
      { key: 'c', label: 'أرتبك قليلاً وأغيّر الموضوع.', loadings: { extraversion: -0.55, stability: -0.35 } },
    ],
  },
]

export const MIND_MIRROR_LENGTH = 12

const bankById = Object.fromEntries(MIND_MIRROR_BANK.map((q) => [q.id, q]))
export const mindMirrorQuestion = (id) => bankById[id] || null

// The next question given what has been answered so far.
// `answered` = [{ id, key }]. Returns null when the run is complete.
export function mindMirrorNext(input = []) {
  const answered = Array.isArray(input) ? input : []
  const askedIds = new Set(answered.map((a) => a?.id))
  if (askedIds.size >= MIND_MIRROR_LENGTH) return null

  // Core anchors first, in order.
  const core = MIND_MIRROR_BANK.filter((q) => q.core && !askedIds.has(q.id))
  if (core.length) return core[0]

  const profile = scoreProfile(answersToLoadings(answered))
  const eligible = MIND_MIRROR_BANK.filter(
    (q) => !askedIds.has(q.id) && (typeof q.when !== 'function' || q.when(profile.traits)),
  )
  if (!eligible.length) return null

  // Maximum-information pick: favour questions loading on the least-certain
  // traits. Deterministic (ties break by bank order) so resume is exact.
  let best = null
  for (const q of eligible) {
    let info = 0
    for (const opt of q.options) {
      for (const [t, l] of Object.entries(opt.loadings || {})) {
        if (!TRAIT_IDS.includes(t)) continue
        info += Math.abs(l) * (1 - (profile.traitConfidence[t] ?? 0))
      }
    }
    info /= Math.max(1, q.options.length)
    if (!best || info > best.info + 1e-9) best = { q, info }
  }
  return best ? best.q : eligible[0]
}

// Turn [{id,key}] into the loading objects scoreProfile expects.
export function answersToLoadings(answered = []) {
  const out = []
  for (const a of (Array.isArray(answered) ? answered : [])) {
    const q = bankById[a?.id]
    if (!q) continue
    const opt = q.options.find((o) => o.key === a.key)
    if (opt) out.push(opt.loadings)
  }
  return out
}

// ---------------------------------------------------------------------------
// DECISION STYLE — 8 scenarios
// ---------------------------------------------------------------------------

export const DECISION_SCENARIOS = [
  {
    id: 'ds-menu',
    text: 'دخلت مكاناً لأول مرة و{menu} أمامك طويلة.',
    options: [
      { key: 'a', label: 'أقرأها كاملة ثم أقارن بين اثنين قبل أن أطلب.', loadings: { analysis: 0.8, conscientiousness: 0.25 } },
      { key: 'b', label: 'أسأل من يعمل هنا: ما الأفضل عندكم؟', loadings: { agreeableness: 0.45, extraversion: 0.4, analysis: -0.15 } },
      { key: 'c', label: 'أختار أول ما يلفتني وأغلقها.', loadings: { analysis: -0.8, novelty: 0.3 } },
    ],
  },
  {
    id: 'ds-offer',
    text: 'عرض عمل جيد، لكن أمامك يومان فقط للرد.',
    options: [
      { key: 'a', label: 'أكتب قائمة مكاسب وخسائر وأزنها.', loadings: { analysis: 0.85, conscientiousness: 0.35 } },
      { key: 'b', label: 'أستشير من مرّ بتجربة مشابهة.', loadings: { agreeableness: 0.5, analysis: 0.2, extraversion: 0.25 } },
      { key: 'c', label: 'أعرف من اليوم الأول إن كان يناسبني.', loadings: { analysis: -0.75, stability: 0.35 } },
    ],
  },
  {
    id: 'ds-plan-break',
    text: 'خطتك انهارت قبل ساعة من التنفيذ.',
    options: [
      { key: 'a', label: 'أفتح الخطة البديلة التي جهّزتها.', loadings: { conscientiousness: 0.8, stability: 0.4, analysis: 0.3 } },
      { key: 'b', label: 'أرتجل حلاً جديداً في اللحظة.', loadings: { novelty: 0.6, analysis: -0.5, stability: 0.3 } },
      { key: 'c', label: 'أؤجّل كل شيء وأعيد الترتيب بهدوء.', loadings: { conscientiousness: 0.35, novelty: -0.4, stability: -0.2 } },
    ],
  },
  {
    id: 'ds-two-goods',
    text: 'خياران أمامك، وكلاهما جيد فعلاً ولا فرق واضح.',
    options: [
      { key: 'a', label: 'أبحث عن معيار إضافي يفصل بينهما.', loadings: { analysis: 0.75, conscientiousness: 0.2 } },
      { key: 'b', label: 'أختار أحدهما فوراً؛ الفرق لا يستحق.', loadings: { analysis: -0.6, stability: 0.5 } },
      { key: 'c', label: 'أميل لما جرّبته من قبل.', loadings: { novelty: -0.7, analysis: -0.1 } },
    ],
  },
  {
    id: 'ds-risk',
    text: 'فرصة مربحة لكن نتيجتها غير مضمونة.',
    options: [
      { key: 'a', label: 'أدخل بجزء صغير أختبر به.', loadings: { analysis: 0.6, conscientiousness: 0.4, novelty: 0.25 } },
      { key: 'b', label: 'أدخل بثقة؛ الفرص لا تتكرر.', loadings: { novelty: 0.8, analysis: -0.4, stability: 0.3 } },
      { key: 'c', label: 'أتركها؛ راحتي أهم.', loadings: { novelty: -0.75, stability: 0.2, conscientiousness: 0.15 } },
    ],
  },
  {
    id: 'ds-group',
    text: 'مجموعتك تريد وجهة، وأنت غير مقتنع بها.',
    options: [
      { key: 'a', label: 'أقول رأيي بوضوح وأقترح بديلاً.', loadings: { agreeableness: -0.55, extraversion: 0.35, analysis: 0.2 } },
      { key: 'b', label: 'أمشي معهم؛ الاجتماع أهم من الوجهة.', loadings: { agreeableness: 0.8 } },
      { key: 'c', label: 'أسأل عن سببهم أولاً، وقد أقتنع.', loadings: { analysis: 0.5, agreeableness: 0.35, openness: 0.3 } },
    ],
  },
  {
    id: 'ds-info',
    text: 'تحتاج معلومة واحدة ناقصة لتحسم قراراً، والحصول عليها يأخذ أسبوعاً.',
    options: [
      { key: 'a', label: 'أنتظر الأسبوع؛ القرار يستحق.', loadings: { analysis: 0.7, conscientiousness: 0.45, novelty: -0.2 } },
      { key: 'b', label: 'أقرر بما لديّ وأعدّل لاحقاً إن لزم.', loadings: { analysis: -0.5, stability: 0.5, novelty: 0.3 } },
      { key: 'c', label: 'أبحث عن بديل تقريبي للمعلومة اليوم.', loadings: { analysis: 0.4, openness: 0.4, conscientiousness: 0.2 } },
    ],
  },
  {
    id: 'ds-regret',
    text: 'بعد أسبوع من قرار اتخذته، ظهر أن البديل كان أفضل قليلاً.',
    options: [
      { key: 'a', label: 'أراجع كيف فاتني ذلك، وأدوّن الدرس.', loadings: { analysis: 0.6, conscientiousness: 0.5 } },
      { key: 'b', label: 'أتقبّلها؛ قررت بما كان متاحاً.', loadings: { stability: 0.8, analysis: 0.1 } },
      { key: 'c', label: 'تبقى تزعجني كلما تذكرتها.', loadings: { stability: -0.8, analysis: 0.25 } },
    ],
  },
]

const dsById = Object.fromEntries(DECISION_SCENARIOS.map((s) => [s.id, s]))

export function decisionAnswersToLoadings(answered = []) {
  const out = []
  for (const a of (Array.isArray(answered) ? answered : [])) {
    const s = dsById[a?.id]
    if (!s) continue
    const opt = s.options.find((o) => o.key === a.key)
    if (opt) out.push(opt.loadings)
  }
  return out
}

// Six decision styles. Assigned from the profile's decision-relevant traits.
export const DECISION_STYLES = [
  {
    id: 'thorough',
    ar: 'المُحلّل الشامل',
    match: (t) => t.analysis >= 0.62 && t.conscientiousness >= 0.5,
    portrait: 'تجمع المعلومات حتى تشعر أن الصورة اكتملت، ثم تقرر مرة واحدة وبثقة. قراراتك متينة، وتُبنى لتصمد.',
    strengths: ['قلّة الأخطاء التي كان يمكن تجنّبها', 'قرارك مبرَّر ويمكنك الدفاع عنه', 'الآخرون يستندون إلى تحليلك'],
    watchOut: 'ليست كل القرارات بحجم واحد. حدّد سقفاً زمنياً للقرارات الصغيرة قبل أن تبدأ، لا بعد أن تغرق فيها.',
    takeaway: 'قسّم قراراتك إلى «تستحق البحث» و«تستحق دقيقتين». الفرق بينهما يوفّر عليك ساعات كل أسبوع.',
  },
  {
    id: 'decisive',
    ar: 'الحاسم السريع',
    match: (t) => t.analysis <= 0.4 && t.stability >= 0.52,
    portrait: 'تقرأ الموقف بسرعة وتحسم. لا يرهقك التردد، ونادراً ما تعود تلوم نفسك — وهذا يمنحك حركة لا يملكها المترددون.',
    strengths: ['سرعة في اقتناص الفرص', 'لا تُصاب بشلل الخيارات', 'ثباتك بعد القرار يريح من معك'],
    watchOut: 'السرعة ممتازة فيما تمرّست فيه، وأضعف في القرار النادر الكبير. هناك بالذات، أعطِ نفسك ليلة واحدة.',
    takeaway: 'قاعدة بسيطة: إن كان القرار قابلاً للتراجع، احسمه فوراً. وإن كان غير قابل للتراجع، نم عليه ليلة.',
  },
  {
    id: 'seeker',
    ar: 'الباحث عن الأمان',
    match: (t) => t.novelty <= 0.4 && t.conscientiousness >= 0.5,
    portrait: 'تختار المضمون على الواعد، وتفضّل مكسباً أكيداً صغيراً على احتمال كبير. هذا ليس تردداً، هو حساب مخاطر حقيقي.',
    strengths: ['قلّة الخسائر المفاجئة', 'استقرار من حولك يعتمدون عليه', 'تتوقع ما قد يسوء قبل أن يسوء'],
    watchOut: 'تجنّب المخاطرة له كلفة لا تظهر في الحساب: الفرص التي لم تدخلها. اجعل لنفسك حصة صغيرة مخصصة للتجربة.',
    takeaway: 'خصّص نسبة صغيرة ثابتة (من وقتك أو مالك) للتجارب غير المضمونة. الخسارة محدودة سلفاً، والمكسب مفتوح.',
  },
  {
    id: 'consultant',
    ar: 'المُستشير',
    match: (t) => t.agreeableness >= 0.62 && t.extraversion >= 0.45,
    portrait: 'تفكر بصوت عالٍ ومع الناس. الاستشارة عندك ليست ضعفاً بل طريقة تفكير — الكلام يوضّح لك ما لم يكن واضحاً في رأسك.',
    strengths: ['تستفيد من خبرة غيرك بدل تكرار أخطائهم', 'قراراتك مدعومة ممن حولك', 'تكتشف الزوايا التي لم ترها'],
    watchOut: 'كثرة الآراء تُميّع القرار أحياناً. حدّد قبل أن تبدأ من هم الاثنان أو الثلاثة الذين ستستشيرهم فعلاً.',
    takeaway: 'استشر ثلاثة كحد أقصى، وكن أنت آخر من يتكلم. الرأي الرابع يضيف حيرة لا معلومة.',
  },
  {
    id: 'experimenter',
    ar: 'المُجرِّب',
    match: (t) => t.novelty >= 0.62 && t.analysis <= 0.5,
    portrait: 'تتعلم بالتجربة لا بالقراءة عنها. تدخل مبكراً، تعدّل وأنت داخل الموقف، وتجمع خبرة عملية أسرع من غيرك.',
    strengths: ['تتعلم أسرع لأنك تجرّب فعلاً', 'لا تخاف من المحاولة الأولى', 'تكتشف ما لا تظهره المقارنات'],
    watchOut: 'التجريب رخيص في الأشياء الصغيرة وغالٍ في الكبيرة. اجعل التجربة الأولى دائماً بأصغر حجم ممكن.',
    takeaway: 'قبل أي تجربة اسأل: ما أسوأ ما قد يحدث، وهل أستطيع تحمّله؟ إن كانت الإجابة نعم، جرّب فوراً.',
  },
  {
    id: 'balanced',
    ar: 'المُوازن',
    match: () => true,
    portrait: 'تقيس حجم القرار أولاً، ثم تختار أسلوبك: تسرع حين لا يستحق التأني، وتتأنى حين يستحق. أسلوبك ليس ثابتاً — وهذا مقصود.',
    strengths: ['تناسب المواقف المختلفة', 'قلّة الندم في الاتجاهين', 'يسهل التعاون معك في أي فريق'],
    watchOut: 'المرونة قد تخفي غياب تفضيل واضح. في القرارات المشتركة، أعلن ما تريده أنت لا ما هو معقول فقط.',
    takeaway: 'اكتب قبل كل قرار مهم سطراً واحداً: ما الذي أريده أنا هنا؟ ثم قرر. هذا وحده يرفع جودة قراراتك.',
  },
]

export function decisionStyle(profile) {
  const t = profile?.traits || {}
  const filled = {}
  for (const id of TRAIT_IDS) filled[id] = t[id] ?? 0.5
  return DECISION_STYLES.find((s) => s.match(filled)) || DECISION_STYLES[DECISION_STYLES.length - 1]
}

// ---------------------------------------------------------------------------
// RECOMMENDATIONS
// ---------------------------------------------------------------------------
// Same trait maths as the profiling, run in reverse: an item matches when its
// loadings point the same way as the guest's deviations from the middle.

// Two phrasings per trait/pole. Both say the SAME true thing about the same
// trait — the second exists only so two recommendations driven by the same
// trait do not print the identical sentence and read as a template.
// Deliberately worded without asserting what KIND of thing the item is (no
// «مشروب»/«طبق» here): the reason describes the relationship to the guest.
const REASON = {
  novelty: {
    high: [
      'لأنك تميل إلى تجربة ما لم تجرّبه — وهذا من أبعد الخيارات عن المألوف هنا.',
      'لأن الجديد يجذبك أكثر من المضمون، وهذا ليس الخيار المتوقع.',
    ],
    low: [
      'لأنك ترتاح للمضمون، وهذا خيار لا يفاجئك.',
      'لأنه من الخيارات المستقرة التي تعرف ما ستحصل عليه منها.',
    ],
  },
  // Wording is deliberately sensory-NEUTRAL («طابعه» not «مذاقه»): the same
  // sentence has to be true in a cafe, a grill house and a perfumery.
  openness: {
    high: [
      'لأن طابعه مركّب ولا يكشف نفسه من أول مرة، وهذا ما يمتعك.',
      'لأن فيه طبقات وتفاصيل، وأنت تلاحظها.',
    ],
    low: ['لأنه واضح ومباشر بلا تعقيد.', 'لأنه صريح لا يحتاج منك أن تحلّله.'],
  },
  conscientiousness: {
    high: [
      'لأنه يكافئ من لا يستعجل، وأنت تعطي الأشياء وقتها.',
      'لأنه مصنوع على مهل، وهذا يناسب من يقدّر الطقس.',
    ],
    low: ['لأنه سهل ومباشر بلا مقدمات.', 'لأنه لا يطلب منك انتظاراً ولا ترتيباً.'],
  },
  extraversion: {
    high: [
      'لأنه يُشارَك مع من معك، وأنت تستمتع بما يُقسَم.',
      'لأنه يفتح حديثاً مع من حولك أكثر مما يخصّك وحدك.',
    ],
    low: [
      'لأنه {item} لك وحدك، يناسب لحظة هادئة.',
      'لأنه يناسب وقتك الخاص أكثر من المناسبة الجماعية.',
    ],
  },
  agreeableness: {
    high: [
      'لأنه من النوع الدافئ الذي يسهل أن تحبه ويسهل أن تشاركه.',
      'لأن طابعه لطيف ولا يفرض نفسه.',
    ],
    low: ['لأن طابعه صريح لا يجامل الذوق.', 'لأنه حاد الطابع، ولا يحاول إرضاء الجميع.'],
  },
  analysis: {
    high: [
      'لأن مكوّناته معلنة وتعرف بالضبط ماذا ستحصل عليه.',
      'لأنه قابل للمقارنة: تفاصيله واضحة أمامك.',
    ],
    low: ['لأنه يُختار بالإحساس لا بالمقارنة.', 'لأنه من النوع الذي تعرف أنك تريده قبل أن تفكر فيه.'],
  },
  stability: {
    high: ['لأنه من الخيارات الجريئة في {menu}.', 'لأنه يحتاج قليلاً من الجرأة، وأنت لا تنقصك.'],
    low: ['لأنه خيار مريح لا يتطلب منك شيئاً.', 'لأنه هادئ ولا يضعك أمام مفاجأة.'],
  },
}

// recommendItems(profile, items, tenant, opts)
//   -> [{ item, name, score, reason, loadings }]
export function recommendItems(profile, items, tenant = null, opts = {}) {
  const limit = opts.limit || 3
  const lang = opts.lang || 'ar'
  const pool = (Array.isArray(items) ? items : []).filter(
    (i) => i && i.available !== false && itemName(i, lang),
  )
  if (!pool.length || !profile?.traits) return []

  const dev = {}
  for (const t of TRAIT_IDS) dev[t] = ((profile.traits[t] ?? 0.5) - 0.5) * 2 // -1..1

  const scored = pool.map((item) => {
    const loadings = traitsFromItemChoice(item, pool, opts)
    let dot = 0
    let mag = 0
    const contribs = []
    for (const t of TRAIT_IDS) {
      const l = loadings[t] || 0
      if (!l) continue
      const c = l * dev[t] * (0.4 + 0.6 * (profile.traitConfidence?.[t] ?? 0.5))
      dot += c
      mag += Math.abs(l)
      if (c > 0) contribs.push({ trait: t, c })
    }
    contribs.sort((a, b) => b.c - a.c)
    const score = mag ? dot / Math.sqrt(mag) : 0
    return { item, loadings, score, contribs, bestTrait: contribs[0]?.trait || null, name: itemName(item, lang) }
  })

  // Excluding anything the guest just rejected keeps recommendations honest.
  const skip = new Set((opts.excludeIds || []).map(String))
  const ranked = scored
    .filter((s) => !skip.has(String(s.item.id)) && s.score > 0)
    .sort((a, b) => b.score - a.score)

  // Prefer items we can say something SPECIFIC about. An item that only scores
  // through percentile nudges would get the generic line, and a reveal full of
  // generic lines is worse than a shorter, sharper list.
  const REASONABLE = 0.15
  const speakable = ranked.filter((s) => (s.contribs || []).some(
    (c) => Math.abs(s.loadings[c.trait] || 0) >= REASONABLE,
  ))
  const quiet = ranked.filter((s) => !speakable.includes(s))

  // Diversify by driving trait: three recommendations that all say the same
  // sentence read as a template, which cheapens the whole reveal. Best item per
  // distinct trait first, then backfill by raw score.
  const chosen = []
  const usedTraits = new Set()
  for (const s of speakable) {
    if (chosen.length >= limit) break
    if (s.bestTrait && usedTraits.has(s.bestTrait)) continue
    if (s.bestTrait) usedTraits.add(s.bestTrait)
    chosen.push(s)
  }
  for (const s of [...speakable, ...quiet]) {
    if (chosen.length >= limit) break
    if (!chosen.includes(s)) chosen.push(s)
  }

  // A backfilled item may share its top trait with one already shown, so the
  // REASON is picked from its highest contributing trait not yet spoken for.
  // Every reason still comes from that item's own trait maths — we only choose
  // which true thing to say, never invent one.
  // A reason may only be stated from a trait the item carries a REAL signal on.
  // Percentile nudges (price, calories) are intentionally tiny, and turning a
  // 0.07 price loading into a confident sentence about someone would be
  // over-claiming — so those items get the mild generic line instead.
  const MIN_REASON_SIGNAL = 0.15
  const spoken = new Set()
  return chosen.map((s) => {
    const strong = (s.contribs || []).filter(
      (c) => Math.abs(s.loadings[c.trait] || 0) >= MIN_REASON_SIGNAL,
    )
    const fresh = strong.find((c) => !spoken.has(c.trait))
    const pick = fresh || strong[0] || null
    const trait = pick?.trait || null
    // When every trait this item speaks to has already been said, keep the
    // trait (it is the true reason) but use its second phrasing.
    const variant = fresh ? 0 : 1
    if (trait) spoken.add(trait)
    const dir = trait ? ((profile.traits[trait] ?? 0.5) >= 0.5 ? 'high' : 'low') : 'high'
    const phrasings = trait ? REASON[trait]?.[dir] : null
    const raw = Array.isArray(phrasings) ? (phrasings[variant] || phrasings[0]) : ''
    return {
      item: s.item,
      name: s.name,
      score: Math.round(s.score * 100) / 100,
      trait,
      loadings: s.loadings,
      reason: fillLex(raw || 'لأنه الأقرب إلى ما اخترته اليوم.', tenant),
    }
  })
}

// ---------------------------------------------------------------------------
// AI HANDOFF
// ---------------------------------------------------------------------------
// Compact, honest summary for the system's AI surfaces. Percentages are
// rounded ints on 0..100; `confidence` says how much to trust them, and the
// `basis` line exists so the AI never presents this as certainty.
export function profileSummaryForAi(profile, opts = {}) {
  if (!profile?.traits) return null
  const traits = {}
  for (const t of TRAITS) traits[t.id] = Math.round((profile.traits[t.id] ?? 0.5) * 100)
  const top = (profile.topTraits || []).slice(0, 3).map((x) => ({
    trait: x.id,
    ar: traitById(x.id)?.ar || x.id,
    pole: x.dir === 'high' ? traitById(x.id)?.high : traitById(x.id)?.low,
    value: Math.round(x.value * 100),
  }))
  return {
    v: INSIGHT_VERSION,
    source: opts.source || profile.source || '',
    archetype: profile.archetype ? { id: profile.archetype.id, ar: profile.archetype.ar } : null,
    fit: Math.round((profile.archetypeFit || 0) * 100),
    traits,
    top,
    answered: profile.answered || 0,
    confidence: Math.round((profile.confidence || 0) * 100),
    basis: 'مقياس مبني على العوامل الخمسة الكبرى + محورَي القرار والتجديد، من إجابات جلسة واحدة قصيرة. مؤشرات لا تشخيص.',
  }
}

// Arabic-safe number formatting (Latin digits — project hard rule).
export const arNum = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')
