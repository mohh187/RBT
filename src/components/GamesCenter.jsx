// «ركن الألعاب» — the guest-facing games hub.
//
// It owns everything around a game: the registration gate, the player card, the
// grid of enabled games, and the shell (title bar, live score, restart, close)
// that a game runs inside. Games themselves render only their play area.
//
// Works with ordering completely disabled — a browse-only venue gets the full
// games experience, and nothing here touches the cart.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { gamesFor } from '../lib/games.js'
import { registerCustomer } from '../lib/db.js'
import { getLocalCustomer, setLocalCustomer } from '../lib/customer.js'
import { submitScore, watchTopScores, currentMonth, myRank } from '../lib/leaderboard.js'
import { deviceKey } from '../lib/device.js'

const TXT = {
  ar: {
    hub: 'ركن الألعاب',
    close: 'إغلاق',
    restart: 'إعادة',
    loading: 'جارٍ تحميل اللعبة...',
    gateTitle: 'سجّل لتبدأ اللعب',
    gateWhy: 'نحفظ نتائجك ونكافئك في زيارتك القادمة — ويصلك تسجيلك لدى المكان.',
    name: 'الاسم',
    phone: 'رقم الجوال',
    namePh: 'اسمك',
    errName: 'اكتب اسمك أولاً.',
    errPhone: 'أدخل رقم جوال سعودي صحيح يبدأ بـ 05.',
    go: 'ابدأ اللعب',
    confirm: 'تأكيد ومتابعة',
    saving: 'جارٍ التسجيل...',
    offline: 'تعذّر حفظ تسجيلك لدى المكان الآن، لكن نتائجك محفوظة على جهازك ويمكنك اللعب.',
    hello: 'أهلاً',
    points: 'مجموع نقاطك',
    plays: 'الجولات',
    rank: 'ترتيبك هذا الشهر',
    of: 'من',
    best: 'أفضلك',
    noBest: 'لم تلعب بعد',
    empty: 'لم يفعّل هذا المكان أي لعبة بعد.',
    emptyHint: 'اسأل الموظفين — يمكنهم تفعيل الألعاب من لوحة التحكم.',
    boardNote: 'لوحة الصدارة الشهرية تعرض أفضل نتيجة في جولة واحدة.',
  },
  en: {
    hub: 'Games Corner',
    close: 'Close',
    restart: 'Restart',
    loading: 'Loading the game...',
    gateTitle: 'Register to play',
    gateWhy: 'We keep your scores and reward you next visit — and register you with the venue.',
    name: 'Name',
    phone: 'Mobile number',
    namePh: 'Your name',
    errName: 'Please enter your name.',
    errPhone: 'Enter a valid Saudi mobile number starting with 05.',
    go: 'Start playing',
    confirm: 'Confirm and continue',
    saving: 'Registering...',
    offline: 'We could not save your registration with the venue right now, but your scores are kept on this device.',
    hello: 'Hello',
    points: 'Total points',
    plays: 'Rounds',
    rank: 'Rank this month',
    of: 'of',
    best: 'Best',
    noBest: 'Not played yet',
    empty: 'This venue has not enabled any game yet.',
    emptyHint: 'Staff can enable games from the dashboard.',
    boardNote: 'The monthly board shows the best single-round score.',
  },
}

const storeKey = (tid) => `rbt_games_${tid || 'x'}`
const EMPTY_STORE = { v: 1, registered: false, name: '', phone: '', points: 0, plays: 0, best: {} }

function readStore(tid) {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(tid)) || 'null')
    return v && typeof v === 'object' ? { ...EMPTY_STORE, ...v, best: { ...(v.best || {}) } } : { ...EMPTY_STORE }
  } catch (_) {
    return { ...EMPTY_STORE }
  }
}
function writeStore(tid, s) {
  try { localStorage.setItem(storeKey(tid), JSON.stringify(s)) } catch (_) { /* storage off */ }
}

// Arabic-Indic digits are written as escapes on purpose: the repo hard-rule
// forbids the literal glyphs in source, but guests still type them.
function toLatinDigits(s) {
  return String(s || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => {
    const code = c.charCodeAt(0)
    return String(code - (code >= 0x06F0 ? 0x06F0 : 0x0660))
  })
}

