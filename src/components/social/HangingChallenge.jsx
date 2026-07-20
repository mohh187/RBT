// ===========================================================================
// التحدي المعلّق — a note one guest pins to the venue for whoever sits down next.
//
// «سجّلت 400 في سباق النادل. اكسرها.» — and three hours later a stranger does,
// and both of them are told.
//
// TWO THINGS THIS COMPONENT TAKES SERIOUSLY
//
// 1. The message is USER CONTENT SHOWN TO STRANGERS. It is sanitized on write
//    AND again on read (socialPlay.sanitizeMessage), capped, and rendered as a
//    text node inside a container that breaks anywhere — so no length, no
//    script, no bidi trick and no smuggled phone number reaches another guest.
//
// 2. A win is recorded ONCE. `result` is a prop that can re-render for reasons
//    that have nothing to do with a new round, so every result is fingerprinted
//    and a fingerprint already claimed never writes again.
// ===========================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Card, Head, useBrand, useNow, useWatch, pick } from './parts.jsx'
import {
  watchOpenChallenges,
  postChallenge,
  recordChallengeBeat,
  closeChallenge,
  resolvePlayer,
  sanitizeMessage,
  fmtLeft,
  fmtNum,
  MAX_MESSAGE,
} from '../../lib/socialPlay.js'
import { gameById } from '../../lib/games.js'

const gameName = (id, lang) => {
  const g = gameById(id)
  if (!g) return id || ''
  return lang === 'en' ? (g.en || g.ar) : g.ar
}

