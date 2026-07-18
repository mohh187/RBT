// Platform "Appearance & Design" — see and control every registered venue's
// public interface/menu. Gallery of live previews + a per-venue appearance
// control panel (theme preset, brand/accent colors, skin). Writes go through
// platformUpdateTenant (platform admins bypass tenant rules).
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchAllTenants, watchTenantDoc, platformUpdateTenant } from '../../lib/platform.js'
import { THEMES, resolveTenantTheme } from '../../lib/themes.js'
import { SKINS } from '../../lib/skins.js'
import { PlanBadge, StatusChip, fmtWhen } from './shared.jsx'

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const previewUrl = (slug, bust) => `${origin()}/preview/${slug}${bust ? `?pv=${bust}` : ''}`

// ---------------- gallery (all venues) ----------------
function Gallery() {
  const [tenants, setTenants] = useState(null)
  const [q, setQ] = useState('')
  const [live, setLive] = useState(false) // render live iframe thumbnails

  useEffect(() => watchAllTenants(setTenants), [])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    let list = tenants || []
    if (s) list = list.filter((t) => (t.name || '').toLowerCase().includes(s) || (t.slug || '').toLowerCase().includes(s))
    return list
  }, [tenants, q])

  if (tenants === null) return <Spinner />

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">المظهر والتصميم</h2>
        <p className="muted small">اطّلع على واجهات ومنيوهات كل المنشآت وتحكّم في تصميمها</p>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input grow" placeholder="بحث بالاسم أو الرابط…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 180 }} />
        <button className={`btn ${live ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLive((v) => !v)} title="عرض معاينات حية داخل البطاقات (أثقل)">
          <Icon name="eye" size={16} /> {live ? 'المعاينات الحية مفعّلة' : 'تفعيل المعاينات الحية'}
        </button>
      </div>

      {rows.length === 0 ? (
        <Empty icon="store" title="لا منشآت" />
      ) : (
        <div className="menu-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {rows.map((t) => {
            const theme = resolveTenantTheme(t)
            return (
              <div key={t.id} className="card card-pad stack" style={{ gap: 8 }}>
                {live && t.slug ? (
                  <div className="device-shell" style={{ height: 260, position: 'relative' }}>
                    <iframe
                      title={t.name}
                      src={previewUrl(t.slug)}
                      className="venue-preview-frame"
                      loading="lazy"
                      style={{ width: '250%', height: '650px', border: 0, transform: 'scale(0.4)', transformOrigin: 'top right', pointerEvents: 'none' }}
                    />
                  </div>
                ) : (
                  <div
                    className="venue-card-cover"
                    style={t.coverUrl
                      ? { backgroundImage: `url(${t.coverUrl})` }
                      : { background: `linear-gradient(135deg, ${theme.brand}, ${theme.accent})` }}
                  >
                    {t.logoUrl ? (
                      <img src={t.logoUrl} alt="" style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', position: 'absolute', insetInlineStart: 10, bottom: 10, border: '2px solid #fff' }} />
                    ) : null}
                  </div>
                )}

                <div className="row-between" style={{ alignItems: 'flex-start', gap: 6 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name || t.id}</div>
                    <div className="xs faint">/{t.slug} · {fmtWhen(t.createdAt)}</div>
                  </div>
                  <PlanBadge plan={t.plan} />
                </div>

                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span title="اللون الأساسي" style={{ width: 18, height: 18, borderRadius: 5, background: theme.brand, border: '1px solid var(--border)' }} />
                  <span title="اللون الثانوي" style={{ width: 18, height: 18, borderRadius: 5, background: theme.accent, border: '1px solid var(--border)' }} />
                  <span className="xs faint">{t.themePreset || (t.skin?.skinId ? `سكن: ${t.skin.skinId}` : 'مخصّص')}</span>
                  <span className="grow" />
                  <StatusChip tenant={t} />
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <Link to={`/platform/design/${t.id}`} className="btn btn-primary grow" style={{ padding: '6px 10px' }}>
                    <Icon name="edit" size={15} /> تصميم
                  </Link>
                  <a href={previewUrl(t.slug)} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ padding: '6px 10px' }} title="فتح المنيو في تبويب جديد">
                    <Icon name="eye" size={15} />
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------- detail (one venue's appearance) ----------------
function DesignDetail({ tid }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState(undefined)
  const [preset, setPreset] = useState('')
  const [brand, setBrand] = useState('#7c2d2d')
  const [accent, setAccent] = useState('#5c5c66')
  const [skinId, setSkinId] = useState('')
  const [device, setDevice] = useState('mobile') // mobile | desktop
  const [bust, setBust] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => watchTenantDoc(tid, setTenant), [tid])
  useEffect(() => {
    if (!tenant) return
    const theme = resolveTenantTheme(tenant)
    setPreset(tenant.themePreset || '')
    setBrand(tenant.themeColor || theme.brand)
    setAccent(tenant.themeAccent || theme.accent)
    setSkinId(tenant.skin?.skinId || '')
  }, [tenant])

  if (tenant === undefined) return <Spinner />
  if (tenant === null) return <Empty icon="store" title="منشأة غير موجودة" />

  const pickPreset = (p) => {
    setPreset(p.id)
    setBrand(p.brand)
    setAccent(p.accent)
  }

  const save = async () => {
    setBusy(true)
    try {
      const patch = {
        themePreset: preset || null,
        themeColor: brand,
        themeAccent: accent,
        skin: skinId ? { ...(tenant.skin || {}), skinId } : null,
      }
      await platformUpdateTenant(tid, patch)
      setBust((b) => b + 1) // reload the live preview
      toast.success('تم تحديث مظهر المنشأة')
    } catch {
      toast.error('تعذّر الحفظ')
    } finally {
      setBusy(false)
    }
  }

  const frameW = device === 'mobile' ? 390 : 1024

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-outline" style={{ padding: '6px 10px' }} onClick={() => navigate('/platform/design')}>
          <Icon name="back" size={16} /> رجوع
        </button>
        <div className="grow">
          <h2 className="page-title" style={{ marginBottom: 2 }}>تصميم «{tenant.name}»</h2>
          <p className="muted small">/{tenant.slug}</p>
        </div>
        <PlanBadge plan={tenant.plan} />
      </div>

      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* live preview */}
        <div className="stack grow" style={{ flex: '1 1 340px', gap: 8, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <button className={`btn btn-sm ${device === 'mobile' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDevice('mobile')}><Icon name="phone" size={14} /> جوال</button>
            <button className={`btn btn-sm ${device === 'desktop' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDevice('desktop')}><Icon name="grid" size={14} /> سطح المكتب</button>
            <span className="grow" />
            <a href={previewUrl(tenant.slug)} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline"><Icon name="eye" size={14} /> فتح</a>
          </div>
          <div className="device-shell" style={{ maxWidth: device === 'mobile' ? 400 : '100%', margin: device === 'mobile' ? '0 auto' : 0, overflowX: 'auto' }}>
            <iframe
              key={`${device}-${bust}`}
              title="preview"
              src={previewUrl(tenant.slug, bust)}
              className="venue-preview-frame"
              style={{ width: frameW, maxWidth: device === 'desktop' ? 'none' : '100%', height: '70dvh' }}
            />
          </div>
          <p className="xs faint text-center">معاينة حية لواجهة الزبون — تُحدَّث بعد الحفظ</p>
        </div>

        {/* controls */}
        <div className="card card-pad stack" style={{ flex: '0 0 300px', width: 300, gap: 'var(--sp-3)' }}>
          <strong><Icon name="image" size={16} /> التحكم في المظهر</strong>

          {/* presets */}
          <div className="stack" style={{ gap: 6 }}>
            <span className="xs faint bold">ثيم جاهز</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {THEMES.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${preset === p.id ? 'active' : ''}`}
                  onClick={() => pickPreset(p)}
                  title={p.name.ar}
                >
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: p.brand, display: 'inline-block', marginInlineEnd: 4, verticalAlign: 'middle' }} />
                  {p.name.ar}
                </button>
              ))}
            </div>
          </div>

          {/* colors */}
          <div className="row" style={{ gap: 8 }}>
            <label className="stack grow" style={{ gap: 4 }}>
              <span className="xs faint bold">اللون الأساسي</span>
              <input type="color" value={brand} onChange={(e) => { setPreset(''); setBrand(e.target.value) }} style={{ width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} />
            </label>
            <label className="stack grow" style={{ gap: 4 }}>
              <span className="xs faint bold">اللون الثانوي</span>
              <input type="color" value={accent} onChange={(e) => { setPreset(''); setAccent(e.target.value) }} style={{ width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 8, background: 'none' }} />
            </label>
          </div>

          {/* skin */}
          <label className="stack" style={{ gap: 4 }}>
            <span className="xs faint bold">السكن (تصميم كامل)</span>
            <select className="input" value={skinId} onChange={(e) => setSkinId(e.target.value)}>
              <option value="">بدون سكن (ثيم فقط)</option>
              {SKINS.map((s) => <option key={s.id} value={s.id}>{s.name.ar} — {s.tier}</option>)}
            </select>
          </label>

          <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
            <Icon name="check" size={16} /> {busy ? 'جارٍ الحفظ…' : 'حفظ وتطبيق'}
          </button>
          <p className="xs faint">يُطبَّق فوراً على واجهة الزبون العامة. باقي التفاصيل (الشعار، الغلاف، الخلفية، الخطوط) تُدار من إعدادات المنشأة نفسها أو عبر «الدخول كمالك».</p>

          <Link to={`/platform/venues/${tid}`} className="btn btn-outline btn-block"><Icon name="store" size={15} /> ملف المنشأة الكامل</Link>
        </div>
      </div>
    </div>
  )
}

export default function Design() {
  const { tid } = useParams()
  return tid ? <DesignDetail tid={tid} /> : <Gallery />
}
