// «مستشار العروض الذكي» — rule-based, explainable offer suggestions.
// Every card shows the real figures it was derived from (units sold, margin,
// co-occurrence counts, quiet-hour volume) so the manager can audit the advice.
// The optional AI pass receives ONLY that computed snapshot and is instructed to
// reason from it and invent nothing; if it is unavailable the rules still stand.
import { useMemo, useState } from 'react'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import Markdown from './Markdown.jsx'
import { Spinner } from './ui.jsx'
import { offerAdvice, WEEKDAYS_AR, WEEKDAYS_EN } from '../lib/forecast.js'
import { aiQuick, aiConfigured } from '../lib/aiBridge.js'

const T = {
  ar: {
    title: 'مستشار العروض الذكي',
    intro: 'توصيات محسوبة من طلبات منشأتك الفعلية — كل رقم معروض هنا مأخوذ من بياناتك، لا من تقدير.',
    window: 'نافذة التحليل',
    days: 'يوماً',
    orders: 'طلب',
    empty: 'لا توجد توصية واضحة بعد.',
    emptyHint: 'تحتاج التوصيات إلى طلبات مسجّلة وتكاليف وصفات (المخزون) حتى تُحسب بدقة.',
    create: 'أنشئ هذا العرض',
    numbers: 'الأرقام المستخدمة',
    conf: { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' },
    confHint: 'الثقة مشتقّة من حجم العينة فقط.',
    analyze: 'حلّل بالذكاء',
    analyzing: 'جاري التحليل',
    aiTitle: 'قراءة استراتيجية',
    aiOff: 'المساعد الذكي غير مهيأ — التوصيات أعلاه تعمل باستقلال تام.',
    aiErr: 'تعذّر التحليل الذكي الآن — التوصيات المحسوبة أعلاه لا تزال صالحة.',
    aiNote: 'صيغت هذه القراءة من الأرقام المعروضة فقط.',
    suggested: 'المقترح',
    off: 'خصم',
    on: 'على',
    itemsN: 'صنف',
    cart: 'السلة كاملة',
    windowLbl: 'التوقيت',
    to: 'حتى',
  },
  en: {
    title: 'Smart offer advisor',
    intro: 'Recommendations computed from your venue\'s real orders — every figure here comes from your data, not an estimate.',
    window: 'Analysis window',
    days: 'days',
    orders: 'orders',
    empty: 'No clear recommendation yet.',
    emptyHint: 'Recommendations need recorded orders and recipe costs (inventory) to be computed accurately.',
    create: 'Create this offer',
    numbers: 'Figures used',
    conf: { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' },
    confHint: 'Confidence is derived from sample size only.',
    analyze: 'Analyse with AI',
    analyzing: 'Analysing',
    aiTitle: 'Strategic reading',
    aiOff: 'AI is not configured — the recommendations above work on their own.',
    aiErr: 'AI analysis is unavailable right now — the computed recommendations above still stand.',
    aiNote: 'This reading was written from the displayed figures only.',
    suggested: 'Suggested',
    off: 'off',
    on: 'on',
    itemsN: 'items',
    cart: 'whole cart',
    windowLbl: 'Timing',
    to: 'to',
  },
}

const KIND_ICON = {
  'slow-mover': 'trending',
  'happy-hour': 'clock',
  overstock: 'package',
  pairing: 'layers',
}

function windowText(w, ar, t) {
  if (!w) return ''
  const names = ar ? WEEKDAYS_AR : WEEKDAYS_EN
  const dayPart = (w.daysOfWeek || []).map((d) => names[d]).join(' / ')
  const timePart = w.startTime && w.endTime ? `${w.startTime} ${t.to} ${w.endTime}` : ''
  return [dayPart, timePart].filter(Boolean).join(' · ')
}

function Suggestion({ s, ar, t, onCreate }) {
  const [openNums, setOpenNums] = useState(false)
  const wt = windowText(s.suggestedWindow, ar, t)
  return (
    <article className="soa-card">
      <header className="soa-head">
        <span className="soa-ico" aria-hidden="true"><Icon name={KIND_ICON[s.kind] || 'sparkles'} size={16} /></span>
        <h3 className="soa-title">{s.title}</h3>
        <span className={`soa-conf soa-conf-${s.confidence}`}>{t.conf[s.confidence]}</span>
      </header>

      <p className="soa-why">{s.why}</p>

      <div className="soa-meta">
        <span className="soa-pill soa-pill-strong">
          {t.suggested}: {s.suggestedValue}{s.suggestedType === 'percent' ? '%' : ''} {t.off}
        </span>
        <span className="soa-pill">
          {t.on} {s.suggestedScope === 'cart' ? t.cart : `${s.itemIds.length} ${t.itemsN}`}
        </span>
        {wt && <span className="soa-pill"><Icon name="clock" size={12} /> {wt}</span>}
      </div>

      <button
        type="button"
        className="soa-numtoggle"
        aria-expanded={openNums}
        onClick={() => setOpenNums((v) => !v)}
      >
        <Icon name="arrowUpDown" size={13} /> {t.numbers}
      </button>
      {openNums && (
        <dl className="soa-nums">
          {Object.entries(s.numbers || {}).map(([k, v]) => (
            <div key={k} className="soa-num">
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <button type="button" className="btn btn-primary btn-sm soa-cta" onClick={() => onCreate(s)}>
        <Icon name="add" size={15} /> {t.create}
      </button>
    </article>
  )
}

export default function SmartOfferAdvisor({
  open, onClose, orders = [], items = [], materials = [], offers = [],
  lang = 'ar', currency = 'SAR', onCreateOffer, days = 30,
}) {
  const ar = lang !== 'en'
  const t = ar ? T.ar : T.en
  const [ai, setAi] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const [showSnap, setShowSnap] = useState(false)

  // Recomputed only when the underlying documents change — this is real math
  // over the whole order set, not something to run on every render.
  const advice = useMemo(
    () => (open ? offerAdvice({ orders, items, materials, offers, days }) : null),
    [open, orders, items, materials, offers, days],
  )

  const create = (s) => {
    const draft = {
      name: s.title,
      nameAr: s.title,
      // Repo offers use 'percent' | 'fixed'; every rule-based suggestion is a
      // percentage, so both vocabularies agree here.
      type: s.suggestedType === 'percent' ? 'percent' : 'amount',
      value: s.suggestedValue,
      scope: s.suggestedScope,
      itemIds: s.itemIds || [],
      itemId: (s.itemIds || [])[0] || '',
      window: s.suggestedWindow,
      source: { kind: s.kind, why: s.why, numbers: s.numbers, confidence: s.confidence },
    }
    onCreateOffer?.(draft)
  }

  const analyse = async () => {
    if (!advice) return
    setAiBusy(true)
    setAiErr('')
    setAi('')
    const prompt = [
      'أنت مستشار تسعير وعروض لمطعم/مقهى واحد فقط.',
      'القاعدة الصارمة: اعتمد حصرياً على الأرقام الموجودة في البيانات أدناه. ممنوع منعاً باتاً اختراع أي رقم أو نسبة أو تاريخ أو اسم غير موجود فيها.',
      'إن كانت البيانات غير كافية لاستنتاج ما، قل ذلك صراحةً بدل التخمين.',
      `العملة: ${currency}. نافذة التحليل: ${advice.days} يوماً، وعدد الطلبات فيها: ${advice.sample.orders}.`,
      'اكتب بالعربية فقرة واحدة قصيرة (من ثلاث إلى خمس جمل) تشرح: أين تكمن الفرصة، وما الترتيب الأنسب لتنفيذ العروض المقترحة، وما الخطر الذي يجب الانتباه له.',
      'استخدم الأرقام اللاتينية فقط. بدون رموز تعبيرية. بدون عناوين أو قوائم — فقرة واحدة متصلة.',
      '',
      'البيانات:',
      JSON.stringify(advice.snapshot),
    ].join('\n')
    try {
      const out = await aiQuick(prompt)
      if (out) setAi(out)
      else setAiErr(t.aiErr)
    } catch (_) {
      setAiErr(t.aiErr)
    }
    setAiBusy(false)
  }

  const list = advice?.suggestions || []

  return (
    <Sheet open={open} onClose={onClose} title={t.title} tall className="soa-sheet">
      <p className="soa-intro">{t.intro}</p>

      {advice && (
        <div className="soa-stats">
          <span className="soa-stat"><b>{advice.days}</b> {t.days}</span>
          <span className="soa-stat"><b>{advice.sample.orders}</b> {t.orders}</span>
          <span className={`soa-conf soa-conf-${advice.confidence}`}>{t.conf[advice.confidence]}</span>
        </div>
      )}
      {advice?.limits && <p className="soa-limit"><Icon name="warning" size={13} /> {advice.limits}</p>}

      {!list.length ? (
        <div className="soa-empty">
          <Icon name="notepad" size={24} />
          <strong>{t.empty}</strong>
          <span>{t.emptyHint}</span>
        </div>
      ) : (
        <div className="soa-list">
          {list.map((s) => <Suggestion key={s.id} s={s} ar={ar} t={t} onCreate={create} />)}
        </div>
      )}

      <div className="soa-ai">
        {aiConfigured() ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={analyse} disabled={aiBusy || !advice}>
            {aiBusy ? <><Spinner /> {t.analyzing}</> : <><Icon name="sparkles" size={15} /> {t.analyze}</>}
          </button>
        ) : (
          <p className="soa-limit">{t.aiOff}</p>
        )}

        {aiErr && <p className="soa-limit">{aiErr}</p>}

        {ai && (
          <div className="soa-aibox">
            <strong className="soa-aititle"><Icon name="sparkles" size={14} /> {t.aiTitle}</strong>
            <div className="soa-aitext"><Markdown text={ai} /></div>
            <p className="soa-ainote">{t.aiNote} {t.confHint}</p>
            <button
              type="button"
              className="soa-numtoggle"
              aria-expanded={showSnap}
              onClick={() => setShowSnap((v) => !v)}
            >
              <Icon name="arrowUpDown" size={13} /> {t.numbers}
            </button>
            {showSnap && (
              <pre className="soa-snap" dir="ltr">{JSON.stringify(advice.snapshot, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
