// Keep <meta name="theme-color"> synced to the REAL page background so mobile
// browser chrome (iOS Safari's top status bar + bottom toolbar, Android address
// bar) blends with the app instead of showing a jarring white band top & bottom.
// A single static theme-color can't match a themeable, multi-skin app — so we
// mirror the live computed background and re-apply whenever a theme/skin/appbg
// attribute flips on <html> or <body>.
export function initThemeColorSync() {
  let meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  const opaque = (c) => c && c !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(c)
  const apply = () => {
    try {
      // body first (skins paint it); fall back to html (--bg, always opaque)
      const bodyBg = getComputedStyle(document.body).backgroundColor
      const htmlBg = getComputedStyle(document.documentElement).backgroundColor
      const bg = opaque(bodyBg) ? bodyBg : opaque(htmlBg) ? htmlBg : '#ffffff'
      if (bg && bg !== meta.getAttribute('content')) meta.setAttribute('content', bg)
    } catch (_) { /* ignore */ }
  }
  apply()
  const attrs = ['data-theme', 'data-systheme', 'data-sysvariant', 'data-custheme', 'data-skin', 'data-menuglass', 'data-appbg', 'style', 'class']
  const obs = new MutationObserver(apply)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: attrs })
  obs.observe(document.body, { attributes: true, attributeFilter: attrs })
  window.addEventListener('load', apply)
  // skins/fonts load async after first paint → re-apply shortly after boot
  setTimeout(apply, 400)
  setTimeout(apply, 1500)
}
