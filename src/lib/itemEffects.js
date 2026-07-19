// Visual live effects for menu items («مؤثرات الأصناف»): steam over hot
// drinks, bubbles on sodas, sparkles on desserts… Rendered by <ItemFx/> as a
// pure-CSS particle overlay on the item photo (menu detail + spotlight cards)
// and over the in-app 3D viewer. HONEST LIMIT: real camera AR (Scene Viewer /
// Quick Look) shows the bare GLB only — overlays cannot follow the model there.

export const ITEM_EFFECTS = [
  { id: '', ar: 'بدون مؤثر', en: 'None' },
  { id: 'steam', ar: 'بخار (مشروب ساخن)', en: 'Steam' },
  { id: 'smoke', ar: 'دخان كثيف', en: 'Smoke' },
  { id: 'sparkle', ar: 'لمعان وشرر ذهبي', en: 'Sparkle' },
  { id: 'bubbles', ar: 'فقاعات (مشروب بارد)', en: 'Bubbles' },
  { id: 'frost', ar: 'برودة وثلج', en: 'Frost' },
  { id: 'fire', ar: 'توهج لهب', en: 'Fire glow' },
]

export const EFFECT_IDS = ITEM_EFFECTS.map((e) => e.id).filter(Boolean)

export function effectLabel(id, lang = 'ar') {
  const e = ITEM_EFFECTS.find((x) => x.id === id)
  return e ? (lang === 'ar' ? e.ar : e.en) : ''
}
