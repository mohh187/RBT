// Achievements / badges — derived purely from a staffer's performance + attendance
// stats (the same tamper-resistant source as scoring). Returns earned + locked
// badges (with progress) so the portal can show "earned" and "next goals".
//
// `stats` is a scoreStaff row (served/handled/revenue/avgRating/ratingN/progress).
// `ctx`: { rank, lateCount, hasPunches, ar }.

const DEFS = [
  { id: 'firstServe', icon: 'check', color: '#7c9cff', ar: 'الانطلاقة', en: 'First serve', descAr: 'قدّم أول طلب', descEn: 'Serve your first order', goal: 1, val: (s) => s.served },
  { id: 'tenOrders', icon: 'orders', color: '#5ec5a8', ar: 'عشرة على التوالي', en: 'Perfect ten', descAr: 'قدّم 10 طلبات', descEn: 'Serve 10 orders', goal: 10, val: (s) => s.served },
  { id: 'fiftyOrders', icon: 'orders', color: '#3fa7ff', ar: 'الخمسينية', en: 'Half-century', descAr: 'قدّم 50 طلباً', descEn: 'Serve 50 orders', goal: 50, val: (s) => s.served },
  { id: 'hundredOrders', icon: 'award', color: '#e0b15c', ar: 'المئوية', en: 'Centurion', descAr: 'قدّم 100 طلب', descEn: 'Serve 100 orders', goal: 100, val: (s) => s.served },
  { id: 'targetHit', icon: 'award', color: '#5ec57a', ar: 'محقّق الهدف', en: 'On target', descAr: 'حقّق هدف الفترة', descEn: 'Hit your target', goal: 1, val: (s) => (s.progress >= 1 ? 1 : 0) },
  { id: 'overachiever', icon: 'trending', color: '#e0b15c', ar: 'متجاوز الهدف', en: 'Overachiever', descAr: 'تجاوز الهدف 1.5×', descEn: 'Beat target by 1.5×', goal: 1, val: (s) => (s.progress >= 1.5 ? 1 : 0) },
  { id: 'fiveStar', icon: 'star', color: '#e0b15c', ar: 'نجم الخدمة', en: 'Five-star', descAr: 'تقييم 4.8+ (3 تقييمات)', descEn: '4.8+ over 3 ratings', goal: 1, val: (s) => (s.ratingN >= 3 && s.avgRating >= 4.8 ? 1 : 0) },
  { id: 'champion', icon: 'award', color: '#ff7eb6', ar: 'بطل الفترة', en: 'Champion', descAr: 'المركز الأول', descEn: 'Reach #1', goal: 1, val: (_, c) => (c.rank === 1 ? 1 : 0) },
  { id: 'punctual', icon: 'clock', color: '#5ec5a8', ar: 'الالتزام', en: 'Punctual', descAr: 'بلا تأخير هذا الشهر', descEn: 'No lateness this month', goal: 1, val: (_, c) => (c.hasPunches && c.lateCount === 0 ? 1 : 0) },
]

export function achievementsFor(stats, ctx = {}) {
  const s = stats || {}
  return DEFS.map((d) => {
    const val = Math.max(0, d.val(s, ctx) || 0)
    const earned = val >= d.goal
    return {
      id: d.id, icon: d.icon, color: d.color,
      label: ctx.ar ? d.ar : d.en,
      desc: ctx.ar ? d.descAr : d.descEn,
      earned, progress: Math.min(1, d.goal ? val / d.goal : 0), val, goal: d.goal,
    }
  })
}

export function earnedCount(stats, ctx) {
  return achievementsFor(stats, ctx).filter((a) => a.earned).length
}
