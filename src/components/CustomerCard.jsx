import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icon.jsx'
import { Price } from './Riyal.jsx'
import { getCustomerByPhone, setCustomerFlag, grantMembership, redeemPoints, addBonusPoints, setMembershipActive, watchLoyaltyLog } from '../lib/db.js'
import { resolveMembershipPolicy, isEligible, TIER_META, nextTierProgress, pointsToDiscount } from '../lib/membership.js'
import { publicBaseUrl } from '../lib/qr.js'

// Quick CRM card for a customer (by phone): stats, behavior score, staff rating, tag & VIP membership.
export default function CustomerCard({ tid, phone, name, currency = 'SAR', onClose }) {
  const { lang } = useI18n()
  const { profile, tenant } = useAuth()
  const ar = lang === 'ar'
  const [c, setC] = useState(undefined)
  const [redeemPts, setRedeemPts] = useState('')
  const [bonusPts, setBonusPts] = useState('')
  const [ledger, setLedger] = useState([])
  const actor = profile?.displayName || profile?.email || ''
  const policy = resolveMembershipPolicy(tenant)

  useEffect(() => {
    if (!tid || !phone) { setC(null); return }
    getCustomerByPhone(tid, phone).then(setC)
  }, [tid, phone])
  useEffect(() => { if (!tid || !phone) return; return watchLoyaltyLog(tid, phone, setLedger) }, [tid, phone])

  const save = (patch) => {
    setC((p) => ({ ...(p || {}), ...patch }))
    setCustomerFlag(tid, phone, { ...patch, staffRatedBy: actor })
  }
  const doGrant = async () => { const nm = await grantMembership(tid, phone, { source: 'manual', policy }); if (nm) setC((p) => ({ ...(p || {}), membership: nm })) }
  const doRedeem = async () => { const pts = Number(redeemPts) || 0; if (pts <= 0) return; const upd = await redeemPoints(tid, phone, { points: pts, actor }); if (upd) { setC((p) => ({ ...(p || {}), membership: upd })); setRedeemPts('') } }
  const doBonus = async () => { const pts = Number(bonusPts) || 0; if (pts <= 0) return; const upd = await addBonusPoints(tid, phone, { points: pts, actor, policy }); if (upd) { setC((p) => ({ ...(p || {}), membership: upd })); setBonusPts('') } }
  const doRevoke = async () => { await setMembershipActive(tid, phone, false); setC((p) => ({ ...(p || {}), membership: { ...(p?.membership || {}), active: false } })) }

  const orders = c?.totalOrders || 0
  const cancels = c?.cancelCount || 0
  const noShows = c?.noShowCount || 0
  const rating = c?.staffRating || 0
  const cancelRate = orders ? cancels / orders : 0

  let band = { t: ar ? 'عميل جيد' : 'Good standing', cls: 'badge-success' }
  if (c?.flagged || noShows >= 2 || cancelRate > 0.3) band = { t: ar ? 'يتطلب انتباه' : 'Needs attention', cls: 'badge-danger' }
  else if (orders >= 5 && rating >= 4) band = { t: ar ? 'عميل مميّز' : 'VIP' , cls: 'badge-gold' }
  const suggestTag = !c?.flagged && (noShows >= 2 || cancels >= 3)
  const mem = c?.membership?.active ? c.membership : null

  return (
    <Sheet open={!!phone} onClose={onClose} title={name || (ar ? 'بطاقة العميل' : 'Customer')}>
      {c === undefined ? (
        <p className="muted small">…</p>
      ) : (
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="row-between">
            <div className="stack" style={{ gap: 2 }}><strong>{c?.name || name || (ar ? 'بدون اسم' : 'No name')}</strong><span className="xs faint">{phone}</span></div>
            <span className={`badge ${band.cls}`}>{band.t}</span>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Stat label={ar ? 'طلبات' : 'Orders'} value={orders} />
            <Stat label={ar ? 'إنفاق' : 'Spent'} value={<Price value={c?.totalSpent || 0} currency={currency} lang={lang} />} />
            <Stat label={ar ? 'ولاء' : 'Loyalty'} value={c?.rewards || 0} />
            <Stat label={ar ? 'إلغاءات' : 'Cancels'} value={cancels} danger={cancels > 0} />
            <Stat label={ar ? 'عدم حضور' : 'No-shows'} value={noShows} danger={noShows > 0} />
          </div>

          {/* VIP membership */}
          <MemberSection ar={ar} lang={lang} currency={currency} policy={policy} m={mem} eligible={mem ? false : isEligible(policy, c || {})} totalOrders={c?.totalOrders || 0}
            cardUrl={mem && tenant?.slug ? `${publicBaseUrl()}/mcard/${tenant.slug}/${mem.token}` : ''} ledger={ledger}
            redeemPts={redeemPts} setRedeemPts={setRedeemPts} onGrant={doGrant} onRedeem={doRedeem} onRevoke={doRevoke}
            bonusPts={bonusPts} setBonusPts={setBonusPts} onBonus={doBonus} />

          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="xs faint">{ar ? 'عيد الميلاد:' : 'Birthday:'}</span>
            <input className="input" type="date" style={{ maxWidth: 170 }} value={c?.birthday ? `2000-${c.birthday}` : ''} onChange={(e) => save({ birthday: e.target.value ? e.target.value.slice(5) : '' })} />
          </div>

          {/* marketing: one-tap direct message + the customer's opt-out */}
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-sm btn-outline" href={`/admin/campaigns?to=${encodeURIComponent((phone || '').replace(/[^0-9]/g, ''))}`}>
              <Icon name="bellRing" size={14} /> {ar ? 'أرسل له رسالة' : 'Message customer'}
            </a>
            <label className="row" style={{ gap: 6, cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={c?.optOut === true} onChange={(e) => save({ optOut: e.target.checked })} style={{ width: 18, height: 18 }} />
              <span className="xs">{ar ? 'إيقاف الرسائل التسويقية عنه' : 'Opt out of marketing messages'}</span>
            </label>
          </div>

          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            <span className="xs faint">{ar ? 'تقييم الموظف:' : 'Staff rating:'}</span>
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} className="icon-btn" style={{ width: 30, height: 30, color: rating >= s ? 'var(--gold, #e0a82e)' : 'var(--text-faint)' }} onClick={() => save({ staffRating: s })}><Icon name="star" size={17} fill="currentColor" strokeWidth={1.4} /></button>
            ))}
            {rating ? <button className="icon-btn xs faint" style={{ width: 26, height: 26 }} onClick={() => save({ staffRating: 0 })} title={ar ? 'مسح' : 'Clear'}><Icon name="close" size={13} /></button> : null}
          </div>

          {suggestTag && (
            <button className="btn btn-outline btn-block" onClick={() => save({ flagged: true, flagNote: ar ? 'وسم تلقائي: تكرار الإلغاء/عدم الحضور' : 'Auto: repeated cancels/no-shows' })}>
              <Icon name="complaint" size={15} /> {ar ? 'تطبيق الوسم التلقائي المقترح' : 'Apply suggested tag'}
            </button>
          )}

          <label className="row-between" style={{ cursor: 'pointer', gap: 8 }}>
            <span className="small">{ar ? 'وسم العميل (تنبيه عند طلبه القادم)' : 'Tag (warn on next order)'}</span>
            <input type="checkbox" checked={!!c?.flagged} onChange={(e) => save({ flagged: e.target.checked })} style={{ width: 20, height: 20 }} />
          </label>
          {c?.flagged && <input className="input" placeholder={ar ? 'سبب الوسم (اختياري)' : 'Tag reason (optional)'} defaultValue={c?.flagNote || ''} onBlur={(e) => save({ flagNote: e.target.value.trim() })} />}
        </div>
      )}
    </Sheet>
  )
}

