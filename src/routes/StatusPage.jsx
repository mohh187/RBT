// Public platform status page (route: /status, NOT under /platform).
// Standalone, self-contained styling — anyone can read platformStatus (public
// read rule). Shows the current overall status + recent incidents.
import { useEffect, useMemo, useState } from 'react'
import { watchStatus, overallStatus, STATUS_LEVELS } from '../lib/platformGrowth.js'

function fmt(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d || isNaN(d)) return ''
  try {
    return d.toLocaleDateString('ar', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

const LEVEL = {
  operational: { ar: 'كل الأنظمة تعمل بشكل طبيعي', color: '#16a34a' },
  degraded: { ar: 'بعض الأنظمة تشهد أداءً منخفضاً', color: '#d97706' },
  down: { ar: 'يوجد تعطّل في الخدمة', color: '#dc2626' },
}

export default function StatusPage() {
  const [incidents, setIncidents] = useState(null)
  useEffect(() => watchStatus(setIncidents, 40), [])

  const overall = useMemo(() => overallStatus(incidents || []), [incidents])
  const ov = LEVEL[overall] || LEVEL.operational

  return (
    <div dir="rtl" style={{
      minHeight: '100dvh',
      background: '#0b0d12',
      color: '#e7e9ee',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
      padding: '32px 16px',
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#1a1f2b', display: 'grid', placeItems: 'center', fontSize: 18 }}>●</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>RBT360</div>
            <div style={{ fontSize: 12, color: '#8b93a7' }}>حالة النظام</div>
          </div>
        </div>

        {/* Overall banner */}
        <div style={{
          borderRadius: 14,
          padding: '20px 18px',
          background: '#141824',
          border: `1px solid ${ov.color}44`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 24,
        }}>
          <span style={{
            width: 16, height: 16, borderRadius: 99, background: ov.color, flex: 'none',
            boxShadow: `0 0 0 4px ${ov.color}33`,
          }} />
          <div style={{ fontWeight: 700, fontSize: 17 }}>{ov.ar}</div>
        </div>

        <h2 style={{ fontSize: 14, color: '#8b93a7', margin: '0 0 12px', fontWeight: 600 }}>سجل الأحداث الأخير</h2>

        {incidents === null ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#8b93a7' }}>...جارٍ التحميل</div>
        ) : incidents.length === 0 ? (
          <div style={{
            borderRadius: 14, padding: '28px 18px', background: '#141824',
            border: '1px solid #232838', textAlign: 'center', color: '#8b93a7',
          }}>
            لا توجد أحداث مسجّلة — كل شيء يعمل بشكل طبيعي.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {incidents.map((i) => {
              const lv = LEVEL[i.level] || LEVEL.operational
              const label = STATUS_LEVELS[i.level]?.ar || lv.ar
              return (
                <div key={i.id} style={{
                  borderRadius: 14, padding: '14px 16px', background: '#141824',
                  border: '1px solid #232838',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: lv.color, flex: 'none' }} />
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{i.title}</span>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 99,
                      background: `${lv.color}22`, color: lv.color, fontWeight: 600,
                    }}>{label}</span>
                  </div>
                  {i.body ? <div style={{ fontSize: 13, color: '#b6bccb', marginTop: 6, lineHeight: 1.6, wordBreak: 'break-word' }}>{i.body}</div> : null}
                  <div style={{ fontSize: 12, color: '#6b7385', marginTop: 8 }}>{fmt(i.at)}</div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: '#5a6273' }}>
          RBT360 — منصّة إدارة المقاهي والمطاعم
        </div>
      </div>
    </div>
  )
}
