// «مركز الألعاب» — the admin home for everything the games system does.
//
// This page supersedes the small on/off list that lived in Settings. It writes
// the SAME `tenant.games` array that list wrote, so the two can never disagree
// about which games a venue shows — and it adds the venue's own ORDER, live
// per-game figures, tournaments, the player roster, the live tables, and the
// reward rules.
//
// Data discipline, applied to every tab:
//   • every read is bounded (see engine.jsx) and degrades progressively, so a
//     missing index or a strict rule costs rows, never the page;
//   • every figure is counted off a document the venue actually wrote — nothing
//     is estimated, and a sample too small to trust is labelled, not hidden;
//   • no state can leave a spinner hanging: loading, empty, error and
//     no-permission are four distinct, explicit screens.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Spinner } from '../../components/ui.jsx'
import { useToast } from '../../components/Toast.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { useI18n } from '../../lib/i18n.jsx'
import { CAP } from '../../lib/permissions.js'
import { updateTenant } from '../../lib/db.js'
import { firebaseReady } from '../../lib/firebase.js'

import GamesCatalogue from '../../components/gamesadmin/GamesCatalogue.jsx'
import TournamentsPanel from '../../components/gamesadmin/TournamentsPanel.jsx'
import PlayersPanel from '../../components/gamesadmin/PlayersPanel.jsx'
import LiveRoomsPanel from '../../components/gamesadmin/LiveRoomsPanel.jsx'
import RewardsPanel from '../../components/gamesadmin/RewardsPanel.jsx'
import {
  PERIODS, periodRange, fetchPlays, fetchProfiles, fetchScores, fetchClaims,
  fmtInt, dayStamp,
} from '../../components/gamesadmin/engine.jsx'

import '../../styles/gamesadmin.css'

const TABS = [
  { key: 'games', icon: 'play', ar: 'الألعاب', en: 'Games', period: true },
  { key: 'cups', icon: 'award', ar: 'البطولات', en: 'Tournaments', period: false },
  { key: 'players', icon: 'customers', ar: 'اللاعبون', en: 'Players', period: true },
  { key: 'rooms', icon: 'shapes', ar: 'الغرف المباشرة', en: 'Live rooms', period: false },
  { key: 'rewards', icon: 'offers', ar: 'الجوائز', en: 'Rewards', period: true },
]

