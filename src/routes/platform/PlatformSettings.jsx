// PlatformSettings.jsx (/platform/settings) — platform-admin preferences.
// Toggle hidden Overview widgets, notification severity filter, UI density,
// and view keyboard shortcuts. Persisted locally via platformPrefs (no Firestore).
import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useToast } from '../../components/Toast.jsx'
import {
  getPrefs,
  setPrefs,
  toggleHiddenWidget,
  OVERVIEW_WIDGETS,
} from '../../lib/platformPrefs.js'

const SEVERITIES = [
  { id: 'high', ar: 'حرِجة', badge: 'badge-danger' },
  { id: 'warn', ar: 'تحذيرات', badge: 'badge-warning' },
  { id: 'info', ar: 'معلومات', badge: 'badge-info' },
]

const SHORTCUTS = [
  { keys: 'Ctrl / Cmd + K', ar: 'فتح لوحة الأوامر (الانتقال السريع)' },
  { keys: 'Esc', ar: 'إغلاق لوحة الأوامر أو النافذة' },
  { keys: '↑ / ↓', ar: 'التنقل بين النتائج داخل لوحة الأوامر' },
  { keys: 'Enter', ar: 'فتح العنصر المحدد' },
]

function Toggle({ on, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="row-between"
      style={{
        width: '100%',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-2) var(--sp-3)',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        cursor: 'pointer',
        color: 'var(--text)',
      }}
    >
      <span className="grow" style={{ textAlign: 'start' }}>{label}</span>
      <span
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: on ? 'var(--brand)' : 'var(--surface-2)',
          border: '1px solid var(--border)',
          position: 'relative',
          transition: 'background .15s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            insetInlineStart: on ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: on ? 'var(--on-brand)' : 'var(--text-faint)',
            transition: 'inset-inline-start .15s',
          }}
        />
      </span>
    </button>
  )
}

export default function PlatformSettings() {
  const toast = useToast()
  const [prefs, setLocal] = useState(getPrefs())

  function refresh(next) {
    setLocal({ ...next })
  }

  function onToggleWidget(id) {
    refresh(toggleHiddenWidget(id))
  }

  function onToggleSev(id) {
    const notifFilter = { ...prefs.notifFilter, [id]: !prefs.notifFilter[id] }
    refresh(setPrefs({ notifFilter }))
  }

  function onDensity(density) {
    refresh(setPrefs({ density }))
    toast.success('تم حفظ التفضيل')
  }

  return (
    <div className="page">
      <div className="row-between" style={{ marginBottom: 'var(--sp-4)' }}>
        <h1 className="page-title">
          <Icon name="settings" size={20} /> إعدادات لوحة التحكم
        </h1>
      </div>

      {/* Overview widgets visibility */}
      <div className="card card-pad" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <Icon name="grid" size={18} />
          <div>
            <div className="bold">عناصر النظرة العامة</div>
            <div className="small muted">أخفِ البطاقات التي لا تحتاجها في الصفحة الرئيسية.</div>
          </div>
        </div>
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {OVERVIEW_WIDGETS.map((w) => {
            const hidden = prefs.hiddenWidgets.includes(w.id)
            return (
              <Toggle
                key={w.id}
                on={!hidden}
                onClick={() => onToggleWidget(w.id)}
                label={w.ar}
              />
            )
          })}
        </div>
        <div className="xs faint" style={{ marginTop: 'var(--sp-2)' }}>
          المُفعّل = ظاهر. تُطبَّق التفضيلات على هذا المتصفح فقط.
        </div>
      </div>

      {/* Notification severity filter */}
      <div className="card card-pad" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <Icon name="bell" size={18} />
          <div>
            <div className="bold">مرشّح التنبيهات</div>
            <div className="small muted">اختر مستويات الخطورة التي تريد رؤيتها.</div>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {SEVERITIES.map((s) => {
            const on = !!prefs.notifFilter[s.id]
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onToggleSev(s.id)}
                className={`chip ${on ? '' : ''}`}
                aria-pressed={on}
                style={{
                  cursor: 'pointer',
                  border: '1px solid var(--border)',
                  opacity: on ? 1 : 0.45,
                  padding: 'var(--sp-2) var(--sp-3)',
                }}
              >
                <span className={`badge ${s.badge}`} style={{ marginInlineEnd: 6 }}>{s.ar}</span>
                {on ? 'ظاهر' : 'مخفي'}
              </button>
            )
          })}
        </div>
      </div>

      {/* Density */}
      <div className="card card-pad" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <Icon name="list" size={18} />
          <div>
            <div className="bold">كثافة العرض</div>
            <div className="small muted">تحكّم بتباعد العناصر في الجداول والقوائم.</div>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          {[
            { id: 'comfortable', ar: 'مريح' },
            { id: 'compact', ar: 'مضغوط' },
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onDensity(d.id)}
              className={prefs.density === d.id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
            >
              {d.ar}
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="card card-pad">
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <Icon name="key" size={18} />
          <div>
            <div className="bold">اختصارات لوحة المفاتيح</div>
            <div className="small muted">للتنقل الأسرع داخل لوحة التحكم.</div>
          </div>
        </div>
        <div className="divide">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="row-between list-row" style={{ padding: 'var(--sp-2) 0' }}>
              <span>{s.ar}</span>
              <span
                className="xs bold num"
                style={{
                  direction: 'ltr',
                  padding: '2px 8px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.keys}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