// Saudi mobile: 05XXXXXXXX, also accepting +966 / 00966 / 966 prefixes.
// Returns the normalized 05XXXXXXXX, or '' when it is not a valid number.
export function normalizeSaPhone(raw) {
  let n = toLatinDigits(raw).replace(/\D/g, '')
  if (n.startsWith('00966')) n = n.slice(5)
  else if (n.startsWith('966')) n = n.slice(3)
  if (/^5\d{8}$/.test(n)) n = `0${n}`
  return /^05\d{8}$/.test(n) ? n : ''
}

function safeBrand(tenant) {
  const c = String(tenant?.themeColor || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  } catch (_) { /* SSR / no document */ }
  return '#0e7490'
}

export default function GamesCenter({ open, onClose, tenantId, tenant, items = [], lang = 'ar', onIdentify, onGamePlay }) {
  const t = TXT[lang] || TXT.ar
  const brand = useMemo(() => safeBrand(tenant), [tenant])
  const deviceId = useMemo(() => deviceKey(), [])
  const enabled = useMemo(() => gamesFor(tenant), [tenant])

  const [store, setStore] = useState(() => readStore(tenantId))
  const [activeId, setActiveId] = useState(null)
  const [runKey, setRunKey] = useState(0)
  const [runScore, setRunScore] = useState(0)
  const [board, setBoard] = useState(null)
  const runScoreRef = useRef(0)
  const activeRef = useRef(null)
  useEffect(() => { runScoreRef.current = runScore }, [runScore])
  useEffect(() => { activeRef.current = activeId }, [activeId])
  useEffect(() => { setStore(readStore(tenantId)) }, [tenantId])

  // ---- registration gate ----
  const localCustomer = useMemo(() => getLocalCustomer(), [])
  const [form, setForm] = useState({ name: '', phone: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState('')

  useEffect(() => {
    // Prefill from the device so a returning guest confirms with one tap.
    setForm({ name: store.name || localCustomer?.name || '', phone: store.phone || localCustomer?.phone || '' })
  }, [store.name, store.phone, localCustomer])

  const gated = !store.registered

  const submitGate = async (e) => {
    e?.preventDefault?.()
    const nm = String(form.name || '').trim()
    if (nm.length < 2) { setErr(t.errName); return }
    const ph = normalizeSaPhone(form.phone)
    if (!ph) { setErr(t.errPhone); return }
    setErr('')
    setBusy(true)
    let ok = true
    try {
      // reuse the venue's real CRM registration, so the guest lands in it
      await registerCustomer(tenantId, { name: nm, phone: ph })
    } catch (_) {
      ok = false
    }
    setLocalCustomer({ name: nm, phone: ph })
    const next = { ...readStore(tenantId), registered: true, name: nm, phone: ph }
    writeStore(tenantId, next)
    setStore(next)
    setWarn(ok ? '' : t.offline)
    setBusy(false)
    try { onIdentify?.({ name: nm, phone: ph }) } catch (_) { /* caller's problem, not the guest's */ }
  }

  // ---- monthly board (for the rank line only) ----
  useEffect(() => {
    if (!open || gated || !tenantId) return undefined
    const unsub = watchTopScores(tenantId, currentMonth(), (b) => setBoard(b))
    return () => { try { unsub?.() } catch (_) { /* already gone */ } }
  }, [open, gated, tenantId])

  const rank = board && !board.error ? myRank(board.scores, deviceId) : null

  // ---- runs ----
  // A finished run adds to lifetime points, updates the per-game device best,
  // and is offered to the shared monthly board (which keeps only a record).
  const commitRun = () => {
    const id = activeRef.current
    const s = Math.max(0, Math.round(runScoreRef.current || 0))
    if (!id || s <= 0) return
    const prev = readStore(tenantId)
    const next = {
      ...prev,
      points: (prev.points || 0) + s,
      plays: (prev.plays || 0) + 1,
      best: { ...prev.best, [id]: Math.max(prev.best?.[id] || 0, s) },
    }
    writeStore(tenantId, next)
    setStore(next)
    if (tenantId && deviceId) {
      submitScore(tenantId, { name: next.name, score: s, deviceId }).catch(() => { /* board is best-effort */ })
    }
    // Report the finished run to behaviour analytics (which game, what score) —
    // this is what makes "played a game vs not" a real cohort.
    onGamePlay?.(id, s)
  }

  const openGame = (id) => { setRunScore(0); runScoreRef.current = 0; setActiveId(id); setRunKey((k) => k + 1) }
  const restart = () => { commitRun(); setRunScore(0); runScoreRef.current = 0; setRunKey((k) => k + 1) }
  const exitGame = () => { commitRun(); setActiveId(null); setRunScore(0); runScoreRef.current = 0 }
  const closeHub = () => { commitRun(); setActiveId(null); onClose?.() }

  const active = activeId ? enabled.find((g) => g.id === activeId) : null
  const Comp = useMemo(() => (active ? lazy(() => active.load()) : null), [active])

  if (!open) return null

  return (
    <div className="gc-overlay" role="dialog" aria-modal="true" aria-label={t.hub}>
      <header className="gc-bar">
        <button type="button" className="gc-x" onClick={active ? exitGame : closeHub} aria-label={t.close}>
          <Icon name={active ? 'back' : 'close'} size={20} />
        </button>
        <strong className="gc-bar-title">{active ? (lang === 'en' ? active.en : active.ar) : t.hub}</strong>
        {active ? (
          <>
            <span className="gc-live" style={{ color: brand }}>{runScore}</span>
            <button type="button" className="gc-x" onClick={restart} aria-label={t.restart}>
              <Icon name="reload" size={18} />
            </button>
            <button type="button" className="gc-x" onClick={closeHub} aria-label={t.close}>
              <Icon name="close" size={20} />
            </button>
          </>
        ) : null}
      </header>

      {active && Comp ? (
        <div className="gc-stage">
          <Suspense fallback={<div className="gc-loading">{t.loading}</div>}>
            <Comp
              key={runKey}
              onScore={setRunScore}
              onExit={exitGame}
              lang={lang}
              brand={brand}
              items={items}
              playerName={store.name}
              tenantId={tenantId}
            />
          </Suspense>
        </div>
      ) : gated ? (
        <form className="gc-body gc-gate" onSubmit={submitGate}>
          <span className="gc-gate-ico" style={{ background: brand }}><Icon name="award" size={24} /></span>
          <strong className="gc-gate-title">{t.gateTitle}</strong>
          <p className="gc-gate-why">{t.gateWhy}</p>
          <label className="gc-field">
            <span>{t.name}</span>
            <input
              type="text"
              value={form.name}
              placeholder={t.namePh}
              autoComplete="name"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="gc-field">
            <span>{t.phone}</span>
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={form.phone}
              placeholder="05XXXXXXXX"
              autoComplete="tel"
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          {err && <p className="gc-err">{err}</p>}
          <button type="submit" className="gc-cta" style={{ background: brand }} disabled={busy}>
            <Icon name={busy ? 'clock' : 'play'} size={16} />
            {busy ? t.saving : (localCustomer?.phone ? t.confirm : t.go)}
          </button>
        </form>
      ) : (
        <div className="gc-body">
          {warn && <p className="gc-warn">{warn}</p>}

          <section className="gc-player" style={{ borderColor: brand }}>
            <span className="gc-avatar" style={{ background: brand }}><Icon name="user" size={20} /></span>
            <div className="gc-player-main">
              <strong className="gc-player-name">{t.hello} {store.name}</strong>
              <div className="gc-stats">
                <span><b>{store.points}</b> {t.points}</span>
                <span><b>{store.plays}</b> {t.plays}</span>
                {rank ? <span><b>{rank.rank}</b> {t.rank} ({t.of} {rank.total})</span> : null}
              </div>
            </div>
          </section>

          {enabled.length === 0 ? (
            <div className="gc-empty">
              <span className="gc-gate-ico" style={{ background: brand }}><Icon name="theater" size={22} /></span>
              <p className="gc-gate-why">{t.empty}</p>
              <p className="gc-gate-why faint">{t.emptyHint}</p>
            </div>
          ) : (
            <>
              <div className="gc-grid">
                {enabled.map((g) => (
                  <button key={g.id} type="button" className="gc-card" onClick={() => openGame(g.id)}>
                    <span className="gc-card-ico" style={{ background: brand }}><Icon name={g.icon} size={22} /></span>
                    <strong className="gc-card-nm">{lang === 'en' ? g.en : g.ar}</strong>
                    <span className="gc-card-desc">{lang === 'en' ? g.descEn : g.desc}</span>
                    <span className="gc-card-best">
                      {store.best?.[g.id] ? `${t.best} ${store.best[g.id]}` : t.noBest}
                    </span>
                  </button>
                ))}
              </div>
              <p className="gc-note">{t.boardNote}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
