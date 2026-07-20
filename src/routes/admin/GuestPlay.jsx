// «نشاط الألعاب والتحليل» — the admin surface over game memory.
//
// Reads two collections written by src/lib/gameMemory.js:
//   tenants/{tid}/gamePlays        one doc per play, with its answers
//   tenants/{tid}/playerProfiles   one rollup doc per device
//
// Both reads are HARD-BOUNDED. A busy venue accumulates plays faster than
// orders, and an unbounded read here would be a runaway bill and a frozen tab.
// When a bound is hit the page says so rather than quietly analysing a slice.
import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db, firebaseReady } from '../../lib/firebase.js'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { Spinner } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { CAP } from '../../lib/permissions.js'
import { listCustomers } from '../../lib/db.js'
import { fmtNum } from '../../lib/format.js'
import { PLAY_AI_GUARD_AR } from '../../lib/gameMemory.js'

import PlayOverview from '../../components/play/PlayOverview.jsx'
import PlayersTable from '../../components/play/PlayersTable.jsx'
import PlayerPanel from '../../components/play/PlayerPanel.jsx'
import PlaySegments from '../../components/play/PlaySegments.jsx'
import PlayAi from '../../components/play/PlayAi.jsx'
import PlayEmpty from '../../components/play/PlayEmpty.jsx'
import {
  overview, gameStats, quizAccuracy, hardestQuestions, archetypeSpread,
  playersFrom, buildSegments, ruleFindings, venueAiSnapshot, dayStamp,
} from '../../components/play/engine.jsx'

import '../../styles/guestplay.css'

const MAX_PLAYS = 700
const MAX_PROFILES = 400

const TABS = [
  { key: 'overview', icon: 'chartBar', ar: 'النظرة العامة', en: 'Overview' },
  { key: 'players', icon: 'customers', ar: 'اللاعبون', en: 'Players' },
  { key: 'segments', icon: 'layers', ar: 'الشرائح', en: 'Segments' },
  { key: 'ai', icon: 'sparkles', ar: 'تحليل بالذكاء', en: 'AI analysis' },
]

const PERIODS = [
  { key: 'd7', ar: '7 أيام', en: '7 days' },
  { key: 'd30', ar: '30 يوماً', en: '30 days' },
  { key: 'd90', ar: '90 يوماً', en: '90 days' },
  { key: 'custom', ar: 'مخصص', en: 'Custom' },
]

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

function periodRange(key, custom = {}) {
  const now = new Date()
  let from = startOfDay(now)
  let to = endOfDay(now)
  if (key === 'd7') { from = startOfDay(now); from.setDate(from.getDate() - 6) }
  else if (key === 'd30') { from = startOfDay(now); from.setDate(from.getDate() - 29) }
  else if (key === 'd90') { from = startOfDay(now); from.setDate(from.getDate() - 89) }
  else if (key === 'custom') {
    from = custom.from ? startOfDay(new Date(custom.from)) : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
    to = custom.to ? endOfDay(new Date(custom.to)) : endOfDay(now)
  }
  if (Number.isNaN(from.getTime())) from = startOfDay(now)
  if (Number.isNaN(to.getTime())) to = endOfDay(now)
  return { from, to }
}

const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))

// Bounded, newest-first, with progressive fallback. A missing composite index
// or a strict rule degrades to "fewer plays", never to a blank page.
async function fetchPlays(tid, fromMs, toMs) {
  const inWindow = (p) => {
    const t = Number(p.startedAt) || 0
    return t >= fromMs && t <= toMs
  }
  const ref = collection(db, 'tenants', tid, 'gamePlays')
  try {
    return rowsOf(await getDocs(query(ref, where('startedAt', '>=', fromMs), orderBy('startedAt', 'desc'), limit(MAX_PLAYS)))).filter(inWindow)
  } catch (_) { /* try the simpler shapes below */ }
  try {
    return rowsOf(await getDocs(query(ref, orderBy('startedAt', 'desc'), limit(MAX_PLAYS)))).filter(inWindow)
  } catch (_) { /* fall through */ }
  try {
    return rowsOf(await getDocs(query(ref, limit(MAX_PLAYS)))).filter(inWindow)
  } catch (_) { return [] }
}

