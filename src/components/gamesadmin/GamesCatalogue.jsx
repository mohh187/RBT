// «الألعاب» — the full catalogue with complete per-venue control.
//
// WHAT IT WRITES: exactly one field, `tenant.games` — the SAME array the games
// picker in Settings reads and writes. That is deliberate: this page supersedes
// that picker, but the two must never disagree about which games a venue shows,
// so there is only ever one stored list.
//
// The array is ALSO the venue's display order. `gamesFor(tenant)` maps over it
// in order, so dragging a row here is what reorders the guest-facing hub.
//
// ORDERING AND FILTERING DO NOT MIX. Dragging a row while a filter hides half
// the list would move it relative to rows nobody can see, and the result would
// look arbitrary. So drag is enabled only on the unfiltered list, and the UI
// says why rather than silently doing something surprising.
import { useMemo, useState } from 'react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Icon from '../Icon.jsx'
import { GAMES, GAME_TAGS } from '../../lib/games.js'
import GameSheet from './GameSheet.jsx'
import {
  GAME_KINDS, kindOf, kindLabel, splitCatalogue, enabledIds,
  statsByGame, emptyStat, fmtInt, fmtPct, durText, THIN_PLAYS, soloNote,
} from './engine.jsx'

// One row of the list.
//
// Split in two on purpose: `useSortable` is only ever mounted INSIDE a
// SortableContext (see SortableGameRow below). Calling it on a row rendered
// outside one — a hidden game, or any row while a filter is applied — would
// register a draggable against a context that does not list it, which is how
// you get a row that "sticks" mid-drag. The plain view has no drag hook at all.
function GameRowView({
  game, stat, ar, enabled, canEdit, busy, onToggle, onOpen,
  nodeRef, style, handleProps, covered = true,
}) {
  const s = stat || emptyStat(game.id)

  return (
    <div ref={nodeRef} style={style} className={`ga-row${enabled ? '' : ' is-off'}`}>
      {handleProps ? (
        <button
          type="button"
          className="ga-drag"
          aria-label={ar ? 'اسحب لإعادة الترتيب' : 'Drag to reorder'}
          {...handleProps}
        >
          <Icon name="drag" size={16} />
        </button>
      ) : <span className="ga-drag is-blank" aria-hidden="true" />}

      <span className="ga-ico"><Icon name={game.icon || 'play'} size={18} /></span>

      <button type="button" className="ga-rowmain" onClick={() => onOpen?.(game)}>
        <span className="ga-rowname">
          {ar ? game.ar : (game.en || game.ar)}
          {game.multiplayer && (
            <span className="ga-tag ga-tag-sm">
              {ar ? 'جماعية' : 'Party'} <span className="ga-num">{fmtInt(game.minPlayers)}-{fmtInt(game.maxPlayers)}</span>
            </span>
          )}
        </span>
        <span className="ga-rowstats ga-num">
          {s.plays
            ? (
              <>
                {/* Named «أمام أشخاص» only when there are computer rounds to
                    distinguish it from, so the common case stays quiet. */}
                <span>
                  {covered ? '' : (ar ? 'على الأقل ' : 'at least ')}
                  {fmtInt(s.plays)} {ar ? (s.soloPlays ? 'جولة أمام أشخاص' : 'جولة') : 'plays'}
                </span>
                <span>{fmtInt(s.players)} {ar ? 'لاعب' : 'players'}</span>
                <span>{ar ? 'متوسط' : 'avg'} {s.avgScore == null ? '—' : fmtInt(s.avgScore)}</span>
                <span>{durText(s.avgDurationSec)}</span>
                <span>{fmtPct(s.completionRate)} {ar ? 'إكمال' : 'done'}</span>
                {s.soloPlays ? (
                  <span className="ga-of">
                    {ar ? `+ ${fmtInt(s.soloPlays)} ضد الكمبيوتر` : `+ ${fmtInt(s.soloPlays)} vs computer`}
                  </span>
                ) : null}
                {s.thin && <span className="ga-thin">{ar ? 'عيّنة صغيرة' : 'thin'}</span>}
                {!covered && <span className="ga-thin">{ar ? 'قراءة ناقصة' : 'partial read'}</span>}
              </>
            )
            // «لا جولات» is a MEASUREMENT and may only be printed when the read
            // provably covered the window. Otherwise the truthful statement is
            // that nothing was read — the opposite decision for a manager
            // deciding whether to retire this game.
            : s.soloPlays
              // NOT "no plays": the game WAS played, just never against a person,
              // and printing "none" here would erase real activity.
              ? (
                <span className="ga-of">
                  {ar
                    ? `${fmtInt(s.soloPlays)} جولة ضد الكمبيوتر فقط — لا جولة أمام أشخاص`
                    : `${fmtInt(s.soloPlays)} computer rounds only — none against people`}
                </span>
              )
              : covered
                ? <span className="ga-of">{ar ? 'لا جولات في هذه الفترة' : 'No plays this period'}</span>
                : <span className="ga-thin">{ar ? 'لم تُقرأ هذه الفترة' : 'This period was not read'}</span>}
        </span>
      </button>

      <button
        type="button"
        className={`ga-toggle${enabled ? ' is-on' : ''}`}
        disabled={!canEdit || busy}
        aria-pressed={enabled}
        title={canEdit ? '' : (ar ? 'لا تملك صلاحية التعديل' : 'No edit permission')}
        onClick={() => onToggle?.(game.id)}
      >
        <Icon name={enabled ? 'eye' : 'eyeOff'} size={15} />
        <span>{enabled ? (ar ? 'ظاهرة' : 'On') : (ar ? 'مخفية' : 'Off')}</span>
      </button>
    </div>
  )
}

