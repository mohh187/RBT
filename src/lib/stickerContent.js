// WHAT THE NAPKIN-STAND STICKER IS ALLOWED TO SAY.
//
// A sticker is printed once and then sits on a table for months. Every line on
// it is a promise the guest will test within thirty seconds of scanning, so a
// claim that is merely *possible* in the product is not good enough — it has to
// be true for THIS venue right now. Hence this module derives the copy from the
// tenant document instead of hard-coding a feature list:
//
//   - a browse-only venue never says «اطلب من جوالك» (it cannot take orders)
//   - loyalty copy carries the venue's real threshold, not a marketing 5
//   - the games line names only games the venue actually left switched on
//   - VIP tiers/points appear only when membership is enabled (it ships OFF)
//
// Deliberately NOT offered, because the product does not have them: favourites,
// table chat, Apple Wallet (the button is a disabled «قريباً»), and any claim
// that a guest enters a birthday (only staff can set one).
//
// House rules that this file must not break: no emoji anywhere (icons are
// lucide names consumed by <Icon/>), and Latin digits only — plain JS number
// interpolation gives us those for free, so never route these through a
// localised formatter.
import { gamesFor } from './games.js'

// Arabic counted nouns. 2 → مثنى, 3-10 → جمع, 11+ → مفرد منصوب.
function countedAr(n, { one, two, few, many }) {
  if (n === 1) return one
  if (n === 2) return two
  if (n >= 3 && n <= 10) return few
  return many
}

const drinks = (n) => countedAr(n, { one: 'مشروب', two: 'مشروبين', few: 'مشروبات', many: 'مشروباً' })
const gamesWord = (n) => countedAr(n, { one: 'لعبة', two: 'لعبتين', few: 'ألعاب', many: 'لعبة' })

// The six games a Gulf guest recognises by name without explanation. Naming
// these converts far better than «23 لعبة» alone, which reads as filler.
const HEADLINE_GAME_IDS = ['wist', 'ludo', 'dominoes', 'chess', 'jackaroo', 'haree']

