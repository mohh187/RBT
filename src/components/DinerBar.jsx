import { useI18n } from '../lib/i18n.jsx'
import { resolveSkin } from '../lib/skins.js'
import { resolveMenuHeader, resolveShadows, resolveChrome } from '../lib/dishComposition.js'
import Icon from './Icon.jsx'

// Top app bar for diner-facing pages (venue name + language/theme toggles).
// The active skin (or a manual override) chooses the header style via `data-header`;
// 'none' removes the bar entirely and leaves only floating language/theme toggles.
//
// THE BAR IS THE VENUE'S NOW (resolveMenuHeader): it can wear the venue's own
// photograph under a readability veil, and every element it carries — logo,
// name, language, theme — is individually the venue's to keep or drop. The
// brick mode is NOT painted here: it is dressed from outside by the editorial
// engine's chrome vars (see headerBrickVars), because the brick is the wall's.
export default function DinerBar({ tenant, right }) {
  const { toggleLang, toggleTheme, theme, lang } = useI18n()
  const head = resolveSkin(tenant, 'menu')?.layout?.header || 'classic'
  const hd = resolveMenuHeader(tenant)
  // Over a custom background/banner the header controls need a readable backing.
  const overBg = !!(tenant?.bgImageUrl || tenant?.bgVideoUrl || tenant?.bgGradient || tenant?.bannerUrl)

  // menuChrome reaches the bar here only for its custom uploaded ICONS — the
  // button FACES ride body-level --mch-* vars stamped by ChromeSkin, and the
  // .db-lang / .db-theme classes below are the hooks its CSS half targets
  // (body[data-mch-lang] .icon-btn.db-lang, same in the floating variant).
  const mch = resolveChrome(tenant)
  const langIcon = mch?.elements?.langBtn?.icon || ''
  const themeIcon = mch?.elements?.themeBtn?.icon || ''

  const langBtn = hd.show.lang
    ? <button className="icon-btn db-lang" onClick={toggleLang} aria-label="language" style={{ fontWeight: 800, fontSize: 13 }}>{langIcon ? <img className="mch-icon" src={langIcon} alt="" /> : (lang === 'ar' ? 'EN' : 'ع')}</button>
    : null
  const themeBtn = hd.show.theme
    ? <button className="icon-btn db-theme" onClick={toggleTheme} aria-label="theme">{themeIcon ? <img className="mch-icon" src={themeIcon} alt="" /> : <Icon name={theme === 'dark' ? 'sun' : 'moon'} />}</button>
    : null

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

  const img = hd.mode === 'image'
  // The header shadow dial rides the bar (--hd-sh) because .app-bar-img exists
  // for every theme; the resolver runs only when the image face is actually on
  // (dead work on every other header render otherwise).
  const sh = img ? resolveShadows(tenant) : null
  const imgVars = img ? {
    '--hd-img': `url("${hd.url.replace(/["\\]/g, '')}")`,
    '--hd-scrim': hd.scrim,
    '--hd-blur': `${hd.blur}px`,
    '--hd-pos': hd.pos,
    '--hd-sh': sh ? sh.header : 1,
  } : undefined

  return (
    <header className={`app-bar${overBg ? ' app-bar-overbg' : ''}${img ? ' app-bar-img' : ''}`} data-header={head} style={imgVars}>
      <span className="db-brand">
        {hd.show.logo ? (
          tenant?.logoUrl ? (
            <img src={tenant.logoUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <span className="dot" style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--brand)', color: 'var(--on-brand)', display: 'grid', placeItems: 'center' }}>
              <Icon name="coffee" size={16} />
            </span>
          )
        ) : null}
        {hd.show.name ? <strong>{tenant?.name || 'RBT360'}</strong> : null}
      </span>
      <div className="grow" />
      {right}
      {langBtn}
      {themeBtn}
    </header>
  )
}
