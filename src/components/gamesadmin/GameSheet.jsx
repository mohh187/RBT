// The per-game detail sheet inside «مركز الألعاب» → «الألعاب».
//
// Everything on this panel is either read straight off the registry entry (the
// description, the player counts, the category) or counted off gamePlays rows
// inside the selected period. There is no third source, so nothing here can be
// a guess: a figure that was never measured renders «—» beside its sample size.
import Icon from '../Icon.jsx'
import {
  fmtInt, fmtPct, durText, dateTime, kindLabel, kindOf, recentPlaysFor, THIN_PLAYS,
} from './engine.jsx'

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}

function Figure({ label, value, sample, thin }) {
  return (
    <div className="ga-fig">
      <span className="ga-fig-l">{label}</span>
      <strong className="ga-fig-v ga-num">{value}</strong>
      {sample ? <span className="ga-fig-s ga-num">{sample}</span> : null}
      {thin ? <span className="ga-thin">عيّنة صغيرة</span> : null}
    </div>
  )
}

export default function GameSheet({
  ar = true, game, stat, plays = [], enabled, canEdit, onToggle, onClose, periodLabel = '',
}) {
  if (!game) return null
  const s = stat || {}
  const recent = recentPlaysFor(plays, game.id, 12)
  const multi = game.multiplayer === true
  const seats = multi
    ? (num(game.minPlayers) === num(game.maxPlayers)
      ? `${fmtInt(game.minPlayers)} لاعبين بالضبط`
      : `من ${fmtInt(game.minPlayers)} إلى ${fmtInt(game.maxPlayers)} لاعبين`)
    : ''

  return (
    <section className="ga-sheet" aria-label={ar ? 'تفاصيل اللعبة' : 'Game detail'}>
      <header className="ga-sheet-head">
        <button type="button" className="ga-back" onClick={onClose}>
          <Icon name="back" size={16} />
          <span>{ar ? 'رجوع للقائمة' : 'Back'}</span>
        </button>
        <span className="ga-grow" />
        <span className={`ga-pill${enabled ? ' is-on' : ''}`}>
          {enabled ? (ar ? 'ظاهرة للضيوف' : 'Visible') : (ar ? 'مخفية' : 'Hidden')}
        </span>
        {canEdit && (
          <button type="button" className="ga-btn" onClick={() => onToggle?.(game.id)}>
            {enabled ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'إظهار' : 'Show')}
          </button>
        )}
      </header>

      <div className="ga-sheet-title">
        <span className="ga-ico"><Icon name={game.icon || 'play'} size={22} /></span>
        <div className="ga-sheet-t">
          <strong>{ar ? game.ar : (game.en || game.ar)}</strong>
          <span>{ar ? game.en : game.ar}</span>
        </div>
      </div>

      <p className="ga-hint ga-desc">{ar ? game.desc : (game.descEn || game.desc)}</p>

      <div className="ga-chipsrow">
        <span className="ga-tag">{kindLabel(kindOf(game), ar)}</span>
        {(game.tags || []).map((t) => <span key={t} className="ga-tag">{t}</span>)}
      </div>

      {/* How it plays — stated from the registry entry, not invented. */}
      <div className="ga-card">
        <div className="ga-card-t"><Icon name="notepad" size={15} /> {ar ? 'كيف تُلعب' : 'How it plays'}</div>
        {multi ? (
          <>
            <p className="ga-hint">
              {ar
                ? `لعبة جماعية: يفتح الضيف غرفة برمز، وينضم الباقون من هواتفهم أو بمسح الرابط. تبدأ الجولة بعد اكتمال المقاعد (${seats}).`
                : `Multiplayer: the guest opens a room, others join from their phones (${seats}).`}
            </p>
            <p className="ga-hint">
              {ar
                ? 'الغرف الجارية الآن تظهر في تبويب «الغرف المباشرة» في هذه الصفحة نفسها.'
                : 'Live rooms appear in the Live rooms tab.'}
            </p>
          </>
        ) : (
          <p className="ga-hint">
            {ar
              ? 'لعبة فردية: تُفتح مباشرة من ركن الألعاب في المنيو، وتُسجَّل الجولة عند انتهائها.'
              : 'Solo: opens straight from the menu games corner; the round is recorded when it ends.'}
          </p>
        )}
      </div>

      {/* Measured figures */}
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="chartBar" size={15} /> {ar ? 'أرقام هذه اللعبة' : 'Measured figures'}
          {periodLabel ? <span className="ga-of ga-num">{periodLabel}</span> : null}
        </div>
        {s.plays ? (
          <>
            <div className="ga-figs">
              <Figure label={ar ? 'جولات' : 'Plays'} value={fmtInt(s.plays)} />
              <Figure label={ar ? 'لاعبون مختلفون' : 'Unique players'} value={fmtInt(s.players)} />
              <Figure
                label={ar ? 'متوسط النقاط' : 'Avg score'}
                value={s.avgScore == null ? '—' : fmtInt(s.avgScore)}
                sample={s.avgScoreN ? `${ar ? 'من' : 'of'} ${fmtInt(s.avgScoreN)} ${ar ? 'جولة منتهية' : 'finished'}` : ''}
                thin={s.avgScoreN > 0 && s.avgScoreN < THIN_PLAYS}
              />
              <Figure
                label={ar ? 'متوسط المدة' : 'Avg duration'}
                value={durText(s.avgDurationSec)}
                sample={s.avgDurationN ? `${ar ? 'من' : 'of'} ${fmtInt(s.avgDurationN)} ${ar ? 'جولة' : 'plays'}` : ''}
                thin={s.avgDurationN > 0 && s.avgDurationN < THIN_PLAYS}
              />
              <Figure
                label={ar ? 'نسبة الإكمال' : 'Completion'}
                value={fmtPct(s.completionRate)}
                sample={`${fmtInt(s.completed)} / ${fmtInt(s.plays)}`}
              />
              <Figure label={ar ? 'أعلى نتيجة' : 'Best score'} value={fmtInt(s.best)} />
            </div>
            {s.thin && (
              <p className="ga-hint">
                {ar
                  ? `أقل من ${fmtInt(THIN_PLAYS)} جولة في هذه الفترة — الأرقام أعلاه صحيحة لكنها لا تكفي لبناء قرار عليها.`
                  : `Fewer than ${fmtInt(THIN_PLAYS)} plays — accurate, but too few to decide on.`}
              </p>
            )}
          </>
        ) : (
          <p className="ga-hint">
            {ar
              ? 'لا جولات مسجّلة لهذه اللعبة في هذه الفترة. عند أول جولة يظهر هنا عدد الجولات واللاعبين ومتوسط النقاط والمدة ونسبة الإكمال.'
              : 'No plays recorded in this period.'}
          </p>
        )}
      </div>

      {/* Recent plays */}
      <div className="ga-card">
        <div className="ga-card-t"><Icon name="clock" size={15} /> {ar ? 'آخر الجولات' : 'Recent plays'}</div>
        {recent.length ? (
          <div className="ga-tablewrap">
            <table className="ga-table">
              <thead>
                <tr>
                  <th>{ar ? 'متى' : 'When'}</th>
                  <th>{ar ? 'اللاعب' : 'Player'}</th>
                  <th>{ar ? 'النقاط' : 'Score'}</th>
                  <th>{ar ? 'المدة' : 'Duration'}</th>
                  <th>{ar ? 'أُكملت' : 'Completed'}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id || p.playId}>
                    <td className="ga-num">{dateTime(p.startedAt)}</td>
                    <td>{p.customerName || (ar ? 'ضيف غير معروف' : 'Anonymous')}</td>
                    <td className="ga-num">{fmtInt(p.score)}</td>
                    <td className="ga-num">{num(p.durationMs) > 0 ? durText(num(p.durationMs) / 1000) : '—'}</td>
                    <td>
                      {p.completed === true
                        ? <span className="ga-ok"><Icon name="ok" size={14} /></span>
                        : <span className="ga-of">{ar ? 'لا' : 'No'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ga-hint">{ar ? 'لا جولات في هذه الفترة.' : 'No plays in this period.'}</p>
        )}
      </div>
    </section>
  )
}
