// The venue's own usage meter — what it has spent this month, what the server
// will actually allow, and how to buy more.
//
// Three rules shaped this component:
//   1. It shows the SAME number the server enforces. limitsFor() here is a
//      mirror of the function that grants or refuses each send, so «you have
//      1,200 of 6,000 left» is a promise, not an estimate.
//   2. When something WAS refused it says so, in words, with the reason. A
//      venue whose messages silently stop reaching guests files a support
//      ticket about «WhatsApp is broken»; a venue that can see «you passed
//      your daily ceiling, it resets tomorrow» does not.
//   3. Hitting a ceiling offers a way out in the same breath. A limit with no
//      purchase button is a dead end, and the venue's next move is a phone
//      call to support instead of a payment.
import { useEffect, useState } from 'react'
import { Price } from './Riyal.jsx'
import Icon from '../components/Icon.jsx'
import { useToast } from './Toast.jsx'
import { CHANNELS, SPEND_PACKS, limitsFor, extraOf, watchVenueSpend, buySpendPack } from '../lib/spend.js'

const n = (v) => (Number(v) || 0).toLocaleString('en-US')

const REASON = {
  ar: {
    cap: 'بلغت السقف الشهري — اشترِ رصيداً إضافياً أو انتظر تجدّد الشهر.',
    daily: 'بلغت السقف اليومي — يتجدّد غداً.',
    burst: 'إرسال كثيف في وقت قصير أوقف الباقي مؤقتاً.',
    killed: 'موقوف مؤقتاً من إدارة المنصة.',
  },
  en: {
    cap: 'Monthly ceiling reached — buy a top-up or wait for next month.',
    daily: 'Daily ceiling reached — resets tomorrow.',
    burst: 'Too many at once; the rest were held back.',
    killed: 'Paused by the platform.',
  },
}

export default function SpendMeter({ tenantId, tenant, ar = true, compact = false, defaultOpen = '' }) {
  const toast = useToast()
  const [usage, setUsage] = useState(null)
  // A low-balance notice links straight here as /admin/billing?buy=waMarketing,
  // so the packs for THAT channel are already expanded. One tap from the
  // notification to checkout — removing that tap is worth more than any
  // wording change.
  const [open, setOpen] = useState(defaultOpen)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!tenantId) return undefined
    return watchVenueSpend(tenantId, setUsage)
  }, [tenantId])

  if (!tenantId) return null
  // No spinner: an empty month is the normal state on the first of the month,
  // and a meter that spins forever is worse than one that reads zero.
  const u = usage || {}

  const buy = async (channel, pack) => {
    setBusy(`${channel}:${pack.qty}`)
    try {
      // Navigation to the checkout happens inside buySpendPack.
      await buySpendPack(tenantId, channel, pack.qty)
    } catch (e) {
      toast.error(e?.message || (ar ? 'تعذّر فتح صفحة الدفع' : 'Could not open checkout'))
      setBusy('')
    }
  }

  const rows = CHANNELS.map((c) => {
    const lim = limitsFor(tenant, c.key)
    const used = Number(u[c.key]) || 0
    const blocked = Number(u.blocked?.[c.key]) || 0
    const unlimited = lim.month < 0
    const pct = unlimited || !lim.month ? 0 : Math.min(100, (used / lim.month) * 100)
    return { c, lim, used, blocked, unlimited, pct, reason: u.blockedReason?.[c.key], extra: extraOf(tenant, c.key) }
  }).filter((r) => !compact || r.used > 0 || r.blocked > 0)

  if (compact && !rows.length) return null

  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row-between wrap" style={{ gap: 8 }}>
        <strong className="small row" style={{ gap: 6, alignItems: 'center' }}>
          <Icon name="chartBar" size={16} /> {ar ? 'استهلاك هذا الشهر' : 'This month’s usage'}
        </strong>
        {u.period ? <span className="xs faint num" dir="ltr">{u.period}</span> : null}
      </div>

      <div className="stack" style={{ gap: 14 }}>
        {rows.map(({ c, lim, used, blocked, unlimited, pct, reason, extra }) => {
          const packs = SPEND_PACKS[c.key] || []
          // A channel the plan switches off entirely is an UPGRADE prompt, not
          // a top-up one — selling credit for a feature the venue cannot open
          // would take money for nothing.
          const lockedByPlan = lim.plan === 0 && !extra
          return (
            <div key={c.key} className="stack" style={{ gap: 4 }}>
              <div className="row-between" style={{ gap: 8, alignItems: 'baseline' }}>
                <span className="small row" style={{ gap: 6, alignItems: 'center' }}>
                  <Icon name={c.icon} size={14} className="faint" /> {c.ar}
                </span>
                <span className="xs num" dir="ltr">
                  {n(used)}{unlimited ? '' : ` / ${n(lim.month)}`}
                </span>
              </div>

              {!unlimited && lim.month > 0 && (
                <div className={`spend-bar${pct >= 100 ? ' is-full' : pct >= 80 ? ' is-near' : ''}`}>
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}

              {extra > 0 && (
                <span className="xs" style={{ color: 'var(--brand)' }}>
                  {ar
                    ? `يشمل ${n(extra)} ${c.unit} من رصيد مشترى — يُخصم مع الاستخدام`
                    : `Includes ${n(extra)} purchased ${c.unit} — drawn down as you use them`}
                </span>
              )}

              {blocked > 0 && (
                <div className="xs" style={{ color: 'var(--danger)' }}>
                  {ar ? `لم يُنفَّذ ${n(blocked)} — ` : `${n(blocked)} not delivered — `}
                  {(REASON[ar ? 'ar' : 'en'][reason]) || (ar ? 'تم بلوغ الحد.' : 'Limit reached.')}
                </div>
              )}

              {!compact && <span className="xs faint">{c.hint}</span>}

              {lockedByPlan ? (
                <span className="xs faint">
                  {ar ? 'متاح في الباقة المتكاملة — رقِّ اشتراكك لتفعيله.' : 'Available on the Enterprise plan.'}
                </span>
              ) : packs.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => setOpen(open === c.key ? '' : c.key)}
                  >
                    <Icon name="add" size={13} /> {ar ? 'شراء رصيد إضافي' : 'Buy more'}
                  </button>
                  {open === c.key && (
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {packs.map((p) => (
                        <button
                          key={p.qty}
                          className="btn btn-sm btn-primary"
                          disabled={busy === `${c.key}:${p.qty}`}
                          onClick={() => buy(c.key, p)}
                        >
                          <span className="num" dir="ltr">+{n(p.qty)}</span>
                          <span className="xs" style={{ opacity: 0.85 }}>
                            <Price value={p.sar} lang={ar ? 'ar' : 'en'} symbolSize="0.85em" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <span className="xs faint">
        {ar
          ? 'تُحتسب الحدود على الخادم قبل الإرسال. الرصيد المشترى يُضاف فوق سقف باقتك ويُستهلك أولاً بعده، ولا ينتهي بنهاية الشهر.'
          : 'Limits are enforced server-side before sending. Purchased credit sits on top of your plan, is consumed after it, and does not expire at month end.'}
      </span>
    </div>
  )
}
