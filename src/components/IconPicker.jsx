import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { Spinner } from './ui.jsx'
import '../styles/icon-picker.css'

// ICON PICKER — browse 1539 vectors, insert one as a design element.
//
// The vector data is loaded on demand (it is ~246 kB of path strings) and lives
// in a generated module that does NOT touch lucide's module graph. That
// separation is load-bearing: an earlier cut imported the lucide barrel here, and
// because Icon.jsx imports the same barrel eagerly for the app chrome, rollup
// merged them and shipped 745 kB on first paint. See iconLibraryData.js.
//
// The element stores the icon's MARKUP, not its name, so a saved design keeps
// printing identically forever and the export rasterizer needs no icon lookup.

export default function IconPicker({ onPick, onClose, color = '#1c1c1e', strokeWidth = 2 }) {
  const [lib, setLib] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    import('../lib/iconLibrary.js')
      .then((m) => { if (alive) setLib(m) })
      .catch((e) => { if (alive) setErr(String(e?.message || e)) })
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => (lib ? lib.searchIcons(q) : []), [lib, q])

  if (err) return <p className="small" style={{ color: 'var(--danger)' }}>تعذّر تحميل مكتبة الأيقونات: {err}</p>
  if (!lib) return <div className="center" style={{ padding: 26 }}><Spinner /></div>

  const total = lib.iconCount()

  return (
    <div className="icp">
      <div className="icp-bar">
        <label className="icp-search">
          <Icon name="search" size={15} />
          <input
            className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`ابحث في ${total} أيقونة: قهوة، جائزة، coffee…`}
          />
          {q && <button className="icon-btn" onClick={() => setQ('')} aria-label="مسح"><Icon name="close" size={14} /></button>}
        </label>
        {onClose && <button className="btn btn-sm btn-outline" onClick={onClose}>إغلاق</button>}
      </div>

      <div className="icp-grid">
        {shown.map((name) => {
          const svg = lib.iconSvg(name, { strokeWidth })
          return (
            <button
              key={name} className="icp-cell" title={name}
              style={{ color }}
              onClick={() => onPick?.({ name, svg })}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
        })}
      </div>

      <p className="icp-note">
        {q
          ? `${shown.length}${shown.length >= 400 ? '+' : ''} نتيجة`
          : `يُعرض ${shown.length} من ${total}. اكتب للبحث في الباقي`}
      </p>
    </div>
  )
}
