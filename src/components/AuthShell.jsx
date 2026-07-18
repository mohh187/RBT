import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n.jsx'
import { BrandMark } from './ui.jsx'
import Icon from './Icon.jsx'
import '../landing.css'

// Clean split auth: a LIGHT, airy showcase panel (logo, a framed product
// screenshot, a short value line) beside the form. Collapses to a single centered
// column on mobile. Shared by Login + Signup so both stay consistent.
export default function AuthShell({ title, subtitle, err, foot, children }) {
  const { lang, toggleLang, theme, toggleTheme } = useI18n()
  const ar = lang === 'ar'
  const L = (a, e) => (ar ? a : e)
  const [shotOk, setShotOk] = useState(true)

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
          {shotOk && (
            <div className="rlauth-device">
              <img src="/marketing/menu.jpg" alt={L('منيو حقيقي من النظام', 'A live menu from the system')} onError={() => setShotOk(false)} />
            </div>
          )}
          <div className="rlauth-show-copy">
            <h2 className="rlauth-h">{L('شغّل مقهاك كله من مكان واحد', 'Run your whole café from one place')}</h2>
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
