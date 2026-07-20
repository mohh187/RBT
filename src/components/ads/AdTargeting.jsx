// «الربط» + «الجمهور» — where the CTA sends the guest, and who is allowed to
// see the ad at all.
//
// The item / category / offer pickers list the venue's REAL documents. When a
// list is empty the panel says so plainly instead of showing a dead dropdown.
import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { pickLang } from '../../lib/i18n.jsx'
import { LINK_TARGETS, AUDIENCES, safeUrl } from '../../lib/ads.js'
import { lex } from '../../lib/venueTypes.js'

const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

function PickList({ rows, value, onPick, emptyText, lang }) {
  const [q, setQ] = useState('')
  const ar = lang !== 'en'
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle ? rows.filter((r) => r.label.toLowerCase().includes(needle)) : rows
    return list.slice(0, 40)
  }, [rows, q])

  if (!rows.length) return <div className="ads-warn">{emptyText}</div>

  return (
    <>
      {rows.length > 8 ? (
        <input
          className="input input-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'بحث' : 'Search'}
        />
      ) : null}
      <div className="ads-picks">
        {shown.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`ads-pick${value === r.id ? ' active' : ''}`}
            onClick={() => onPick(r.id)}
          >
            <span>{r.label}</span>
            {value === r.id ? <Icon name="check" size={15} /> : null}
          </button>
        ))}
        {shown.length < rows.length ? (
          <p className="ads-hint">
            {ar
              ? `عُرض ${num(shown.length)} من ${num(rows.length)} — استخدم البحث للوصول لبقيتها.`
              : `Showing ${shown.length} of ${rows.length}.`}
          </p>
        ) : null}
      </div>
    </>
  )
}

export default function AdTargeting({ ad, onChange, tenant, items = [], categories = [], offers = [], lang = 'ar' }) {
  const ar = lang !== 'en'
  const target = (patch) => onChange({ ...ad, target: { ...ad.target, ...patch } })
  const audience = (patch) => onChange({ ...ad, audience: { ...ad.audience, ...patch } })

  const itemRows = useMemo(
    () => (items || []).map((i) => ({ id: i.id, label: pickLang(i, 'name', lang) || i.id })),
    [items, lang],
  )
  const catRows = useMemo(
    () => (categories || []).map((c) => ({ id: c.id, label: pickLang(c, 'name', lang) || c.id })),
    [categories, lang],
  )
  const offerRows = useMemo(
    () => (offers || []).map((o) => ({
      id: o.id,
      label: `${pickLang(o, 'name', lang) || o.id}${o.active === false ? (ar ? ' (موقوف)' : ' (paused)') : ''}`,
    })),
    [offers, lang, ar],
  )

  const link = ad.target.link
  const urlOk = link !== 'url' || !!safeUrl(ad.target.url)

  return (
    <>
      <div>
        <h4>{ar ? 'وجهة زر الإجراء' : 'CTA destination'}</h4>
        <p className="ads-hint">
          {ar
            ? 'عند الضغط على الزر ينتقل الضيف إلى ما تختاره هنا. بدون وجهة يغلق الزر الإعلان فقط.'
            : 'Without a destination the button just closes the ad.'}
        </p>
      </div>

      <div className="ads-steps">
        {LINK_TARGETS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`chip${link === l.id ? ' active' : ''}`}
            onClick={() => target({ link: l.id })}
          >
            <Icon name={l.icon} size={15} />
            {ar ? l.ar : l.en}
          </button>
        ))}
      </div>

      {link === 'item' ? (
        <PickList
          rows={itemRows}
          value={ad.target.itemId}
          onPick={(id) => target({ itemId: id })}
          lang={lang}
          emptyText={ar
            ? `لا توجد ${lex(tenant, 'items')} في القائمة بعد — أضف واحداً أولاً ثم عد إلى هنا.`
            : 'No menu items yet.'}
        />
      ) : null}

      {link === 'category' ? (
        <PickList
          rows={catRows}
          value={ad.target.categoryId}
          onPick={(id) => target({ categoryId: id })}
          lang={lang}
          emptyText={ar ? 'لا توجد أقسام في القائمة بعد.' : 'No categories yet.'}
        />
      ) : null}

      {link === 'offer' ? (
        <PickList
          rows={offerRows}
          value={ad.target.offerId}
          onPick={(id) => target({ offerId: id })}
          lang={lang}
          emptyText={ar ? 'لا توجد عروض معرّفة بعد — أنشئ عرضاً من صفحة العروض.' : 'No offers defined yet.'}
        />
      ) : null}

      {link === 'url' ? (
        <div className="field">
          <label htmlFor="ads-url">{ar ? 'الرابط الخارجي' : 'External URL'}</label>
          <input
            id="ads-url"
            className="input"
            dir="ltr"
            value={ad.target.url}
            onChange={(e) => target({ url: e.target.value })}
            placeholder="https://"
          />
          {!urlOk && ad.target.url ? (
            <span className="ads-ai-err">
              {ar ? 'الرابط غير صالح — يجب أن يبدأ بـ https ويكون رابطاً كاملاً.' : 'Invalid URL.'}
            </span>
          ) : null}
          <span className="ads-hint">
            {ar ? 'يُفتح في تبويب جديد خارج التطبيق.' : 'Opens in a new tab.'}
          </span>
        </div>
      ) : null}

      {link === 'games' || link === 'story' ? (
        <p className="ads-hint">
          {ar
            ? 'ينتقل الضيف مباشرة إلى هذا القسم داخل القائمة، بشرط أن يكون مفعّلاً لديك.'
            : 'Takes the guest straight to that section, provided it is enabled.'}
        </p>
      ) : null}

      {/* ---- audience ---- */}
      <div>
        <h4>{ar ? 'من يرى هذا الإعلان' : 'Audience'}</h4>
        <p className="ads-hint">
          {ar
            ? 'عدد الزيارات يُحسب لكل جهاز عبر متصفح الضيف — من يمسح بياناته أو يبدل جواله يُحسب زائراً جديداً.'
            : 'Visits are counted per browser on the guest device.'}
        </p>
      </div>

      <div className="ads-steps">
        {AUDIENCES.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`chip${ad.audience.who === a.id ? ' active' : ''}`}
            onClick={() => audience({ who: a.id })}
          >
            <Icon name={a.icon} size={15} />
            {ar ? a.ar : a.en}
          </button>
        ))}
      </div>

      {ad.audience.who === 'members' ? (
        <p className="ads-hint">
          {ar
            ? 'يظهر فقط لمن فتح القائمة ببطاقة عضويته. الضيف غير المسجَّل لن يراه إطلاقاً.'
            : 'Only shown to guests recognised by their membership card.'}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="ads-minvisits">{ar ? 'أقل عدد زيارات' : 'Minimum visits'}</label>
        <input
          id="ads-minvisits"
          className="input"
          type="number"
          min="0"
          max="999"
          value={ad.audience.minVisits}
          onChange={(e) => audience({ minVisits: Number(e.target.value) })}
        />
        <span className="ads-hint">
          {ad.audience.minVisits > 0
            ? (ar
              ? `لن يظهر إلا لمن زار المكان ${num(ad.audience.minVisits)} مرة أو أكثر.`
              : `Shown from visit ${ad.audience.minVisits} onward.`)
            : (ar ? 'صفر يعني بلا شرط على عدد الزيارات.' : 'Zero means no visit condition.')}
        </span>
      </div>
    </>
  )
}
