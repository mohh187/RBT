// «سنتك معنا» — a vertical story deck of one diner's real year at this venue.
// Every figure comes from customerYear() in lib/forecast.js (computed from the
// venue's own orders); nothing here is generated or estimated. When the data is
// thin we say so warmly instead of printing hollow zeros.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { fmtNum } from '../lib/format.js'

const T = {
  ar: {
    cover: 'سنتك مع',
    coverHint: 'اسحب للأعلى',
    visits: 'زيارة',
    visitsTitle: 'زرتنا',
    visitsLine: 'هذا العام',
    spentTitle: 'أنفقت معنا',
    avgTicket: 'متوسط الفاتورة',
    favTitle: 'طبقك المفضل',
    favTimes: 'مرة',
    timeTitle: 'وقتك المفضل',
    timeOn: 'غالباً يوم',
    timeAt: 'قرابة الساعة',
    streakTitle: 'محطاتك',
    streakDays: 'يوماً متتالياً',
    rankTop: 'ضمن أعلى',
    rankOf: 'من عملائنا هذا العام',
    thanksTitle: 'شكراً لك',
    thanksLine: 'سنة كاملة وأنت معنا — نراك في القادمة.',
    share: 'شارك قصتك',
    copied: 'تم نسخ الملخص',
    copyFail: 'تعذّرت المشاركة — انسخ النص يدوياً',
    thinTitle: 'لسه في البداية',
    thinLine: 'زياراتك القادمة ستبني قصتك — نحتفظ لك بكل زيارة.',
    close: 'إغلاق',
    dishes: 'صنفاً جرّبته',
    biggest: 'أكبر طلب',
  },
  en: {
    cover: 'Your year with',
    coverHint: 'Swipe up',
    visits: 'visits',
    visitsTitle: 'You visited',
    visitsLine: 'this year',
    spentTitle: 'You spent with us',
    avgTicket: 'Average ticket',
    favTitle: 'Your favourite dish',
    favTimes: 'times',
    timeTitle: 'Your favourite time',
    timeOn: 'Mostly on',
    timeAt: 'around',
    streakTitle: 'Your milestones',
    streakDays: 'days in a row',
    rankTop: 'In the top',
    rankOf: 'of our guests this year',
    thanksTitle: 'Thank you',
    thanksLine: 'A whole year together — see you in the next one.',
    share: 'Share your story',
    copied: 'Summary copied',
    copyFail: 'Sharing failed — copy the text manually',
    thinTitle: 'Just getting started',
    thinLine: 'Your next visits will build your story — every one is counted.',
    close: 'Close',
    dishes: 'dishes tried',
    biggest: 'Biggest order',
  },
}

const WEEK_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function Card({ tone = 1, children, label }) {
  return (
    <section className={`yw-card yw-tone-${tone}`} aria-label={label}>
      <div className="yw-card-in">{children}</div>
    </section>
  )
}