export default function HangingChallenge({
  tenantId,
  tenant = null,
  lang = 'ar',
  table = null,
  player = null,
  // Launch a game: onPlay(gameId, { source, challengeId })
  onPlay = null,
  // The round this device just finished: { gameId, score, at }. When it beats
  // an open challenge the win is recorded and both sides are congratulated.
  result = null,
  // Restrict the list to one game (e.g. inside that game's own screen).
  gameId = '',
}) {
  const brand = useBrand(tenant)
  const me = useMemo(() => resolvePlayer(player), [player])

  const state = useWatch(
    (cb) => watchOpenChallenges(tenantId, cb, { deviceId: me.id, gameId }),
    [tenantId, me.id, gameId],
    { challenges: [], mine: [], error: null },
  )

  const [msg, setMsg] = useState('')
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState(false)
  const [won, setWon] = useState(null)   // { name, score, beat }
  const [busy, setBusy] = useState('')

  const now = useNow(state.challenges.length > 0, 30000)

  // ---- did this round beat anything? -------------------------------------
  // Fingerprint, not identity: a parent that re-creates `result` on every
  // render must not be able to double-write a win.
  const fp = result && result.gameId && result.score > 0
    ? `${result.gameId}:${Math.floor(result.score)}:${result.at || 0}`
    : ''
  const claimed = useRef('')

  useEffect(() => {
    if (!fp || claimed.current === fp || !tenantId) return
    // Beat the HARDEST one this score clears, so a strong round is not spent on
    // the easiest note on the board.
    const target = state.challenges
      .filter((c) => c.gameId === result.gameId && result.score > c.score)
      .filter((c) => !c.beatenBy.some((b) => b.deviceId === me.id && b.score >= result.score))
      .sort((a, b) => b.score - a.score)[0]
    if (!target) return
    claimed.current = fp
    let alive = true
    recordChallengeBeat({
      tid: tenantId,
      challengeId: target.id,
      name: me.name,
      deviceId: me.id,
      score: result.score,
    }).then((r) => {
      if (alive && r.ok && r.beaten) setWon({ name: target.byName, score: target.score, beat: result.score })
    })
    return () => { alive = false }
  }, [fp, tenantId, state.challenges, result, me.id, me.name])

  // ---- leave a challenge --------------------------------------------------
  const canPost = Boolean(result?.gameId) && Number(result?.score) > 0 && !posted
  const post = useCallback(async () => {
    if (!canPost || posting) return
    setPosting(true)
    const r = await postChallenge({
      tid: tenantId,
      gameId: result.gameId,
      name: me.name,
      deviceId: me.id,
      score: result.score,
      message: msg,
    })
    setPosting(false)
    if (r.ok) { setPosted(true); setMsg('') }
  }, [canPost, posting, tenantId, result, me.id, me.name, msg])

  const retire = useCallback(async (id) => {
    setBusy(id)
    await closeChallenge({ tid: tenantId, challengeId: id, deviceId: me.id })
    setBusy('')
  }, [tenantId, me.id])

  const nothing = !state.challenges.length && !state.mine.length && !canPost && !won && !state.error
  if (nothing) return null

  return (
    <Card brand={brand}>
      <Head
        icon="flame"
        title={pick(lang, 'تحدٍّ معلّق', 'A challenge left here')}
        right={state.challenges.length
          ? <span className="sp-meta">{fmtNum(state.challenges.length)}</span>
          : null}
      />

      {won ? (
        <div className="sp-won">
          {pick(
            lang,
            `كسرت تحدي ${won.name}. سجّل ${fmtNum(won.score)} وسجّلت ${fmtNum(won.beat)}.`,
            `You beat ${won.name}: ${fmtNum(won.score)} to ${fmtNum(won.beat)}.`,
          )}
        </div>
      ) : null}

      {state.error ? (
        <p className="sp-err">{pick(lang, 'تعذّر قراءة التحديات الآن.', 'Could not read challenges right now.')}</p>
      ) : null}

      {state.challenges.length ? (
        <div className="sp-list">
          {state.challenges.map((c) => (
            <article className="sp-tile" key={c.id}>
              <div className="sp-tile-top">
                <span className="sp-tile-name">{c.byName}</span>
                <span className="sp-tile-game">{gameName(c.gameId, lang)}</span>
              </div>
              <div className="sp-bar">
                <span className="sp-big">{fmtNum(c.score)}</span>
                <span>{pick(lang, 'نقطة — اكسرها', 'points — beat it')}</span>
              </div>
              {/* Guest text. Sanitized twice, rendered as a text node. */}
              {c.message ? <p className="sp-msg">{c.message}</p> : null}
              {c.beatenBy.length ? (
                <p className="sp-beat">
                  {pick(
                    lang,
                    `كسرها ${fmtNum(c.beatenBy.length)} حتى الآن — أعلاهم ${fmtNum(Math.max(...c.beatenBy.map((b) => b.score)))}.`,
                    `Beaten ${fmtNum(c.beatenBy.length)} times — best ${fmtNum(Math.max(...c.beatenBy.map((b) => b.score)))}.`,
                  )}
                </p>
              ) : null}
              <div className="sp-actions">
                {onPlay ? (
                  <button
                    type="button"
                    className="sp-btn sp-sm"
                    onClick={() => onPlay(c.gameId, { source: 'challenge', challengeId: c.id })}
                  >
                    <Icon name="zap" size={14} />
                    {pick(lang, 'تحدَّه', 'Take it on')}
                  </button>
                ) : null}
                {c.expiresAt ? (
                  <span className="sp-meta">
                    {pick(lang, `ينتهي بعد ${fmtLeft(c.expiresAt - now, lang)}`, `ends in ${fmtLeft(c.expiresAt - now, lang)}`)}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {/* ---- leave one of your own ---- */}
      {canPost ? (
        <div className="sp-compose">
          <p className="sp-sub">
            {pick(
              lang,
              `علّق نتيجتك (${fmtNum(result.score)}) في ${gameName(result.gameId, lang)} لمن يجلس بعدك.`,
              `Leave your ${fmtNum(result.score)} in ${gameName(result.gameId, lang)} for the next guest.`,
            )}
          </p>
          <input
            className="sp-input"
            type="text"
            inputMode="text"
            maxLength={MAX_MESSAGE}
            value={msg}
            onChange={(e) => setMsg(sanitizeMessage(e.target.value))}
            placeholder={pick(lang, 'كلمة قصيرة للمتحدّي القادم (اختياري)', 'A short line for the next player (optional)')}
          />
          <span className="sp-count">{`${fmtNum(msg.length)} / ${fmtNum(MAX_MESSAGE)}`}</span>
          <button type="button" className="sp-btn sp-wide" onClick={post} disabled={posting}>
            <Icon name="flame" size={15} />
            {posting ? pick(lang, 'نعلّقه…', 'Pinning…') : pick(lang, 'علّق التحدي', 'Pin the challenge')}
          </button>
        </div>
      ) : null}

      {posted ? (
        <p className="sp-note">{pick(lang, 'عُلّق تحديك. سنخبرك حين يكسره أحد.', 'Pinned. You will see it here when someone beats it.')}</p>
      ) : null}

      {/* ---- your own open challenges ---- */}
      {state.mine.length ? (
        <div className="sp-list">
          {state.mine.map((c) => (
            <article className="sp-tile" key={c.id}>
              <div className="sp-tile-top">
                <span className="sp-tile-name">{pick(lang, 'تحديك', 'Your challenge')}</span>
                <span className="sp-tile-game">{gameName(c.gameId, lang)}</span>
              </div>
              <div className="sp-bar">
                <span className="sp-big">{fmtNum(c.score)}</span>
                {c.beatenBy.length ? (
                  <span className="sp-beat">
                    {pick(lang, `كسره ${c.beatenBy[c.beatenBy.length - 1].name}`, `beaten by ${c.beatenBy[c.beatenBy.length - 1].name}`)}
                  </span>
                ) : (
                  <span>{pick(lang, 'لم يكسره أحد بعد', 'still unbeaten')}</span>
                )}
              </div>
              {c.active ? (
                <div className="sp-actions">
                  <button
                    type="button"
                    className="sp-btn sp-ghost sp-sm"
                    onClick={() => retire(c.id)}
                    disabled={busy === c.id}
                  >
                    <Icon name="close" size={14} />
                    {pick(lang, 'أنهِ التحدي', 'Retire it')}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {table?.label && state.challenges.length ? (
        <p className="sp-note">{pick(lang, `أنت على ${table.label}`, `You are at ${table.label}`)}</p>
      ) : null}
    </Card>
  )
}