function Stat({ label, value, danger }) {
  return (
    <div className="card card-pad stack center" style={{ gap: 2, padding: '8px 10px', flex: '1 0 28%' }}>
      <span className="bold" style={{ color: danger ? 'var(--danger)' : undefined }}>{value}</span>
      <span className="xs faint">{label}</span>
    </div>
  )
}

function MemberSection({ ar, lang, currency, policy, m, eligible, totalOrders = 0, cardUrl, ledger = [], redeemPts, setRedeemPts, onGrant, onRedeem, onRevoke, bonusPts, setBonusPts, onBonus }) {
  const [copied, setCopied] = useState(false)
  const copyCard = async () => { try { await navigator.clipboard.writeText(cardUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) { /* ignore */ } }
  const fmtDay = (ms) => { try { return new Date(ms).toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-US', { month: 'short', day: 'numeric' }) } catch (_) { return '' } }
  if (!policy?.enabled) {
    return <div className="card card-pad xs faint">{ar ? 'عضوية VIP غير مُفعّلة — فعّلها من الإعدادات.' : 'VIP membership disabled — enable it in Settings.'}</div>
  }
  if (!m) {
    return (
      <div className="card card-pad stack" style={{ gap: 8 }}>
        <div className="row-between"><strong className="small"><Icon name="award" size={14} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} /> {ar ? 'عضوية VIP' : 'VIP membership'}</strong>{eligible && <span className="badge badge-success">{ar ? 'مؤهّل تلقائياً' : 'Eligible'}</span>}</div>
        <button className="btn btn-primary btn-block" onClick={onGrant}>{ar ? 'امنح العضوية' : 'Grant membership'}</button>
        <span className="xs faint">{ar ? 'تُمنح تلقائياً عند بلوغ شروط الإعدادات، أو يدوياً هنا.' : 'Auto-granted on meeting policy, or manually here.'}</span>
      </div>
    )
  }
  const meta = TIER_META[m.tier] || TIER_META.silver
  const prog = nextTierProgress(policy, m.pointsLifetime || 0, totalOrders)
  const worth = pointsToDiscount(policy, m.points || 0)
  const pct = prog ? Math.min(100, Math.round(((prog.have || 0) / (prog.need || 1)) * 100)) : 100
  return (
    <div className="card card-pad stack" style={{ gap: 8, borderColor: meta.color }}>
      <div className="row-between">
        <strong className="small" style={{ color: meta.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={meta.icon} size={14} /> {ar ? 'عضو' : 'Member'} {ar ? meta.ar : meta.en}</strong>
        <span className="xs faint num" dir="ltr">{m.memberId}</span>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Stat label={ar ? 'النقاط' : 'Points'} value={m.points || 0} />
        <Stat label={ar ? 'قيمتها' : 'Worth'} value={<Price value={worth} currency={currency} lang={lang} />} />
        <Stat label={ar ? 'خصم دائم' : 'Discount'} value={`${m.discountPct || 0}%`} />
      </div>
      {prog ? (
        <div className="stack" style={{ gap: 3 }}>
          <div className="xs faint">{ar ? `${prog.remaining} نقطة للترقية إلى ${TIER_META[prog.next] ? (ar ? TIER_META[prog.next].ar : TIER_META[prog.next].en) : ''}` : `${prog.remaining} pts to ${prog.next}`}</div>
          <div style={{ height: 5, borderRadius: 99, background: 'var(--surface-2)' }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: meta.color }} /></div>
        </div>
      ) : <div className="xs" style={{ color: meta.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="award" size={12} /> {ar ? 'أعلى مستوى' : 'Top tier'}</div>}
      <div className="row" style={{ gap: 6 }}>
        <input className="input num" style={{ width: 90 }} type="number" min="1" placeholder={ar ? 'نقاط' : 'pts'} value={redeemPts} onChange={(e) => setRedeemPts(e.target.value)} />
        <button className="btn btn-sm btn-success grow" disabled={!redeemPts || Number(redeemPts) > (m.points || 0)} onClick={onRedeem}>{ar ? 'استبدال نقاط' : 'Redeem'}</button>
      </div>
      {/* manual bonus (compensation / promo): counts toward tier, logged with the actor's name */}
      <div className="row" style={{ gap: 6 }}>
        <input className="input num" style={{ width: 90 }} type="number" min="1" placeholder={ar ? 'نقاط' : 'pts'} value={bonusPts} onChange={(e) => setBonusPts(e.target.value)} />
        <button className="btn btn-sm grow" disabled={!bonusPts || Number(bonusPts) <= 0} onClick={onBonus}><Icon name="add" size={14} /> {ar ? 'إضافة نقاط (مكافأة)' : 'Add bonus points'}</button>
      </div>
      {cardUrl && (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-outline grow" onClick={copyCard}><Icon name="qr" size={14} /> {copied ? (ar ? 'تم النسخ ✓' : 'Copied ✓') : (ar ? 'نسخ رابط البطاقة' : 'Copy card link')}</button>
          <a className="btn btn-sm btn-outline grow" href={cardUrl} target="_blank" rel="noreferrer">{ar ? 'فتح البطاقة' : 'Open card'}</a>
        </div>
      )}
      {ledger.length > 0 && (
        <details>
          <summary className="xs faint" style={{ cursor: 'pointer' }}>{ar ? 'كشف النقاط' : 'Points statement'} ({ledger.length})</summary>
          <div className="stack" style={{ gap: 3, marginTop: 6 }}>
            {ledger.slice(0, 20).map((e) => (
              <div key={e.id} className="row-between xs">
                <span className="faint">{fmtDay(e.at)}{e.byName ? ` · ${e.byName}` : ''}</span>
                <span style={{ color: e.type === 'redeem' ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{e.type === 'redeem' ? '−' : '+'}{e.points} {ar ? 'نقطة' : 'pts'}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <button className="btn btn-sm btn-outline" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={onRevoke}>{ar ? 'إلغاء العضوية' : 'Revoke'}</button>
    </div>
  )
}
