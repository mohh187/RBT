import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n.jsx'
import { BrandMark } from './ui.jsx'
import Icon from './Icon.jsx'
import '../landing.css'

// The full ecosystem drawn in CSS: a touch POS terminal with live categories
// and a ticket, a kitchen tablet, and the guest's phone — the three screens a
// venue actually runs on. Decorative (aria-hidden), theme-aware via the shared
// rlauth tokens, RTL-correct via logical properties, Latin digits only.
function EcosystemMock({ L }) {
  const tiles = [
    [L('لاتيه', 'Latte'), 15], [L('موهيتو', 'Mojito'), 18], [L('كروسان', 'Croissant'), 12],
    [L('تشيز كيك', 'Cheesecake'), 22], [L('أمريكانو', 'Americano'), 11], [L('فلات وايت', 'Flat white'), 14],
  ]
  return (
    <div className="eco" aria-hidden="true">
      <div className="eco-pos">
        <span className="eco-tag">{L('كاشير باللمس', 'Touch POS')}</span>
        <div className="eco-screen">
          <div className="eco-head">
            <i className="eco-dot" />{L('نقطة البيع', 'Point of sale')}
            <span className="eco-head-tabs"><b>{L('الكل', 'All')}</b><span>{L('قهوة', 'Coffee')}</span><span>{L('حلى', 'Desserts')}</span></span>
          </div>
          <div className="eco-body">
            <div className="eco-grid">
              {tiles.map(([n, p]) => (
                <div key={n} className="eco-tile"><i /><b>{n}</b><span className="num">{p}</span></div>
              ))}
            </div>
            <div className="eco-ticket">
              <div className="eco-trow"><span>{L('لاتيه ×2', 'Latte ×2')}</span><span className="num">30</span></div>
              <div className="eco-trow"><span>{L('تشيز كيك', 'Cheesecake')}</span><span className="num">22</span></div>
              <div className="eco-trow eco-total"><span>{L('الإجمالي', 'Total')}</span><span className="num">52</span></div>
              <div className="eco-pay">{L('دفع', 'Pay')}</div>
            </div>
          </div>
        </div>
        <div className="eco-neck" />
        <div className="eco-base" />
      </div>
      <div className="eco-tab">
        <span className="eco-tag">{L('شاشة المطبخ', 'Kitchen display')}</span>
        <div className="eco-kds">
          <div className="eco-korder">
            <div className="eco-krow"><b className="num">#124</b><span className="eco-kchip is-new">{L('جديد', 'New')}</span></div>
            <p>{L('لاتيه ×2 · كروسان', 'Latte ×2 · Croissant')}</p>
          </div>
          <div className="eco-korder">
            <div className="eco-krow"><b className="num">#123</b><span className="eco-kchip is-done">{L('جاهز', 'Ready')}</span></div>
            <p>{L('موهيتو · تشيز كيك', 'Mojito · Cheesecake')}</p>
          </div>
        </div>
      </div>
      <div className="eco-phone">
        <span className="eco-tag">{L('منيو العميل', 'Guest menu')}</span>
        <div className="eco-pscreen">
          <div className="eco-pill" />
          <div className="eco-prow"><i /><span>{L('لاتيه', 'Latte')}</span><b>+</b></div>
          <div className="eco-prow"><i /><span>{L('موهيتو', 'Mojito')}</span><b>+</b></div>
          <div className="eco-prow"><i /><span>{L('كروسان', 'Croissant')}</span><b>+</b></div>
          <div className="eco-cta">{L('اطلب الآن', 'Order now')}</div>
        </div>
      </div>
    </div>
  )
}

// Clean split auth: a LIGHT, airy showcase panel (logo, the drawn ecosystem,
// a short value line) beside the form. Collapses to a single centered
// column on mobile. Shared by Login + Signup so both stay consistent.
export default function AuthShell({ title, subtitle, err, foot, children }) {
  const { lang, toggleLang, theme, toggleTheme } = useI18n()
  const ar = lang === 'ar'
  const L = (a, e) => (ar ? a : e)

  const props = [
    L('بدون أي عمولة على طلباتك', 'Zero commission on your orders'),
    L('كاشير ومطبخ ومخزون لحظي', 'Live cashier, kitchen & inventory'),
    L('مساعد ذكي وتخصيص كامل', 'AI assistant & full customization'),
  ]

  return (
    <div className="rlauth">
      <aside className="rlauth-show">
        <div className="rlauth-show-brand"><BrandMark /></div>
        <div className="rlauth-show-mid">
          <EcosystemMock L={L} />
          <div className="rlauth-show-copy">
            <h2 className="rlauth-h">{L('منظومة واحدة تدير كل شيء — من شاشة الكاشير إلى جوال عميلك', "One system running it all — from the cashier's screen to your customer's phone")}</h2>
            <ul className="rlauth-props">
              {props.map((p) => (<li key={p}><Icon name="check" size={15} className="ic" />{p}</li>))}
            </ul>
          </div>
        </div>
        <p className="rlauth-fine">{L('عربي أولاً · فوترة متوافقة مع زاتكا (ZATCA)', 'Arabic-first · ZATCA-ready invoicing')}</p>
      </aside>

      <main className="rlauth-main">
        <div className="rlauth-top">
          <Link to="/"><Icon name="home" size={15} />{L('الرئيسية', 'Home')}</Link>
          <div className="rlauth-top-btns">
            <button onClick={toggleTheme} aria-label="theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /></button>
            <button onClick={toggleLang} aria-label="language">{ar ? 'EN' : 'ع'}</button>
          </div>
        </div>
        <div className="rlauth-card">
          <div className="rlauth-logo-m"><BrandMark /></div>
          <h1 className="rlauth-title">{title}</h1>
          {subtitle && <p className="rlauth-sub">{subtitle}</p>}
          {err && <div className="rlauth-err"><Icon name="warning" size={16} /><span>{err}</span></div>}
          {children}
          {foot && <p className="rlauth-foot">{foot}</p>}
        </div>
      </main>
    </div>
  )
}

// Password field with a show/hide toggle.
export function PasswordInput({ value, onChange, autoComplete, minLength, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="rlauth-pass">
      <input className="input" type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} minLength={minLength} placeholder={placeholder} required />
      <button type="button" className="rlauth-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'hide' : 'show'} tabIndex={-1}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </div>
  )
}
