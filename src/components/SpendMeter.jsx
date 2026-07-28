// The venue's own usage meter — what it has spent this month against what the
// server will actually allow.
//
// Two rules shaped this component:
//   1. It shows the SAME number the server enforces. limitsFor() here is a
//      mirror of the function that grants or refuses each send, so «you have
//      1,200 of 6,000 left» is a promise, not an estimate.
//   2. When something WAS refused it says so, in words, with the reason. A
//      venue whose messages silently stop reaching guests files a support
//      ticket about «WhatsApp is broken»; a venue that can see «you passed
//      your daily ceiling, it resets tomorrow» does not.
import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { CHANNELS, limitsFor, watchVenueSpend } from '../lib/spend.js'

const n = (v) => (Number(v) || 0).toLocaleString('en-US')

const REASON = {
  ar: {
    cap: 'بلغت السقف الشهري — يتجدّد أول الشهر.',
    daily: 'بلغت السقف اليومي — يتجدّد غداً.',
    burst: 'إرسال كثيف في وقت قصير أوقف الباقي مؤقتاً.',
    killed: 'موقوف مؤقتاً من إدارة المنصة.',
  },
  en: {
    cap: 'Monthly ceiling reached — resets next month.',
    daily: 'Daily ceiling reached — resets tomorrow.',
    burst: 'Too many at once; the rest were held back.',
    killed: 'Paused by the platform.',
  },
}

export default function SpendMeter({ tenantId, tenant, ar = true, compact = false }) {
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    if (!tenantId) return undefined
    return watchVenueSpend(tenantId, setUsage)
  }, [tenantId])

  if (!tenantId) return null
  // No spinner: an empty month is the normal state on the first of the month,
  // and a meter that spins forever is worse than one that reads zero.
  const u = usage || {}

  const rows = CHANNELS.map((c) => {
    const lim = limitsFor(tenant, c.key)
    const used = Number(u[c.key]) || 0
    const blocked = Number(u.blocked?.[c.key]) || 0
    const unlimited = lim.month < 0
    const pct = unlimited || !lim.month ? 0 : Math.min(100, (used / lim.month) * 100)
    return { c, lim, used, blocked, unlimited, pct, reason: u.blockedReason?.[c.key] }
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

      <div className="stack" style={{ gap: 12 }}>
        {rows.map(({ c, lim, used, blocked, unlimited, pct, reason }) => (
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
            {blocked > 0 && (
              <div className="xs" style={{ color: 'var(--danger)' }}>
                {ar ? `لم تُرسَل ${n(blocked)} — ` : `${n(blocked)} not sent — `}
                {(REASON[ar ? 'ar' : 'en'][reason]) || (ar ? 'تم بلوغ الحد.' : 'Limit reached.')}
              </div>
            )}
            {!compact && <span className="xs faint">{c.hint}</span>}
          </div>
        ))}
      </div>

      <span className="xs faint">
        {ar
          ? 'تُحتسب الحدود على الخادم قبل الإرسال. للرفع أو الاستفسار تواصل مع إدارة المنصة.'
          : 'Limits are enforced server-side before sending. Contact the platform to raise them.'}
      </span>
    </div>
  )
}
