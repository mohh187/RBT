import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePortalRoot } from './PortalRoot.jsx'
import { pickLang } from '../lib/i18n.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'

/**
 * CompareItems — «قارن الأصناف».
 *
 * Two-step: pick 2-3 dishes (searchable), then read them side by side. Every
 * numeric row nominates a winner («الأقل سعراً» / «الأقل سعرات» / «الأسرع» /
 * «الأعلى تقييماً»); rows where all dishes agree are dimmed so the eye lands
 * only on real differences. Rows nobody has a value for are dropped entirely.
 *
 * MOBILE / RTL: the comparison is a set of CSS-grid rows inside one horizontal
 * snap scroller. The label cell of every row is `position: sticky` on the
 * INLINE-START edge, so it pins to the right in Arabic and to the left in
 * English without any direction branching in JS.
 */

const MAX = 3
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const basePrice = (it) => (it?.price != null ? it.price : (it?.variants && it.variants[0] ? it.variants[0].price : null))

function variantRange(it) {
  const list = (it?.variants || []).map((v) => num(v?.price)).filter((v) => v != null)
  if (!list.length) return null
  return { min: Math.min(...list), max: Math.max(...list), count: list.length }
}

export default function CompareItems({ open, onClose, items = [], preselected = [], lang = 'ar', currency = 'SAR', onOpenItem }) {
  const ar = lang === 'ar'
  const root = usePortalRoot()
  const [picked, setPicked] = useState([])
  const [picking, setPicking] = useState(true)
  const [q, setQ] = useState('')

  const pool = useMemo(
    () => (Array.isArray(items) ? items : []).filter((it) => it && it.id && it.available !== false),
    [items],
  )
  const byId = useMemo(() => {
    const m = {}
    for (const it of pool) m[it.id] = it
    return m
  }, [pool])

  // Seed from the caller's preselection every time the sheet opens.
  useEffect(() => {
    if (!open) return
    const seed = (Array.isArray(preselected) ? preselected : [])
      .map((p) => (typeof p === 'string' ? p : p?.id))
      .filter((id) => id && byId[id])
      .slice(0, MAX)
    setPicked(seed)
    setPicking(seed.length < 2)
    setQ('')
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const list = useMemo(() => picked.map((id) => byId[id]).filter(Boolean), [picked, byId])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return pool.slice(0, 60)
    return pool.filter((it) => `${it.nameAr || ''} ${it.nameEn || ''}`.toLowerCase().includes(needle)).slice(0, 60)
  }, [pool, q])

  const toggle = (id) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX) return prev
      return [...prev, id]
    })
  }

  // Row model: `value` drives winner/equality logic, `cell` draws it.
  const rows = useMemo(() => [
    {
      key: 'price',
      label: ar ? 'السعر' : 'Price',
      better: 'min',
      chip: ar ? 'الأقل سعراً' : 'Cheapest',
      value: (it) => num(basePrice(it)),
      cell: (it) => (basePrice(it) != null ? <Price value={basePrice(it)} currency={currency} lang={lang} /> : null),
    },
    {
      key: 'calories',
      label: ar ? 'السعرات' : 'Calories',
      better: 'min',
      chip: ar ? 'الأقل سعرات' : 'Lightest',
      value: (it) => num(it.calories),
      cell: (it) => (num(it.calories) != null ? <span className="cmp-num">{num(it.calories)} <i>{ar ? 'سعرة' : 'cal'}</i></span> : null),
    },
    {
      key: 'prepTime',
      label: ar ? 'وقت التحضير' : 'Prep time',
      better: 'min',
      chip: ar ? 'الأسرع' : 'Fastest',
      value: (it) => num(it.prepTime),
      cell: (it) => (num(it.prepTime) != null ? <span className="cmp-num">{num(it.prepTime)} <i>{ar ? 'دقيقة' : 'min'}</i></span> : null),
    },
    {
      key: 'rating',
      label: ar ? 'التقييم' : 'Rating',
      better: 'max',
      chip: ar ? 'الأعلى تقييماً' : 'Top rated',
      value: (it) => num(it.rating),
      cell: (it) => (num(it.rating) != null ? (
        <span className="cmp-num cmp-rate"><Icon name="star" size={14} fill="currentColor" strokeWidth={1.5} /> {num(it.rating)}</span>
      ) : null),
    },
    {
      key: 'serves',
      label: ar ? 'يكفي' : 'Serves',
      value: (it) => num(it.serves),
      cell: (it) => (num(it.serves) != null ? <span className="cmp-num">{num(it.serves)} <i>{ar ? 'شخص' : 'ppl'}</i></span> : null),
    },
    {
      key: 'sizes',
      label: ar ? 'الأحجام' : 'Sizes',
      value: (it) => {
        const r = variantRange(it)
        return r ? `${r.count}:${r.min}-${r.max}` : null
      },
      cell: (it) => {
        const r = variantRange(it)
        if (!r) return null
        return (
          <span className="cmp-sizes">
            <b>{r.count} {ar ? 'أحجام' : 'sizes'}</b>
            <span className="cmp-range">
              <Price value={r.min} currency={currency} lang={lang} />
              {r.max !== r.min ? <> <em>—</em> <Price value={r.max} currency={currency} lang={lang} /></> : null}
            </span>
          </span>
        )
      },
    },
    {
      key: 'ingredients',
      label: ar ? 'المكونات' : 'Ingredients',
      value: (it) => {
        const names = (it.ingredients || []).map((g) => pickLang(g, 'name', lang)).filter(Boolean)
        return names.length ? names.join('|') : null
      },
      cell: (it) => {
        const names = (it.ingredients || []).map((g) => pickLang(g, 'name', lang)).filter(Boolean)
        if (!names.length) return null
        return <span className="cmp-tags">{names.map((n, i) => <i key={i}>{n}</i>)}</span>
      },
    },
    {
      key: 'allergens',
      label: ar ? 'مسببات الحساسية' : 'Allergens',
      value: (it) => (it.allergens ? String(it.allergens) : null),
      cell: (it) => (it.allergens ? <span className="cmp-allerg"><Icon name="warning" size={13} /> {it.allergens}</span> : null),
    },
  ], [ar, lang, currency])

  if (!open || !root) return null

  const stats = (row) => {
    const vals = list.map(row.value)
    const present = vals.filter((v) => v !== null && v !== undefined && v !== '')
    if (!present.length) return null // nobody has it — drop the row
    const same = present.length === list.length && new Set(present.map(String)).size === 1
    let winner = -1
    if (row.better && present.length >= 2 && new Set(present.map(Number)).size > 1) {
      vals.forEach((v, i) => {
        if (v === null || v === undefined || v === '') return
        if (winner < 0) { winner = i; return }
        const d = Number(v) - Number(vals[winner])
        if (row.better === 'min' ? d < 0 : d > 0) winner = i
      })
    }
    return { same, winner }
  }

  const ready = list.length >= 2
  const gridVars = { '--cmp-n': Math.max(1, list.length) }

  return createPortal(
    <div className="cmp" role="dialog" aria-modal="true" aria-label={ar ? 'قارن الأصناف' : 'Compare items'}>
      <header className="cmp-head">
        <div className="cmp-title">
          <Icon name="scale" size={18} />
          <span>{ar ? 'قارن الأصناف' : 'Compare items'}</span>
        </div>
        <button type="button" className="cmp-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
          <Icon name="close" size={20} />
        </button>
      </header>

      {picking || !ready ? (
        <>
          <div className="cmp-pickbar">
            <p className="cmp-hint">
              {ar ? `اختر صنفين إلى ${MAX} أصناف للمقارنة` : `Pick 2 to ${MAX} items to compare`}
              <b> {list.length} / {MAX}</b>
            </p>
            <label className="cmp-search">
              <Icon name="search" size={17} />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={ar ? 'ابحث عن صنف…' : 'Search an item…'}
                aria-label={ar ? 'بحث' : 'Search'}
              />
            </label>
          </div>

          <div className="cmp-picklist">
            {results.length === 0 ? (
              <p className="cmp-none">{ar ? 'لا نتائج مطابقة' : 'No matches'}</p>
            ) : results.map((it) => {
              const on = picked.includes(it.id)
              const full = !on && picked.length >= MAX
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`cmp-pick ${on ? 'on' : ''}`}
                  onClick={() => toggle(it.id)}
                  disabled={full}
                  aria-pressed={on}
                >
                  <span className="cmp-pick-th">
                    {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <Icon name="menu" size={18} />}
                  </span>
                  <span className="cmp-pick-nm">{pickLang(it, 'name', lang)}</span>
                  {basePrice(it) != null ? (
                    <span className="cmp-pick-pr"><Price value={basePrice(it)} currency={currency} lang={lang} /></span>
                  ) : null}
                  <span className="cmp-pick-ck" aria-hidden="true">{on ? <Icon name="check" size={15} /> : null}</span>
                </button>
              )
            })}
          </div>

          <footer className="cmp-foot">
            <button type="button" className="cmp-cta" disabled={!ready} onClick={() => setPicking(false)}>
              <Icon name="scale" size={17} />
              <span>{ar ? 'قارن' : 'Compare'}</span>
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="cmp-scroll">
            <div className="cmp-grid" style={gridVars}>
              <div className="cmp-r cmp-r-head">
                <div className="cmp-l cmp-l-head" />
                {list.map((it) => (
                  <div className="cmp-c cmp-c-head" key={it.id}>
                    <div className="cmp-photo">
                      {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <Icon name="menu" size={22} />}
                      <button
                        type="button"
                        className="cmp-drop"
                        onClick={() => toggle(it.id)}
                        aria-label={ar ? 'أزل من المقارنة' : 'Remove'}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                    <strong className="cmp-nm">{pickLang(it, 'name', lang)}</strong>
                  </div>
                ))}
              </div>

              {rows.map((row) => {
                const st = stats(row)
                if (!st) return null
                return (
                  <div className={`cmp-r ${st.same ? 'is-same' : ''}`} key={row.key}>
                    <div className="cmp-l">{row.label}</div>
                    {list.map((it, i) => {
                      const node = row.cell(it)
                      return (
                        <div className={`cmp-c ${st.winner === i ? 'is-win' : ''}`} key={it.id}>
                          {node || <span className="cmp-dash">—</span>}
                          {st.winner === i && row.chip ? <span className="cmp-chip">{row.chip}</span> : null}
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              <div className="cmp-r cmp-r-act">
                <div className="cmp-l" />
                {list.map((it) => (
                  <div className="cmp-c" key={it.id}>
                    <button type="button" className="cmp-open" onClick={() => onOpenItem?.(it)}>
                      {ar ? 'افتح الصنف' : 'Open item'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <footer className="cmp-foot">
            <button type="button" className="cmp-cta cmp-cta-ghost" onClick={() => setPicking(true)}>
              <Icon name="edit" size={16} />
              <span>{ar ? 'غيّر الاختيار' : 'Change selection'}</span>
            </button>
          </footer>
        </>
      )}
    </div>,
    root,
  )
}
