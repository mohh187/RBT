// Problem center — two live boards: venue support tickets (platformIssues)
// and automatic client error reports (platformErrors, captured by monitor.js).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Empty } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { watchIssues, updateIssue, watchErrors, updateError, deleteError } from '../../lib/platform.js'
import { fmtWhen } from './shared.jsx'

const ISSUE_STATUS = [
  ['open', 'مفتوحة', 'badge-danger'],
  ['inProgress', 'قيد المعالجة', 'badge-warning'],
  ['resolved', 'محلولة', 'badge-success'],
]
const PRIORITY_AR = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: 'عاجلة' }

export default function Issues() {
  const toast = useToast()
  const [tab, setTab] = useState('issues') // issues | errors
  const [issues, setIssues] = useState([])
  const [errors, setErrors] = useState([])
  const [errFilter, setErrFilter] = useState('open') // open | all

  useEffect(() => watchIssues(setIssues), [])
  useEffect(() => watchErrors(setErrors, 150), [])

  const openIssues = issues.filter((i) => i.status !== 'resolved').length
  const openErrors = errors.filter((e) => e.status !== 'resolved').length
  const shownErrors = useMemo(
    () => (errFilter === 'open' ? errors.filter((e) => e.status !== 'resolved') : errors),
    [errors, errFilter],
  )

  const setStatus = async (issue, status) => {
    await updateIssue(issue.id, { status })
    toast.success('تم التحديث')
  }

  return (
    <div className="page stack" style={{ gap: 'var(--sp-4)' }}>
      <div>
        <h2 className="page-title">متابعة المشاكل</h2>
        <p className="muted small">تذاكر الدعم من المنشآت + مراقبة أخطاء الكود تلقائياً</p>
      </div>

      <div className="row" style={{ gap: 6 }}>
        <button className={`btn ${tab === 'issues' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('issues')}>
          <Icon name="wrench" size={14} style={{ verticalAlign: 'middle' }} /> تذاكر المنشآت {openIssues ? `(${openIssues})` : ''}
        </button>
        <button className={`btn ${tab === 'errors' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('errors')}>
          أخطاء النظام {openErrors ? `(${openErrors})` : ''}
        </button>
      </div>

      {tab === 'issues' && (
        issues.length === 0 ? (
          <Empty icon="check" title="لا تذاكر" hint="عندما تفتح أي منشأة تذكرة دعم ستظهر هنا فوراً" />
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {issues.map((i) => (
              <div key={i.id} className="card card-pad stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong className="grow">{i.title}</strong>
                  <span className="badge">{PRIORITY_AR[i.priority] || i.priority}</span>
                  {ISSUE_STATUS.filter(([id]) => id === i.status).map(([id, label, cls]) => (
                    <span key={id} className={`badge ${cls}`}>{label}</span>
                  ))}
                </div>
                {i.body ? <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{i.body}</p> : null}
                <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span className="xs faint">
                    {i.tenantId ? <Link to={`/platform/venues/${i.tenantId}`} className="bold">{i.tenantName || i.tenantId}</Link> : 'المنصة'}
                    {i.createdByName ? ` · ${i.createdByName}` : ''} · {fmtWhen(i.createdAt)}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    {ISSUE_STATUS.filter(([id]) => id !== i.status).map(([id, label]) => (
                      <button key={id} className="btn btn-outline" style={{ padding: '4px 10px' }} onClick={() => setStatus(i, id)}>
                        {label}
                      </button>
                    ))}
                    {i.tenantId && (
                      <Link to={`/platform/chat/${i.tenantId}`} className="btn btn-outline" style={{ padding: '4px 10px' }}>
                        <Icon name="mail" size={14} /> دردشة
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'errors' && (
        <>
          <div className="row" style={{ gap: 6 }}>
            <button className={`btn ${errFilter === 'open' ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '5px 12px' }} onClick={() => setErrFilter('open')}>المفتوحة ({openErrors})</button>
            <button className={`btn ${errFilter === 'all' ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '5px 12px' }} onClick={() => setErrFilter('all')}>الكل ({errors.length})</button>
          </div>
          {shownErrors.length === 0 ? (
            <Empty icon="check" title="لا أخطاء" hint="أي خطأ يقع على جهاز أي مستخدم في أي منشأة يُلتقط ويظهر هنا" />
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              {shownErrors.map((e) => (
                <div key={e.id} className="card card-pad stack" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--danger)', marginTop: 2 }}><Icon name="warning" size={16} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small bold" style={{ wordBreak: 'break-word' }}>{e.message}</div>
                      <div className="xs faint" dir="ltr" style={{ textAlign: 'end', wordBreak: 'break-all' }}>{e.url}</div>
                      <div className="xs faint">
                        {e.tenantName || e.tenantId || 'زائر غير معروف'} · {e.kind === 'promise' ? 'Promise' : 'خطأ' } · {fmtWhen(e.at)}
                        {e.status === 'resolved' ? ' · محلول' : ''}
                      </div>
                    </div>
                  </div>
                  {e.stack ? (
                    <details>
                      <summary className="xs faint" style={{ cursor: 'pointer' }}>تفاصيل الخطأ (stack)</summary>
                      <pre className="xs" dir="ltr" style={{ overflowX: 'auto', background: 'var(--surface-2, var(--bg))', padding: 8, borderRadius: 8, maxHeight: 200 }}>{e.stack}</pre>
                    </details>
                  ) : null}
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {e.tenantId && (
                      <Link to={`/platform/venues/${e.tenantId}`} className="btn btn-outline" style={{ padding: '4px 10px' }}>المنشأة</Link>
                    )}
                    {e.status !== 'resolved' && (
                      <button className="btn btn-outline" style={{ padding: '4px 10px', color: 'var(--success)' }} onClick={() => updateError(e.id, { status: 'resolved' })}>
                        <Icon name="check" size={14} /> تم الحل
                      </button>
                    )}
                    <button className="btn btn-outline" style={{ padding: '4px 10px', color: 'var(--danger)' }} onClick={() => deleteError(e.id)}>
                      <Icon name="delete" size={14} /> حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
