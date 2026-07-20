// «التوقيت» + «الجدولة» + «التكرار» — when the ad fires, on which days and
// hours it is allowed to fire at all, and how often one guest may see it.
//
// Each control renders a plain-language sentence of what it currently means,
// because "session" and "cap per day" are exactly the settings venues get
// wrong and then blame on the product.
import Icon from '../Icon.jsx'
import { TRIGGERS, FREQUENCIES } from '../../lib/ads.js'

const num = (n) => Number(n || 0).toLocaleString('ar-SA-u-nu-latn')

// JS getDay(): 0 = Sunday.
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AdSchedule({ ad, onChange, lang = 'ar' }) {
  const ar = lang !== 'en'
  const trigger = (patch) => onChange({ ...ad, trigger: { ...ad.trigger, ...patch } })
  const schedule = (patch) => onChange({ ...ad, schedule: { ...ad.schedule, ...patch } })
  const frequency = (patch) => onChange({ ...ad, frequency: { ...ad.frequency, ...patch } })

  const toggleDay = (d) => {
    const cur = ad.schedule.daysOfWeek || []
    schedule({ daysOfWeek: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b) })
  }

  const on = ad.trigger.on
  const overnight = ad.schedule.startTime && ad.schedule.endTime && ad.schedule.startTime > ad.schedule.endTime

  return (
    <>
      <div>
        <h4>{ar ? 'متى يظهر' : 'Trigger'}</h4>
      </div>
      <div className="ads-steps">
        {TRIGGERS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip${on === t.id ? ' active' : ''}`}
            onClick={() => trigger({ on: t.id })}
          >
            <Icon name={t.icon} size={15} />
            {ar ? t.ar : t.en}
          </button>
        ))}
      </div>

      {on === 'delay' ? (
        <div className="ads-range">
          <span>
            <b>{ar ? 'بعد كم ثانية من فتح القائمة' : 'Seconds after opening'}</b>
            <b>{num(ad.trigger.delaySec)}</b>
          </span>
          <input
            type="range"
            min="1"
            max="60"
            value={ad.trigger.delaySec}
            onChange={(e) => trigger({ delaySec: Number(e.target.value) })}
          />
        </div>
      ) : null}

      {on === 'scroll' ? (
        <div className="ads-range">
          <span>
            <b>{ar ? 'بعد تمرير هذه النسبة من القائمة' : 'Scroll depth'}</b>
            <b>{`${num(ad.trigger.scrollPct)}%`}</b>
          </span>
          <input
            type="range"
            min="5"
            max="100"
            step="5"
            value={ad.trigger.scrollPct}
            onChange={(e) => trigger({ scrollPct: Number(e.target.value) })}
          />
        </div>
      ) : null}

      {on === 'exit' ? (
        <div className="ads-warn">
          <Icon name="warning" size={16} />
          <span>
            {ar
              ? 'نية المغادرة تُقاس بخروج مؤشر الفأرة من أعلى الصفحة — وهذا لا يوجد على الجوال. على الأجهزة اللمسية يظهر الإعلان بعد خمس وعشرين ثانية من البقاء في القائمة بدلاً من ذلك.'
              : 'Exit intent needs a mouse. On touch devices the ad falls back to a 25 second dwell timer.'}
          </span>
        </div>
      ) : null}

      {/* ---- schedule ---- */}
      <div>
        <h4>{ar ? 'فترة الحملة' : 'Campaign window'}</h4>
        <p className="ads-hint">
          {ar ? 'اترك الحقول فارغة ليعمل الإعلان بلا حد زمني.' : 'Leave empty for no limit.'}
        </p>
      </div>
      <div className="ads-grid2">
        <div className="field">
          <label htmlFor="ads-from">{ar ? 'من تاريخ' : 'From'}</label>
          <input
            id="ads-from"
            className="input"
            type="date"
            value={ad.schedule.from}
            onChange={(e) => schedule({ from: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="ads-to">{ar ? 'إلى تاريخ' : 'To'}</label>
          <input
            id="ads-to"
            className="input"
            type="date"
            value={ad.schedule.to}
            onChange={(e) => schedule({ to: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label>{ar ? 'أيام الأسبوع' : 'Days of week'}</label>
        <div className="ads-days">
          {(ar ? DAYS_AR : DAYS_EN).map((d, i) => (
            <button
              key={d}
              type="button"
              className={`ads-day${(ad.schedule.daysOfWeek || []).includes(i) ? ' active' : ''}`}
              onClick={() => toggleDay(i)}
              aria-pressed={(ad.schedule.daysOfWeek || []).includes(i)}
            >
              {d}
            </button>
          ))}
        </div>
        <span className="ads-hint">
          {(ad.schedule.daysOfWeek || []).length
            ? (ar ? 'يظهر في الأيام المحددة فقط.' : 'Selected days only.')
            : (ar ? 'لم يُحدد يوم — يظهر كل أيام الأسبوع.' : 'No day selected: every day.')}
        </span>
      </div>

      <div className="ads-grid2">
        <div className="field">
          <label htmlFor="ads-start">{ar ? 'من الساعة' : 'From time'}</label>
          <input
            id="ads-start"
            className="input"
            type="time"
            value={ad.schedule.startTime}
            onChange={(e) => schedule({ startTime: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="ads-end">{ar ? 'إلى الساعة' : 'To time'}</label>
          <input
            id="ads-end"
            className="input"
            type="time"
            value={ad.schedule.endTime}
            onChange={(e) => schedule({ endTime: e.target.value })}
          />
        </div>
      </div>
      {overnight ? (
        <p className="ads-hint">
          {ar
            ? 'نافذة تمتد بعد منتصف الليل — سيظهر من وقت البداية حتى وقت النهاية في اليوم التالي.'
            : 'This window crosses midnight and will run into the next day.'}
        </p>
      ) : null}

      {/* ---- frequency ---- */}
      <div>
        <h4>{ar ? 'كم مرة يراه الضيف الواحد' : 'Frequency'}</h4>
        <p className="ads-hint">
          {ar
            ? 'يُحسب في متصفح الضيف نفسه. من يمسح بيانات المتصفح أو يفتح القائمة من جهاز آخر قد يراه من جديد — لا توجد حسابات للضيوف تربط الأمرين.'
            : 'Counted in the guest browser; clearing storage resets it.'}
        </p>
      </div>
      <div className="ads-steps">
        {FREQUENCIES.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip${ad.frequency.perGuest === f.id ? ' active' : ''}`}
            onClick={() => frequency({ perGuest: f.id })}
          >
            <Icon name={f.icon} size={15} />
            {ar ? f.ar : f.en}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="ads-cap">{ar ? 'حد أقصى للظهور في اليوم' : 'Daily cap'}</label>
        <input
          id="ads-cap"
          className="input"
          type="number"
          min="0"
          max="50"
          value={ad.frequency.capPerDay}
          onChange={(e) => frequency({ capPerDay: Number(e.target.value) })}
        />
        <span className="ads-hint">
          {ad.frequency.capPerDay > 0
            ? (ar
              ? `لن يظهر لنفس الضيف أكثر من ${num(ad.frequency.capPerDay)} مرة في اليوم الواحد.`
              : `At most ${ad.frequency.capPerDay} times a day per guest.`)
            : (ar ? 'صفر يعني بلا حد يومي إضافي.' : 'Zero means no extra daily cap.')}
        </span>
      </div>
    </>
  )
}