export default function YearWrapped({ open, onClose, stats, venueName = '', lang = 'ar', currency = 'SAR', items = [] }) {
  const ar = lang !== 'en'
  const t = ar ? T.ar : T.en
  const portalRoot = usePortalRoot()
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(id)
  }, [toast])

  if (!open) return null

  const thin = !stats || !stats.hasData || stats.thin
  const fav = stats?.favouriteItem || null
  const favPhoto = fav ? (fav.imageUrl || (items || []).find((i) => i.id === fav.itemId)?.imageUrl || '') : ''
  const dayName = stats?.favouriteDay ? (ar ? stats.favouriteDay.name : WEEK_EN[stats.favouriteDay.weekday]) : ''

  const summary = () => {
    if (thin) return ''
    const lines = [
      `${t.cover} ${venueName}`.trim(),
      `${stats.visits} ${t.visits}`,
      fav ? `${t.favTitle}: ${fav.name}` : '',
      stats.rank ? `${t.rankTop} ${stats.rank.topPercent}% ${t.rankOf}` : '',
    ]
    return lines.filter(Boolean).join('\n')
  }

  const share = async () => {
    const text = summary()
    if (!text) return
    try {
      if (navigator.share) {
        await navigator.share({ title: venueName || 'RBT360', text })
        return
      }
    } catch (_) { /* user dismissed the share sheet — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(text)
      setToast(t.copied)
    } catch (_) {
      setToast(t.copyFail)
    }
  }

  return createPortal(
    <div className="yw-root" role="dialog" aria-modal="true" aria-label={`${t.cover} ${venueName}`}>
      <button type="button" className="yw-close icon-btn" onClick={onClose} aria-label={t.close}>
        <Icon name="close" size={20} />
      </button>

      <div className="yw-deck">
        <Card tone={1} label={t.cover}>
          <span className="yw-eyebrow">{stats?.year ? fmtNum(stats.year, lang) : ''}</span>
          <h2 className="yw-cover-title">{t.cover}<br /><b>{venueName}</b></h2>
          <span className="yw-hint"><Icon name="arrowUp" size={14} /> {t.coverHint}</span>
        </Card>

        {thin ? (
          <Card tone={2} label={t.thinTitle}>
            <span className="yw-eyebrow">{t.thinTitle}</span>
            <p className="yw-lead">{t.thinLine}</p>
            {stats?.visits > 0 && (
              <span className="yw-sub">{fmtNum(stats.visits, lang)} {t.visits}</span>
            )}
          </Card>
        ) : (
          <>
            <Card tone={2} label={t.visitsTitle}>
              <span className="yw-eyebrow">{t.visitsTitle}</span>
              <strong className="yw-big">{fmtNum(stats.visits, lang)}</strong>
              <span className="yw-sub">{t.visits} · {t.visitsLine}</span>
              {stats.distinctItems > 0 && (
                <span className="yw-chip">{fmtNum(stats.distinctItems, lang)} {t.dishes}</span>
              )}
            </Card>

            <Card tone={3} label={t.spentTitle}>
              <span className="yw-eyebrow">{t.spentTitle}</span>
              <strong className="yw-big yw-money">
                <Price value={stats.totalSpent} currency={currency} lang={lang} />
              </strong>
              <span className="yw-sub">
                {t.avgTicket}: <Price value={stats.avgTicket} currency={currency} lang={lang} />
              </span>
              {stats.biggestOrder && (
                <span className="yw-chip">
                  {t.biggest}: <Price value={stats.biggestOrder.total} currency={currency} lang={lang} />
                </span>
              )}
            </Card>

            {fav && (
              <Card tone={4} label={t.favTitle}>
                <span className="yw-eyebrow">{t.favTitle}</span>
                <span className="yw-photo">
                  {favPhoto
                    ? <img src={favPhoto} alt={fav.name} loading="lazy" />
                    : <span className="yw-photo-ph"><Icon name="coffee" size={40} /></span>}
                </span>
                <strong className="yw-mid">{fav.name}</strong>
                <span className="yw-sub">{fmtNum(fav.count, lang)} {t.favTimes}</span>
              </Card>
            )}

            {(stats.favouriteDay || stats.favouriteHour) && (
              <Card tone={5} label={t.timeTitle}>
                <span className="yw-eyebrow">{t.timeTitle}</span>
                {dayName && <strong className="yw-mid">{t.timeOn} {dayName}</strong>}
                {stats.favouriteHour && (
                  <span className="yw-clock" dir="ltr">{stats.favouriteHour.label}</span>
                )}
                {stats.favouriteHour && <span className="yw-sub">{t.timeAt}</span>}
              </Card>
            )}

            {(stats.milestones?.length > 0 || stats.rank) && (
              <Card tone={6} label={t.streakTitle}>
                <span className="yw-eyebrow">{t.streakTitle}</span>
                {stats.rank && (
                  <strong className="yw-mid">{t.rankTop} {fmtNum(stats.rank.topPercent, lang)}% {t.rankOf}</strong>
                )}
                {stats.longestStreak > 1 && (
                  <span className="yw-chip">{fmtNum(stats.longestStreak, lang)} {t.streakDays}</span>
                )}
                <ul className="yw-miles">
                  {(stats.milestones || []).slice(0, 5).map((m) => (
                    <li key={m.key}>
                      <span className="yw-mile-k">{m.label}</span>
                      <span className="yw-mile-v" dir="auto">{m.value}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        <Card tone={7} label={t.thanksTitle}>
          <span className="yw-eyebrow">{t.thanksTitle}</span>
          <h2 className="yw-cover-title"><b>{venueName}</b></h2>
          <p className="yw-lead">{t.thanksLine}</p>
          {!thin && (
            <button type="button" className="btn btn-primary yw-share" onClick={share}>
              <Icon name="share" size={16} /> {t.share}
            </button>
          )}
        </Card>
      </div>

      {toast && <div className="yw-toast" role="status">{toast}</div>}
    </div>,
    portalRoot,
  )
}
