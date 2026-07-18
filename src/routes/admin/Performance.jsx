import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { useToast } from '../../components/Toast.jsx'
import { Spinner, Empty } from '../../components/ui.jsx'
import { Price } from '../../components/Riyal.jsx'
import { watchStaff, watchOrdersSince, watchAllReviews, updateTenant } from '../../lib/db.js'
import { scoreStaff, startOf } from '../../lib/perf.js'
import { roleName, ASSIGNABLE_ROLES, CAP } from '../../lib/permissions.js'
import { buildRoleTargets, buildRoleWeights, roleTargetDaily, TARGET_METRICS } from '../../lib/targets.js'
import Icon from '../../components/Icon.jsx'
import StaffProfile from './StaffProfile.jsx'

const EDIT_METRICS = TARGET_METRICS.filter((m) => m.key !== 'revenue')

export default function Performance() {
  const { t, lang } = useI18n()
  const { tenantId, tenant, isManager, updateTenantLocal, can } = useAuth()
  const showMoney = can(CAP.VIEW_REVENUE)
  const toast = useToast()
  const ar = lang === 'ar'
  const currency = tenant?.currency || 'SAR'
  const [period, setPeriod] = useState('today')
  const [members, setMembers] = useState(null)
  const [orders, setOrders] = useState([])
  const [reviews, setReviews] = useState([])
  const [editTargets, setEditTargets] = useState(false)
  const [profileFor, setProfileFor] = useState(null)

  const targets = tenant?.staffTargets || { daily: 20, weekly: 120, monthly: 480 }
  const target = period === 'today' ? targets.daily : period === 'week' ? targets.weekly : targets.monthly

  useEffect(() => { if (!tenantId) return; return watchStaff(tenantId, setMembers) }, [tenantId])
  useEffect(() => { if (!tenantId) return; return watchOrdersSince(tenantId, startOf(period), setOrders) }, [tenantId, period])
  useEffect(() => { if (!tenantId) return; return watchAllReviews(tenantId, setReviews, 400) }, [tenantId])

  const roleLabel = (r) => roleName(r, lang)

  const rows = useMemo(() => (members ? scoreStaff(members, orders, reviews, { period, target, roleTargets: buildRoleTargets(tenant, period), roleWeights: buildRoleWeights(tenant), ar }) : []), [members, orders, reviews, period, target, tenant, ar])

  // Team target (#3): venue-wide served goal for the period.
  const teamDaily = tenant?.staffTargets?.teamDaily || 0
  const teamTarget = teamDaily * (period === 'today' ? 1 : period === 'week' ? 6 : 26)
  const teamServed = rows.reduce((s, r) => s + r.served, 0)

  const leader = rows.find((r) => r.points > 0)
  // Champion per role (rows are already sorted by points): top scorer of each role.
  const roleChampions = useMemo(() => {
    const seen = {}
    rows.forEach((r) => { if (r.points > 0 && !seen[r.role]) seen[r.role] = r })
    return Object.values(seen)
  }, [rows])

  const saveTargets = async (patch) => {
    const next = { daily: Number(targets.daily) || 0, weekly: Number(targets.weekly) || 0, monthly: Number(targets.monthly) || 0, ...patch }
    try { await updateTenant(tenantId, { staffTargets: next }); updateTenantLocal({ staffTargets: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }
  const saveRoleTarget = async (role, metric, value) => {
    const cur = tenant?.roleTargets || {}
    const next = { ...cur, [role]: { ...(cur[role] || roleTargetDaily(tenant, role)), [metric]: Number(value) || 0 } }
    try { await updateTenant(tenantId, { roleTargets: next }); updateTenantLocal({ roleTargets: next }); toast.success(t('saved')) } catch (_) { toast.error(t('error')) }
  }

  if (members === null) return <Spinner />

  const PERIODS = [
    { id: 'today', label: ar ? 'اليوم' : 'Today' },
    { id: 'week', label: ar ? 'الأسبوع' : 'Week' },
    { id: 'month', label: ar ? 'الشهر' : 'Month' },
  ]
  const medal = ['#e0b15c', '#9aa0b4', '#c08457']

  return (
    <div className="page stack">
      <h2 className="page-title row" style={{ gap: 8 }}><Icon name="award" size={22} /> {ar ? 'أداء الموظفين' : 'Staff performance'}</h2>

      <div className="row" style={{ gap: 8 }}>
        {PERIODS.map((p) => (
          <button key={p.id} className={`chip ${period === p.id ? 'active' : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
        ))}
        <span className="grow" />
        {isManager && <button className="btn btn-sm btn-outline" onClick={() => setEditTargets((v) => !v)}><Icon name="settings" size={15} /> {ar ? 'الأهداف' : 'Targets'}</button>}
      </div>

      {isManager && editTargets && (
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <div className="field">
            <label>{ar ? 'هدف الفريق اليومي (إجمالي المقدَّم)' : 'Daily team target (total served)'}</label>
            <input className="input num" type="number" min="0" defaultValue={teamDaily} onBlur={(e) => saveTargets({ teamDaily: Number(e.target.value) || 0 })} />
          </div>
          <strong className="small row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {ar ? 'أهداف الأدوار اليومية' : 'Daily targets per role'}</strong>
          <p className="xs faint">{ar ? 'لكل وظيفة مقاييسها الفعلية. تُحسب الأسبوعية والشهرية تلقائياً (×6 و×26) ويُقيَّم الموظف على هدف وظيفته بالضبط.' : 'Each role is measured by its real metrics. Weekly/monthly scale automatically (×6, ×26); each staffer is evaluated against their role’s target.'}</p>
          {/* header row */}
          <div className="row" style={{ gap: 6 }}>
            <span className="xs faint" style={{ width: 86, flex: 'none' }} />
            {EDIT_METRICS.map((m) => <span key={m.key} className="xs faint grow" style={{ textAlign: 'center' }}>{ar ? m.ar : m.en}</span>)}
          </div>
          {ASSIGNABLE_ROLES.map((role) => {
            const tgt = roleTargetDaily(tenant, role)
            return (
              <div key={role} className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="small bold" style={{ width: 86, flex: 'none' }}>{roleName(role, lang)}</span>
                {EDIT_METRICS.map((m) => (
                  <input key={m.key} className="input num grow" style={{ minWidth: 0, textAlign: 'center' }} type="number" min="0" defaultValue={tgt[m.key] || 0}
                    onBlur={(e) => saveRoleTarget(role, m.key, e.target.value)} />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* leader / employee of the month */}
      {leader && (
        <div className="card card-pad row" style={{ gap: 12, cursor: 'pointer', background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 24%, var(--surface)), var(--surface))', border: '1px solid var(--gold)' }} onClick={() => setProfileFor(leader)}>
          <span className="center" style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--gold)', color: '#1a1205', fontWeight: 900, flex: 'none', display: 'grid', placeItems: 'center' }}><Icon name="award" size={26} /></span>
          <div className="grow">
            <div className="xs faint">{period === 'month' ? (ar ? 'موظف الشهر' : 'Employee of the month') : (ar ? 'المتصدّر' : 'Top performer')}</div>
            <div className="bold" style={{ fontSize: 'var(--fs-md)' }}>{leader.name || leader.email}</div>
            <div className="xs faint">{leader.points} {ar ? 'نقطة' : 'pts'} · {leader.served} {ar ? 'مقدَّم' : 'served'}</div>
          </div>
        </div>
      )}

      {/* team target progress (#3) */}
      {teamTarget > 0 && (
        <div className="card card-pad stack" style={{ gap: 6 }}>
          <div className="row-between small"><span className="row" style={{ gap: 6 }}><Icon name="staff" size={15} className="faint" /> {ar ? 'هدف الفريق' : 'Team target'}</span><span className="bold">{teamServed}/{teamTarget}</span></div>
          <div style={{ height: 9, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (teamServed / teamTarget) * 100)}%`, background: teamServed >= teamTarget ? 'var(--success)' : 'var(--brand)', borderRadius: 99, transition: 'width .3s' }} /></div>
          {teamServed >= teamTarget && <span className="xs" style={{ color: 'var(--success)' }}><Icon name="check" size={12} /> {ar ? 'حقّق الفريق هدفه!' : 'Team hit its goal!'}</span>}
        </div>
      )}

      {/* champion per role (fair: best of each job type) */}
      {roleChampions.length > 1 && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <strong className="small row" style={{ gap: 6 }}><Icon name="award" size={15} style={{ color: 'var(--gold)' }} /> {period === 'month' ? (ar ? 'أبطال الأدوار هذا الشهر' : 'Role champions this month') : (ar ? 'أبطال الأدوار' : 'Role champions')}</strong>
          <div className="row" style={{ gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {roleChampions.map((r) => (
              <button key={r.uid} className="card card-pad stack center" style={{ flex: 'none', width: 120, gap: 4, cursor: 'pointer' }} onClick={() => setProfileFor(r)}>
                <span className="center" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 800, overflow: 'hidden', flex: 'none' }}>{r.photoUrl ? <img src={r.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (r.name || '?').charAt(0).toUpperCase()}</span>
                <span className="xs bold" style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap' }}>{r.name || r.email}</span>
                <span className="badge badge-gold" style={{ fontSize: 10 }}>{roleLabel(r.role)}</span>
                <span className="xs faint">{r.points} {ar ? 'نقطة' : 'pts'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* leaderboard */}
      {rows.length === 0 ? (
        <Empty icon="award" title={ar ? 'لا بيانات بعد' : 'No data yet'} />
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {rows.map((r, i) => (
            <div key={r.uid} className="card card-pad stack" style={{ gap: 8, cursor: 'pointer' }} onClick={() => setProfileFor(r)}>
              <div className="row" style={{ gap: 10 }}>
                <span className="center" style={{ width: 30, height: 30, borderRadius: '50%', background: i < 3 ? medal[i] : 'var(--surface-2)', color: i < 3 ? '#1a1205' : 'var(--text-muted)', fontWeight: 800, fontSize: 13, flex: 'none' }}>{i + 1}</span>
                <div className="grow">
                  <div className="bold">{r.name || r.email}</div>
                  <div className="xs faint">{roleLabel(r.role)} · <span style={{ color: r.level.color, fontWeight: 800 }}>{ar ? r.level.ar : r.level.en}</span></div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="bold" style={{ color: 'var(--brand)', fontSize: 'var(--fs-md)' }}>{r.points}</div>
                  <div className="xs faint">{ar ? 'نقطة' : 'pts'}</div>
                </div>
              </div>

              <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small row" style={{ gap: 4 }}><Icon name="orders" size={13} className="faint" /> {r.handled}</span>
                <span className="small row" style={{ gap: 4 }}><Icon name="check" size={13} className="faint" /> {r.served}</span>
                <span className="small row" style={{ gap: 4 }}><Icon name="customers" size={13} className="faint" /> {r.custCount}</span>
                {r.ratingN > 0 && <span className="small rating" style={{ gap: 3 }}><Icon name="star" size={13} fill="currentColor" strokeWidth={1.5} /> {r.avgRating.toFixed(1)}</span>}
                <span className="grow" />
                <span className="price small">{showMoney ? <Price value={r.revenue} currency={currency} lang={lang} /> : <span className="faint">—</span>}</span>
              </div>

              {/* target progress (role-aware) */}
              <div className="stack" style={{ gap: 4 }}>
                <div className="xs faint row-between"><span>{r.targetMetrics ? (ar ? 'نحو هدف الوظيفة' : 'To role target') : (ar ? 'نحو الهدف' : 'To target')}</span><span>{Math.round(r.progress * 100)}%</span></div>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, r.progress * 100)}%`, background: r.progress >= 1 ? 'var(--success)' : 'var(--brand)', borderRadius: 99 }} />
                </div>
                {r.targetMetrics && (
                  <div className="xs faint row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {r.targetMetrics.map((mt) => { const meta = TARGET_METRICS.find((x) => x.key === mt.key) || {}; return <span key={mt.key}>{ar ? meta.ar : meta.en}: <strong style={{ color: mt.value >= mt.target ? 'var(--success)' : 'inherit' }}>{mt.value}/{mt.target}</strong></span> })}
                  </div>
                )}
              </div>

              {r.insight && (
                <div className="xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: r.progress >= 1 ? 'var(--success)' : 'var(--warning)' }}>
                  <Icon name="sparkles" size={13} /> {r.insight}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="xs faint">{ar ? 'النقاط = (مقدَّم×10) + (مستلَم×4) + (الإيراد÷10) + مكافأة تقييم العملاء. محسوبة من طلبات منشأتك فقط.' : 'Points = served×10 + taken×4 + revenue÷10 + customer-rating bonus. Computed from your venue’s orders only.'}</p>

      {profileFor && (
        <StaffProfile
          key={profileFor.uid}
          tid={tenantId}
          row={profileFor}
          target={target}
          currency={currency}
          reviews={reviews.filter((r) => r.staffUid === profileFor.uid && (r.createdAt?.toMillis?.() || 0) >= startOf(period).getTime())}
          onClose={() => setProfileFor(null)}
        />
      )}
    </div>
  )
}
