// platformPrefs.js — localStorage-backed preferences for the platform admin
// console (no Firestore). Controls which Overview widgets are hidden, the
// notification severity filter, and UI density. Safe JSON parse with defaults.

const KEY = 'rbt360.platformPrefs.v1'

const DEFAULTS = {
  hiddenWidgets: [], // array of widget ids the admin chose to hide on Overview
  notifFilter: { high: true, warn: true, info: true },
  density: 'comfortable', // 'comfortable' | 'compact'
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

export function getPrefs() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return clone(DEFAULTS)
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return clone(DEFAULTS)
    // Merge defensively so new default keys always exist.
    return {
      ...clone(DEFAULTS),
      ...parsed,
      hiddenWidgets: Array.isArray(parsed.hiddenWidgets) ? parsed.hiddenWidgets : [],
      notifFilter: { ...DEFAULTS.notifFilter, ...(parsed.notifFilter || {}) },
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
    }
  } catch {
    return clone(DEFAULTS)
  }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...(patch || {}) }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore write failures (private mode / quota)
  }
  return next
}

// Convenience toggles used by the settings screen.
export function toggleHiddenWidget(id) {
  const cur = getPrefs()
  const set = new Set(cur.hiddenWidgets)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  return setPrefs({ hiddenWidgets: [...set] })
}

export function isWidgetHidden(id) {
  return getPrefs().hiddenWidgets.includes(id)
}

// The catalog of Overview widgets that can be hidden. Kept here so the settings
// screen (and Overview, later) share one source of truth.
export const OVERVIEW_WIDGETS = [
  { id: 'stats', ar: 'بطاقات الإحصائيات' },
  { id: 'activity', ar: 'سجل النشاط' },
  { id: 'errors', ar: 'الأخطاء الأخيرة' },
  { id: 'issues', ar: 'التذاكر المفتوحة' },
  { id: 'chat', ar: 'محادثات المنشآت' },
  { id: 'growth', ar: 'مؤشرات النمو' },
]

export const DEFAULT_PREFS = DEFAULTS