// The draggable wrapper. Mounted only inside <SortableContext>.
function SortableGameRow(props) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: props.game.id })
  return (
    <GameRowView
      {...props}
      nodeRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      handleProps={{ ...attributes, ...listeners }}
    />
  )
}

export default function GamesCatalogue({
  ar = true, tenant, plays = [], canEdit = false, busy = false,
  onSaveGames, periodLabel = '', covered = true, oldestRead = '',
}) {
  const [kind, setKind] = useState('all')
  const [tag, setTag] = useState('all')
  const [openId, setOpenId] = useState('')

  const stats = useMemo(() => statsByGame(plays), [plays])
  // Stated once at the bottom of the page rather than only per row, so a manager
  // who never opens a row still learns that the figures above are human play.
  const soloTotal = useMemo(
    () => [...stats.values()].reduce((n, s) => n + (s.soloPlays || 0), 0),
    [stats],
  )
  const { enabled, disabled, usingDefaults } = useMemo(() => splitCatalogue(tenant), [tenant])
  const onSet = useMemo(() => new Set(enabled.map((g) => g.id)), [enabled])

  const filtering = kind !== 'all' || tag !== 'all'
  const matches = (g) => (
    (kind === 'all' || kindOf(g) === kind)
    && (tag === 'all' || (g.tags || []).includes(tag) || (g.tags || []).includes('all'))
  )
  const shownEnabled = enabled.filter(matches)
  const shownDisabled = disabled.filter(matches)

  // --- writes ---------------------------------------------------------------
  // Every mutation produces a COMPLETE next array and hands it to the page,
  // which is the only thing that touches Firestore. A venue on defaults gets
  // that default materialised on its first change, so "on" and "in this order"
  // can never drift apart.
  const currentIds = () => enabledIds(tenant)

  const toggle = (id) => {
    if (!canEdit) return
    const ids = currentIds()
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    onSaveGames?.(next)
  }

  const bulk = (on) => {
    if (!canEdit) return
    const group = GAMES.filter(matches).map((g) => g.id)
    const ids = currentIds()
    if (on) {
      const add = group.filter((id) => !ids.includes(id))
      if (!add.length) return
      onSaveGames?.([...ids, ...add])
    } else {
      const next = ids.filter((id) => !group.includes(id))
      onSaveGames?.(next)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || !canEdit) return
    const ids = currentIds()
    const from = ids.indexOf(active.id)
    const to = ids.indexOf(over.id)
    if (from < 0 || to < 0) return
    onSaveGames?.(arrayMove(ids, from, to))
  }

  // --- the detail sheet -----------------------------------------------------
  const openGame = openId ? GAMES.find((g) => g.id === openId) : null
  if (openGame) {
    return (
      <GameSheet
        ar={ar}
        game={openGame}
        stat={stats.get(openGame.id) || emptyStat(openGame.id)}
        plays={plays}
        enabled={onSet.has(openGame.id)}
        canEdit={canEdit}
        periodLabel={periodLabel}
        covered={covered}
        oldestRead={oldestRead}
        onToggle={(id) => toggle(id)}
        onClose={() => setOpenId('')}
      />
    )
  }

  const kindGroups = GAME_KINDS.filter((k) => GAMES.some((g) => kindOf(g) === k.id))
  const presentTags = new Set(GAMES.flatMap((g) => g.tags || []))
  const tagList = GAME_TAGS.filter((t) => t.id === 'all' || presentTags.has(t.id))

  return (
    <div className="ga-stack">
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="play" size={15} /> {ar ? 'ألعاب هذا المكان' : 'This venue\'s games'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">{fmtInt(enabled.length)} / {fmtInt(GAMES.length)}</span>
        </div>
        <p className="ga-hint">
          {ar
            ? 'الظاهرة هنا هي ما يراه الضيف في ركن الألعاب داخل المنيو، وبنفس هذا الترتيب. اسحب من المقبض لتغيير الترتيب.'
            : 'What is visible here is what guests see, in this order. Drag the handle to reorder.'}
        </p>
        {usingDefaults && (
          <p className="ga-hint">
            {ar
              ? 'هذا المكان لم يخصّص قائمته بعد، فكل الألعاب ظاهرة بالترتيب الافتراضي. أول تغيير هنا يثبّت القائمة والترتيب معاً.'
              : 'Not customised yet — all games are on in the default order. The first change here pins both.'}
          </p>
        )}
        {!canEdit && (
          <p className="ga-hint">
            {ar ? 'أنت في وضع العرض فقط — تعديل قائمة الألعاب يحتاج صلاحية الإعدادات.' : 'View only — editing needs the settings permission.'}
          </p>
        )}
      </div>

      {/* filters */}
      <div className="ga-card">
        <div className="ga-scroll-x">
          <div className="ga-chips">
            <button
              type="button" className={`ga-chip${kind === 'all' ? ' active' : ''}`}
              aria-pressed={kind === 'all'} onClick={() => setKind('all')}
            >{ar ? 'كل التصنيفات' : 'All kinds'}</button>
            {kindGroups.map((k) => (
              <button
                key={k.id} type="button" className={`ga-chip${kind === k.id ? ' active' : ''}`}
                aria-pressed={kind === k.id} onClick={() => setKind(k.id)}
              >{ar ? k.ar : k.en}</button>
            ))}
          </div>
        </div>
        <div className="ga-scroll-x">
          <div className="ga-chips">
            {tagList.map((t) => (
              <button
                key={t.id} type="button" className={`ga-chip${tag === t.id ? ' active' : ''}`}
                aria-pressed={tag === t.id} onClick={() => setTag(t.id)}
              >{ar ? t.ar : t.en}</button>
            ))}
          </div>
        </div>
        {canEdit && filtering && (
          <div className="ga-bulk">
            <span className="ga-hint">
              {ar ? 'تطبيق على المعروض الآن' : 'Apply to what is shown'}
              <span className="ga-num"> ({fmtInt(GAMES.filter(matches).length)})</span>
            </span>
            <button type="button" className="ga-btn" disabled={busy} onClick={() => bulk(true)}>
              <Icon name="eye" size={14} /> {ar ? 'إظهار الكل' : 'Show all'}
            </button>
            <button type="button" className="ga-btn" disabled={busy} onClick={() => bulk(false)}>
              <Icon name="eyeOff" size={14} /> {ar ? 'إخفاء الكل' : 'Hide all'}
            </button>
          </div>
        )}
        {filtering && (
          <p className="ga-hint">
            {ar
              ? 'السحب لإعادة الترتيب متوقّف أثناء التصفية — حرّك المرشّحات إلى «كل التصنيفات» و«كل الأنواع» لتفعيله.'
              : 'Drag-to-reorder is off while filtered — clear both filters to enable it.'}
          </p>
        )}
      </div>

      {/* enabled, ordered */}
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="eye" size={15} /> {ar ? 'ظاهرة للضيوف' : 'Visible to guests'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">{fmtInt(shownEnabled.length)}</span>
        </div>
        {shownEnabled.length === 0 ? (
          <p className="ga-hint">
            {enabled.length === 0
              ? (ar
                ? 'لا لعبة واحدة ظاهرة — ركن الألعاب لا يظهر للضيوف إطلاقاً الآن. فعّل لعبة واحدة على الأقل من القائمة أدناه.'
                : 'No game is visible — the games corner is hidden from guests entirely.')
              : (ar ? 'لا نتيجة تطابق هذه التصفية بين الألعاب الظاهرة.' : 'No visible game matches this filter.')}
          </p>
        ) : (filtering || !canEdit) ? (
          // Filtered, or view-only: a plain list with no drag hook anywhere.
          shownEnabled.map((g) => (
            <GameRowView
              key={g.id} game={g} ar={ar} enabled canEdit={canEdit} busy={busy}
              stat={stats.get(g.id)} covered={covered}
              onToggle={toggle} onOpen={(x) => setOpenId(x.id)}
            />
          ))
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={shownEnabled.map((g) => g.id)} strategy={verticalListSortingStrategy}>
              {shownEnabled.map((g) => (
                <SortableGameRow
                  key={g.id} game={g} ar={ar} enabled canEdit={canEdit} busy={busy}
                  stat={stats.get(g.id)} covered={covered}
                  onToggle={toggle} onOpen={(x) => setOpenId(x.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* disabled */}
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="eyeOff" size={15} /> {ar ? 'مخفية' : 'Hidden'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">{fmtInt(shownDisabled.length)}</span>
        </div>
        {shownDisabled.length === 0 ? (
          <p className="ga-hint">
            {disabled.length === 0
              ? (ar ? 'كل الألعاب ظاهرة.' : 'Every game is visible.')
              : (ar ? 'لا نتيجة تطابق هذه التصفية بين الألعاب المخفية.' : 'No hidden game matches this filter.')}
          </p>
        ) : shownDisabled.map((g) => (
          <GameRowView
            key={g.id} game={g} ar={ar} enabled={false} canEdit={canEdit} busy={busy}
            stat={stats.get(g.id)} covered={covered}
            onToggle={toggle} onOpen={(x) => setOpenId(x.id)}
          />
        ))}
        {shownDisabled.length > 0 && (
          <p className="ga-hint">
            {ar
              ? 'أرقام لعبة مخفية تخصّ فترة كانت فيها ظاهرة — تُعرض كما هي ولا تُصفَّر.'
              : 'A hidden game\'s figures come from when it was visible; they are shown as-is.'}
          </p>
        )}
      </div>

      <p className="ga-hint">
        {covered
          ? (ar
            ? `الأرقام في هذه الصفحة محسوبة من جولات فعلية مسجّلة${periodLabel ? ` خلال ${periodLabel}` : ''}. أي لعبة بأقل من ${fmtInt(THIN_PLAYS)} جولة تُوسم «عيّنة صغيرة» ولا تُبنى عليها قرارات.`
            : `Every figure is counted from recorded plays. Under ${THIN_PLAYS} plays is labelled thin.`)
          : (ar
            ? `قراءة الجولات لم تغطِّ ${periodLabel || 'هذه الفترة'} كاملة${oldestRead ? ` — لم تصل إلى ما قبل ${oldestRead}` : ''}، فما تراه هنا حدّ أدنى وليس حصيلة. لا تُخفِ لعبة اعتماداً على هذه الشاشة قبل تضييق الفترة.`
            : `The play read did not cover ${periodLabel || 'this period'}${oldestRead ? `; it reached back only to ${oldestRead}` : ''}. Figures are a floor, not a total — do not retire a game on this screen until the period is narrowed.`)}
      </p>

      {soloTotal > 0 && (
        <p className="ga-hint">{soloNote(soloTotal, ar)}</p>
      )}
    </div>
  )
}