export default function GamesHub() {
  const { lang } = useI18n()
  const ar = lang !== 'en'
  const toast = useToast()
  const { tenantId, tenant, isManager, can, updateTenantLocal } = useAuth()

  const canEdit = isManager || can(CAP.MANAGE_SETTINGS)
  const canView = canEdit || can(CAP.VIEW_REPORTS)
  // Ending a stuck table is floor work, not configuration — the people holding
  // the room open are standing in front of the cashier, not the owner.
  const canFloor = canEdit || can(CAP.TAKE_ORDERS)

  const [tab, setTab] = useState('games')
  const [periodKey, setPeriodKey] = useState('d30')
  const [custom, setCustom] = useState(() => {
    const r = periodRange('d30')
    return { from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10) }
  })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const { from, to } = useMemo(() => periodRange(periodKey, custom), [periodKey, custom])
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const periodLabel = `${dayStamp(fromMs)} — ${dayStamp(toMs)}`

  useEffect(() => {
    if (!tenantId || !canView) return undefined
    let alive = true
    setData(null); setErr('')
    ;(async () => {
      try {
        // A sentinel, not a sentence: translated at render time so this effect
        // never has to depend on the active language.
        if (!firebaseReady) throw new Error('not-configured')
        const [plays, profiles, scores, claims] = await Promise.all([
          fetchPlays(tenantId, fromMs, toMs),
          fetchProfiles(tenantId),
          fetchScores(tenantId),
          fetchClaims(tenantId),
        ])
        if (!alive) return
        // `plays` is a READ REPORT, not an array: it carries how far back the
        // capped read actually reached, which is the only way this page can
        // tell "nothing was played" apart from "the window was never read".
        setData({ read: plays, profiles, scores, claims: claims.rows, claimsOk: claims.ok })
      } catch (e) {
        if (alive) setErr(e && e.message ? e.message : String(e))
      }
    })()
    return () => { alive = false }
  }, [tenantId, canView, fromMs, toMs])

  // --- the only two writes this page makes ---------------------------------
  const saveGames = useCallback(async (nextIds) => {
    if (!canEdit || busy) return
    setBusy(true)
    try {
      await updateTenant(tenantId, { games: nextIds })
      updateTenantLocal({ games: nextIds })
    } catch (_) {
      toast.error(ar ? 'تعذّر الحفظ' : 'Could not save')
    } finally { setBusy(false) }
  }, [canEdit, busy, tenantId, updateTenantLocal, toast, ar])

  const saveRewards = useCallback(async (gameRewards) => {
    if (!canEdit) throw new Error(ar ? 'لا تملك صلاحية التعديل' : 'No permission')
    setBusy(true)
    try {
      await updateTenant(tenantId, { gameRewards })
      updateTenantLocal({ gameRewards })
      toast.success(ar ? 'حُفظت الجوائز' : 'Saved')
    } finally { setBusy(false) }
  }, [canEdit, tenantId, updateTenantLocal, toast, ar])

  if (!canView) {
    return (
      <div className="ga-page">
        <div className="ga-card">
          <p className="ga-empty-t">{ar ? 'لا صلاحية' : 'No permission'}</p>
          <p className="ga-hint">
            {ar
              ? 'عرض مركز الألعاب يحتاج صلاحية التقارير أو الإعدادات. اطلبها من مدير المكان.'
              : 'Viewing the games centre needs the reports or settings permission.'}
          </p>
        </div>
      </div>
    )
  }

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0]
  const read = data ? data.read : null
  const plays = read ? read.rows : []
  const profiles = data ? data.profiles : []
  const scores = data ? data.scores : []
  // Two DIFFERENT facts, and the page must not collapse them:
  //   covered  — every play in the window was provably read;
  //   capped   — the read hit its limit, so history older than it is unread.
  // A past window beyond the cap's reach yields zero rows AND covered=false;
  // reporting that as «لا جولات» would retire the venue's best games on an
  // artefact of the read. The banner below therefore keys off `covered`, which
  // is computed BEFORE the window filter, not after it.
  // A failed fetch is also "not covered": the catalogue must not print a clean
  // zero per game underneath an error banner.
  const covered = !err && (!read || read.covers)
  const oldestRead = read && read.oldestScannedMs ? dayStamp(read.oldestScannedMs) : ''
  // Tabs that read nothing from the page-level fetch stay usable even while it
  // is still running, or after it failed.
  const needsData = activeTab.period

  return (
    <div className="ga-page">
      <header className="ga-head">
        <div className="ga-head-t">
          <strong>{ar ? 'مركز الألعاب' : 'Games centre'}</strong>
          <span>
            {ar
              ? 'ما يظهر للضيوف، وترتيبه، وما نتج عنه فعلاً'
              : 'What guests see, in what order, and what it produced'}
          </span>
        </div>
        {activeTab.period && (
          <div className="ga-period">
            {PERIODS.map((p) => (
              <button
                key={p.key} type="button"
                className={`ga-chip${periodKey === p.key ? ' active' : ''}`}
                aria-pressed={periodKey === p.key}
                onClick={() => setPeriodKey(p.key)}
              >{ar ? p.ar : p.en}</button>
            ))}
            {periodKey === 'custom' && (
              <>
                <input
                  className="ga-input" type="date" value={custom.from}
                  onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                />
                <input
                  className="ga-input" type="date" value={custom.to}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                />
              </>
            )}
          </div>
        )}
      </header>

      <div className="ga-scroll-x">
        <div className="ga-tabs">
          {TABS.map((t) => (
            <button
              key={t.key} type="button"
              className={`ga-chip${tab === t.key ? ' active' : ''}`}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              <Icon name={t.icon} size={15} /> {ar ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      {err && needsData && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {err === 'not-configured'
              ? (ar ? 'الاتصال بقاعدة البيانات غير مُهيَّأ في هذه البيئة، فلا أرقام تُعرض. إعدادات الألعاب نفسها تبقى قابلة للتحرير.' : 'Database not configured — no figures. Settings still editable.')
              : `${ar ? 'تعذّرت قراءة بيانات الألعاب: ' : 'Could not read play data: '}${err}`}
          </span>
        </div>
      )}

      {needsData && !data && !err && (
        <div className="ga-card"><div className="ga-loading"><Spinner /></div></div>
      )}

      {needsData && read && !read.ok && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {ar
              ? 'تعذّرت قراءة سجل الجولات، فلا رقم على هذه الصفحة مقروء من بيانات. ما تراه من أصفار هو «لم يُقرأ»، وليس «لم يحدث».'
              : 'The play log could not be read. Any zero here means "not read", not "did not happen".'}
          </span>
        </div>
      )}

      {needsData && read && read.ok && !covered && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {plays.length === 0
              ? (ar
                ? `القراءة بلغت حدّها (${fmtInt(read.cap)} جولة) قبل أن تصل إلى هذه الفترة${oldestRead ? `، وأقدم جولة قرأناها بتاريخ ${oldestRead}` : ''}. الأصفار المعروضة أدناه تعني «لم تُقرأ»، لا «لم تُلعب» — لا تُبنَ عليها قرارات إخفاء ألعاب. اختر فترة أحدث أو أقصر.`
                : `The read hit its cap (${read.cap} plays) before reaching this period${oldestRead ? `; the oldest play read is dated ${oldestRead}` : ''}. The zeros below mean "not read", not "not played". Pick a more recent or shorter period.`)
              : (ar
                ? `القراءة بلغت حدّها (${fmtInt(read.cap)} جولة) ولم تغطِّ هذه الفترة كاملة${oldestRead ? ` — أقدم جولة قرأناها بتاريخ ${oldestRead}` : ''}. كل رقم أدناه حدّ أدنى لا حصيلة نهائية. ضيّق الفترة لصورة كاملة.`
                : `The read hit its cap (${read.cap} plays) and does not cover the whole period${oldestRead ? `; oldest play read is dated ${oldestRead}` : ''}. Every figure below is a floor, not a total.`)}
          </span>
        </div>
      )}

      {tab === 'games' && (data || err) && (
        <GamesCatalogue
          ar={ar} tenant={tenant} plays={plays} canEdit={canEdit} busy={busy}
          periodLabel={periodLabel} onSaveGames={saveGames}
          covered={covered} oldestRead={oldestRead}
        />
      )}

      {tab === 'cups' && (
        <TournamentsPanel
          ar={ar} tenantId={tenantId} canEdit={canEdit}
          scores={scores} profiles={profiles}
        />
      )}

      {tab === 'players' && data && (
        <PlayersPanel ar={ar} plays={plays} profiles={profiles} periodLabel={periodLabel} />
      )}

      {tab === 'rooms' && (
        <LiveRoomsPanel ar={ar} tenantId={tenantId} canEdit={canFloor} />
      )}

      {tab === 'rewards' && (data || err) && (
        <RewardsPanel
          ar={ar} tenant={tenant} canEdit={canEdit} saving={busy}
          claims={data ? data.claims : []} claimsOk={data ? data.claimsOk : false}
          fromMs={fromMs} toMs={toMs} onSave={saveRewards}
        />
      )}

      <p className="ga-hint ga-foot">
        {ar
          ? 'للتحليل الأعمق للسلوك (الشرائح، دقة الأسئلة، بناء الحملات) افتح «نشاط الألعاب والتحليل» — هذه الصفحة لا تكرّره.'
          : 'Deeper behavioural analysis lives in the play activity page; this page does not duplicate it.'}
        {' '}
        <Link className="ga-link" to="/admin/guest-play">{ar ? 'فتح نشاط الألعاب والتحليل' : 'Open play activity'}</Link>
      </p>
    </div>
  )
}