export function stickerContent(tenant, { lang = 'ar' } = {}) {
  const ar = lang !== 'en'
  const on = (k) => tenant?.[k] !== false
  const ordering = tenant?.menuMode !== 'browse'

  const enabled = gamesFor(tenant) || []
  const gamesOn = on('gamesEnabled') && enabled.length > 0
  const gameCount = enabled.length
  const named = HEADLINE_GAME_IDS
    .map((id) => enabled.find((g) => g.id === id))
    .filter(Boolean)
    .map((g) => (ar ? g.ar : g.en || g.ar))
  const restCount = Math.max(0, gameCount - named.length)

  const loyaltyOn = on('loyaltyEnabled')
  const threshold = Math.max(2, Number(tenant?.loyaltyThreshold) || 5)
  const memberOn = tenant?.membership?.enabled === true
  const waiterOn = on('waiterCallEnabled')
  const sharedOn = ordering && on('sharedCartEnabled')
  const voiceOn = ordering && on('voiceWaiterEnabled')

  // ---- the centre face: one hook, then five benefit rows -------------------
  const hook = ar
    ? (ordering ? 'امسح. اطلب. العب.' : 'امسح. استكشف. العب.')
    : (ordering ? 'Scan. Order. Play.' : 'Scan. Explore. Play.')

  const subParts = ar
    ? [ordering ? 'اطلب من مكانك' : 'المنيو بالصور', gamesOn ? `${gameCount} ${gamesWord(gameCount)} مجاناً` : null, loyaltyOn ? 'ومكافآت تنتظرك' : null]
    : [ordering ? 'Order from your seat' : 'Photo menu', gamesOn ? `${gameCount} free games` : null, loyaltyOn ? 'and rewards' : null]
  const sub = subParts.filter(Boolean).join(ar ? ' · ' : ' · ')

  const features = []
  if (ordering) {
    features.push({
      icon: 'cart',
      title: ar ? 'اطلب من جوالك' : 'Order from your phone',
      body: ar ? 'طلبك يصل المطبخ في نفس اللحظة، بلا انتظار.' : 'Straight to the kitchen — no waiting.',
    })
  } else {
    features.push({
      icon: 'image',
      title: ar ? 'المنيو كاملاً بالصور' : 'The full photo menu',
      body: ar ? 'كل صنف بصورته وسعره ومكوّناته وسعراته.' : 'Every item with photo, price and calories.',
    })
  }
  if (gamesOn) {
    features.push({
      icon: 'games',
      title: ar ? `${gameCount} ${gamesWord(gameCount)} مجاناً` : `${gameCount} free games`,
      body: ar
        ? (named.length ? `${named.slice(0, 4).join(' · ')}${restCount ? ' والمزيد' : ''}. والعبوا معاً على طاولة واحدة.` : 'العبوا معاً على طاولة واحدة.')
        : 'Play together at one table.',
    })
  }
  if (loyaltyOn) {
    features.push({
      icon: 'award',
      title: ar ? `اطلب ${threshold} ${drinks(threshold)} والتالي علينا` : `Every ${threshold} drinks, one free`,
      body: ar ? 'سجّل رقمك مرة، ونحسبها لك في كل زيارة.' : 'Register once, we count every visit.',
    })
  } else if (memberOn) {
    features.push({
      icon: 'award',
      title: ar ? 'عضوية بخصم دائم' : 'Membership discount',
      body: ar ? 'اجمع نقاطك مع كل زيارة، وارتقِ لمستوى أعلى.' : 'Earn points, climb tiers.',
    })
  }
  if (waiterOn) {
    features.push({
      icon: 'waiter',
      title: ar ? 'نادِ النادل واطلب الحساب' : 'Call the waiter · ask for the bill',
      body: ar ? 'ماء أو أدوات أو الفاتورة، بزرٍّ واحد من مكانك.' : 'Water, cutlery or the bill — one tap.',
    })
  }
  features.push({
    icon: 'bell',
    title: ar ? 'عروضنا تصلك أولاً' : 'Offers reach you first',
    body: ar ? 'اسمك ورقمك فقط، والجديد يصلك على واتساب.' : 'Name and number — news comes by WhatsApp.',
  })

  // ---- side face A: the games pitch ---------------------------------------
  const gamesFace = gamesOn
    ? {
        kicker: ar ? 'ركن الألعاب' : 'Games corner',
        title: ar ? `${gameCount} ${gamesWord(gameCount)} في جوالك` : `${gameCount} games`,
        names: named,
        more: ar
          ? (restCount ? `و${restCount} ${gamesWord(restCount)} أخرى: ألغاز، ومعرفة، واكتشف شخصيتك.` : 'ألغاز، ومعرفة، واكتشف شخصيتك.')
          : (restCount ? `And ${restCount} more.` : ''),
        rows: [
          { icon: 'customers', text: ar ? 'العبوا معاً على طاولة واحدة، أو تحدَّوا طاولة أخرى.' : 'Play together, or challenge another table.' },
          { icon: 'award', text: ar ? 'جوائز حقيقية من المكان. اربح واعرض الرمز للكاشير.' : 'Real prizes — show the code at the till.' },
          { icon: 'trending', text: ar ? 'لوحة صدارة شهرية، ونتائجك محفوظة لك.' : 'Monthly leaderboard.' },
        ],
        cta: ar ? 'امسح والعب الآن' : 'Scan and play',
      }
    : null

  // ---- side face B: everything else worth knowing --------------------------
  const perksRows = []
  if (loyaltyOn) perksRows.push({ icon: 'award', text: ar ? `كل ${threshold} ${drinks(threshold)} = ${drinks(1)} مجاني.` : `Every ${threshold} drinks free one.` })
  if (memberOn) perksRows.push({ icon: 'star', text: ar ? 'عضوية بمستويات وخصم دائم على كل زيارة.' : 'Tiered membership discount.' })
  perksRows.push({ icon: 'bell', text: ar ? 'عروضنا وجديدنا يصلك على واتساب أولاً.' : 'Offers by WhatsApp first.' })
  if (sharedOn) perksRows.push({ icon: 'customers', text: ar ? 'اطلبوا معاً من طاولة واحدة، والحساب يُقسَّم تلقائياً.' : 'One shared basket, split automatically.' })
  if (waiterOn) perksRows.push({ icon: 'waiter', text: ar ? 'نادِ النادل أو اطلب الحساب من مكانك.' : 'Call the waiter or ask for the bill.' })
  if (voiceOn) perksRows.push({ icon: 'mic', text: ar ? 'اطلب بصوتك، أو صوّر الطبق الذي يعجبك.' : 'Order by voice, or by photo.' })
  perksRows.push({ icon: 'flame', text: ar ? 'السعرات والمكوّنات والمنبّهات لكل صنف.' : 'Calories, ingredients and allergens.' })

  const perksFace = {
    kicker: ar ? 'لأنك ضيفنا' : 'Because you are our guest',
    title: ar ? 'ميزات تنتظرك في المنيو' : 'What waits inside',
    rows: perksRows.slice(0, 6),
    cta: ar ? 'امسح وسجّل رقمك' : 'Scan and register',
  }

  return { hook, sub, features: features.slice(0, 5), gamesFace, perksFace, gameCount, threshold, ordering }
}
