import { useI18n } from '../lib/i18n.jsx'
import { resolveSkin } from '../lib/skins.js'
import Icon from './Icon.jsx'

// Top app bar for diner-facing pages (venue name + language/theme toggles).
// The active skin (or a manual override) chooses the header style via `data-header`;
// 'none' removes the bar entirely and leaves only floating language/theme toggles.
export default function DinerBar({ tenant, right }) {
  const { toggleLang, toggleTheme, theme, lang } = useI18n()
  const head = resolveSkin(tenant, 'menu')?.layout?.header || 'classic'
  // Over a custom background/banner the header controls need a readable backing.
  const overBg = !!(tenant?.bgImageUrl || tenant?.bgVideoUrl || tenant?.bgGradient || tenant?.bannerUrl)

  const langBtn = <button className="icon-btn" onClick={toggleLang} aria-label="language" style={{ fontWeight: 800, fontSize: 13 }}>{lang === 'ar' ? 'EN' : 'ع'}</button>
  const themeBtn = <button className="icon-btn" onClick={toggleTheme} aria-label="theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>

  // No-header style: drop the bar, keep floating controls so language/theme still work.
  if (head === 'none') {
    return (
      <div className="db-floating">
        {right}
        {langBtn}
        {themeBtn}
      </div>
    )
  }

  return (
    <header className={`app-bar${overBg ? ' app-bar-overbg' : ''}`} data-header={head}>
      <span className="db-brand">
        {tenant?.logoUrl ? (
          <img src={tenant.logoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <span className="dot" style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="coffee" size={16} />
          </span>
        )}
        <strong>{tenant?.name || 'RBT360'}</strong>
      </span>
      <div className="grow" />
      {right}
      {langBtn}
      {themeBtn}
    </header>
  )
}
