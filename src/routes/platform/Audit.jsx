// /platform/audit — live, filterable table of every platform-admin action.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { fmtWhen } from './shared.jsx'
import { watchAudit } from '../../lib/platformAudit.js'

// Friendly Arabic labels for known action types (falls back to the raw key).
const ACTION_LABELS = {
  'tenant.plan': 'تغيير الباقة',
  'tenant.active': 'تفعيل/إيقاف منشأة',
  'tenant.update': 'تعديل منشأة',
  'broadcast.create': 'إرسال إشعار عام',
  'role.set': 'تغيير صلاحية مشرف',
  'issue.resolve': 'إغلاق تذكرة',
}

function actionLabel(a) {
  return ACTION_LABELS[a] || a || '—'
}

const BADGE = {
  'tenant.active': 'badge-warning',
  'tenant.plan': 'badge-gold',
  'role.set': 'badge-danger',
  'broadcast.create': 'badge-info',
}

export default function Audit() {
  const [rows, setRows] = useState(null)
  const [action, setAction] = useState('')
  const [term, setTerm] = useState('')

  useEffect(() => watchAudit(setRows, 300), [])

  // Distinct action types present in the data, for the filter dropdown.
  const actionTypes = useMemo(() => {
    const set = new Set()
    ;(rows || []).forEach((r) => r.action && set.add(r.action))
    return Array.from(set).sort()
  }, [rows])

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (action && r.action !== action) return false
      if (!t) return true
      const hay = [r.byEmail, r.targetName, r.targetTid, r.action, r.detail]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(t)
    })
  }, [rows, action, term])

  if (rows == null) return <div className="page"><Spinner /></div>

  return (
    <div className="page">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <h1 className="page-title">سجل التدقيق</h1>
        <span className="muted small">{filtered.length} حدث</span>
      </div>

      <div className="card card-pad">
        <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div className="row grow" style={{ gap: 6, minWidth: 200 }}>
            <Icon name="search" size={16} />
            <input
              className="input input-sm grow"
              placeholder="بحث بالبريد أو المنشأة أو التفاصيل…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          <select className="select input-sm" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">كل الإجراءات</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>{actionLabel(a)}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="notepad" title="لا توجد أحداث" hint="لم يُسجَّل أي إجراء مطابق بعد." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'start', color: 'var(--text-muted)' }}>
                <th style={th}>الإجراء</th>
                <th style={th}>المنشأة</th>
                <th style={th}>المشرف</th>
                <th style={th}>التفاصيل</th>
                <th style={th}>الوقت</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>
                    <span className={`badge ${BADGE[r.action] || 'badge-info'}`}>{actionLabel(r.action)}</span>
                  </td>
                  <td style={td}>
                    {r.targetName ? <div className="bold truncate">{r.targetName}</div> : <span className="faint">—</span>}
                    {r.targetTid ? <div className="xs faint num truncate">{r.targetTid}</div> : null}
                  </td>
                  <td style={td}>
                    <span className="truncate">{r.byEmail || <span className="faint">—</span>}</span>
                  </td>
                  <td style={{ ...td, maxWidth: 320 }}>
                    <span className="xs muted" style={{ wordBreak: 'break-word' }}>
                      {typeof r.detail === 'string' ? r.detail : r.detail ? JSON.stringify(r.detail) : '—'}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span className="xs faint num">{fmtWhen(r.at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const th = { textAlign: 'start', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }
const td = { textAlign: 'start', padding: '10px 12px', verticalAlign: 'top' }