// Profiles are an enrichment, never a requirement: a venue whose rules block
// this collection still gets a complete page rebuilt from raw plays.
async function fetchProfiles(tid) {
  const ref = collection(db, 'tenants', tid, 'playerProfiles')
  try {
    return rowsOf(await getDocs(query(ref, orderBy('lastAt', 'desc'), limit(MAX_PROFILES))))
  } catch (_) { /* no index — unordered */ }
  try {
    return rowsOf(await getDocs(query(ref, limit(MAX_PROFILES))))
  } catch (_) { return [] }
}

export default function GuestPlay({ onCreateCampaign }) {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const { tenantId, tenant, isManager, can } = useAuth()
  const allowed = isManager || can(CAP.VIEW_REPORTS) || can(CAP.MANAGE_CAMPAIGNS)
  const aiAllowed = can(CAP.USE_ASSISTANT)

  const [tab, setTab] = useState('overview')
  const [periodKey, setPeriodKey] = useState('d30')
  const [custom, setCustom] = useState(() => {
    const r = periodRange('d30')
    return { from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10) }
  })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [openPlayer, setOpenPlayer] = useState(null)

  const { from, to } = useMemo(() => periodRange(periodKey, custom), [periodKey, custom])
  const fromMs = from.getTime()
  const toMs = to.getTime()

  useEffect(() => {
    if (!tenantId || !allowed) return undefined
    let alive = true
    setData(null); setErr(''); setOpenPlayer(null)
    ;(async () => {
      try {
        // Sentinel, not a sentence: the message is translated at render time so
        // this effect never has to depend on the active language.
        if (!firebaseReady) throw new Error('not-configured')
        const [plays, profiles, customers] = await Promise.all([
          fetchPlays(tenantId, fromMs, toMs),
          fetchProfiles(tenantId),
          listCustomers(tenantId, 400).catch(() => []),
        ])
        if (!alive) return
        setData({ plays, profiles, customers })
      } catch (e) {
        if (alive) setErr(e && e.message ? e.message : String(e))
      }
    })()
    return () => { alive = false }
  }, [tenantId, allowed, fromMs, toMs])

  const plays = data ? data.plays : []
  const profiles = data ? data.profiles : []
  const customers = data ? data.customers : []

  const over = useMemo(() => overview(plays), [plays])
  const games = useMemo(() => gameStats(plays), [plays])
  const quiz = useMemo(() => quizAccuracy(plays), [plays])
  const hard = useMemo(() => hardestQuestions(plays), [plays])
  const players = useMemo(() => playersFrom(plays, profiles), [plays, profiles])
  const archetypes = useMemo(() => archetypeSpread(players), [players])
  const segments = useMemo(() => buildSegments(players, customers), [players, customers])
  const findings = useMemo(
    () => ruleFindings({ over, games, quiz, hard, segments, players }),
    [over, games, quiz, hard, segments, players],
  )

  const periodLabel = `${dayStamp(fromMs)} — ${dayStamp(toMs)}`

  // The ONLY object that ever reaches the model. Built from the same functions
  // that render every table above, so the two can never disagree.
  const snapshot = useMemo(() => (data ? venueAiSnapshot({
    over, games, quiz, hard, archetypes, segments,
    periodLabel, venue: (tenant && tenant.name) || '',
  }) : null), [data, over, games, quiz, hard, archetypes, segments, periodLabel, tenant])

  const selected = useMemo(
    () => (openPlayer ? players.find((p) => p.deviceId === openPlayer) || null : null),
    [openPlayer, players],
  )

  if (!allowed) {
    return (
      <div className="gp-page">
        <div className="gp-card">
          <p className="gp-hint">{ar ? 'لا تملك صلاحية عرض تقارير هذا المكان.' : 'You do not have permission to view reports.'}</p>
        </div>
      </div>
    )
  }

  const truncated = plays.length >= MAX_PLAYS

  return (
    <div className="gp-page">
      <div className="gp-head">
        <div className="gp-head-t">
          <strong>{ar ? 'نشاط الألعاب والتحليل' : 'Game activity & analysis'}</strong>
          <span className="gp-num">{periodLabel}</span>
        </div>
        <div className="gp-period">
          {PERIODS.map((p) => (
            <button
              key={p.key} type="button"
              className={`chip${periodKey === p.key ? ' active' : ''}`}
              aria-pressed={periodKey === p.key}
              onClick={() => setPeriodKey(p.key)}
            >{ar ? p.ar : p.en}</button>
          ))}
          {periodKey === 'custom' && (
            <>
              <input
                className="input" type="date" value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
              <input
                className="input" type="date" value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </>
          )}
        </div>
      </div>

      <div className="gp-scroll-x">
        <div className="gp-tabs">
          {TABS.map((t) => (
            <button
              key={t.key} type="button"
              className={`chip${tab === t.key ? ' active' : ''}`}
              aria-pressed={tab === t.key}
              onClick={() => { setTab(t.key); setOpenPlayer(null) }}
            >
              <Icon name={t.icon} size={15} /> {ar ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="gp-card">
          <div className="gp-warn">
            <Icon name="warning" size={15} />
            <span>
              {err === 'not-configured'
                ? (ar ? 'الاتصال بقاعدة البيانات غير مُهيَّأ في هذه البيئة.' : 'Database not configured in this environment.')
                : `${ar ? 'تعذّرت قراءة بيانات الألعاب: ' : 'Could not read play data: '}${err}`}
            </span>
          </div>
        </div>
      )}

      {!data && !err && (
        <div className="gp-card" style={{ justifyItems: 'center', padding: 30 }}><Spinner /></div>
      )}

      {data && truncated && (
        <div className="gp-warn">
          <Icon name="warning" size={15} />
          <span>{ar
            ? `بلغت القراءة الحد الأقصى (${fmtNum(MAX_PLAYS)} محاولة). كل رقم على هذه الصفحة محسوب على هذه المحاولات وحدها، وليس على كامل تاريخ المكان. ضيّق الفترة لصورة دقيقة.`
            : `Read cap reached (${fmtNum(MAX_PLAYS)} plays). Figures cover this slice only.`}</span>
        </div>
      )}

      {data && !plays.length && !profiles.length && (
        <PlayEmpty
          ar={ar}
          hasGames={!tenant || !Array.isArray(tenant.games) || tenant.games.length > 0}
          periodLabel={periodLabel}
        />
      )}

      {data && (plays.length > 0 || profiles.length > 0) && (
        <>
          {tab === 'overview' && (
            <PlayOverview
              over={over} games={games} quiz={quiz} hard={hard}
              archetypes={archetypes} findings={findings} ar={ar}
            />
          )}

          {tab === 'players' && (
            selected
              ? <PlayerPanel player={selected} ar={ar} onBack={() => setOpenPlayer(null)} />
              : <PlayersTable players={players} ar={ar} onOpen={(p) => setOpenPlayer(p.deviceId)} />
          )}

          {tab === 'segments' && (
            <PlaySegments
              segments={segments} ar={ar}
              onCreateCampaign={onCreateCampaign} periodLabel={periodLabel}
            />
          )}

          {tab === 'ai' && (
            <PlayAi
              snapshot={snapshot} segments={segments} findings={findings}
              guard={PLAY_AI_GUARD_AR} ar={ar} allowed={aiAllowed}
              disabledReason={!aiAllowed ? (ar ? 'لا تملك صلاحية استخدام المساعد الذكي.' : 'No assistant permission.') : ''}
              periodLabel={periodLabel} onCreateCampaign={onCreateCampaign}
            />
          )}
        </>
      )}
    </div>
  )
}
