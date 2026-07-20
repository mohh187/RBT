// «الجوائز» — the venue's reward rules, edited against the exact shape that
// src/lib/gameRewards.js already evaluates at the guest's side.
//
// WRITES: tenant.gameRewards = { enabled, note, rules[] }. Nothing else.
//
// The one thing this panel does that a plain form would not: it runs each
// stored rule through `normalizeRule` — the SAME gate the guest-facing hub uses
// — and tells the venue when a rule it thinks is live is actually being dropped
// (a free item with no name, a discount with no percentage). Without that, a
// manager can sit for weeks believing a prize is on offer while every guest
// silently sees nothing.
//
// Claim counts come from tenants/{tid}/gameRewardClaims, which is mirrored
// best-effort from the guest's device. So the number is labelled as a FLOOR,
// never as a census, and when the collection cannot be read the panel says that
// instead of printing a zero that looks measured.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { GAMES } from '../../lib/games.js'
import {
  REWARD_METRICS, PRIZE_KINDS, PER_GUEST, normalizeRule,
  conditionText, claimText, perGuestText,
} from '../../lib/gameRewards.js'
import { fmtInt, dateTime, claimsByRule } from './engine.jsx'

const num = (v, f = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : f
}

const emptyRule = (i) => ({
  id: `r${Date.now().toString(36)}${i}`,
  gameId: 'any',
  metric: 'score',
  threshold: 100,
  prize: { kind: 'discount', value: 10, label: '', itemId: '', code: '' },
  perGuest: 'once',
  active: true,
})

// Why THIS rule is not live, in the venue's own vocabulary. Mirrors the checks
// inside normalizePrize/normalizeRule one-for-one.
function whyDropped(raw) {
  if (!raw || typeof raw !== 'object') return 'قاعدة تالفة.'
  if (raw.active === false) return ''
  const metric = REWARD_METRICS.some((m) => m.id === raw.metric)
  if (!metric) return 'نوع الشرط غير محدد.'
  const p = raw.prize || {}
  if (!PRIZE_KINDS.some((k) => k.id === p.kind)) return 'نوع الجائزة غير محدد.'
  const v = Number(p.value)
  if (p.kind === 'discount' && (!Number.isFinite(v) || v <= 0 || v > 100)) return 'نسبة الخصم يجب أن تكون بين 1 و 100.'
  if (p.kind === 'points' && (!Number.isFinite(v) || v < 1)) return 'عدد النقاط يجب أن يكون 1 فأكثر.'
  if (p.kind === 'freeItem' && !String(p.label || '').trim() && !String(p.itemId || '').trim()) {
    return 'الصنف المجاني بلا اسم — الضيف لن يعرف ما الذي ربحه.'
  }
  if (raw.metric !== 'completed') {
    const th = Math.floor(Number(raw.threshold))
    if (!Number.isFinite(th) || th <= 0) return 'الحد المطلوب يجب أن يكون رقماً أكبر من صفر.'
  }
  return ''
}

function RuleCard({ ar, rule, index, canEdit, claims, claimsOk, onChange, onRemove }) {
  const metric = rule.metric || 'score'
  const needsThreshold = metric !== 'completed'
  const kind = rule.prize?.kind || 'discount'
  const live = Boolean(normalizeRule(rule, index))
  const reason = live ? '' : whyDropped(rule)
  const gameName = rule.gameId === 'any'
    ? (ar ? 'كل الألعاب' : 'All games')
    : ((GAMES.find((g) => g.id === rule.gameId) || {}).ar || rule.gameId)

  const set = (patch) => onChange({ ...rule, ...patch })
  const setPrize = (patch) => onChange({ ...rule, prize: { ...(rule.prize || {}), ...patch } })

  return (
    <div className={`ga-card ga-rulecard${live ? '' : ' is-dead'}`}>
      <div className="ga-card-t">
        <Icon name="offers" size={15} />
        <strong>{ar ? 'قاعدة' : 'Rule'} <span className="ga-num">{fmtInt(index + 1)}</span></strong>
        <span className={`ga-pill${live ? ' is-running' : ''}`}>
          {live ? (ar ? 'سارية للضيوف' : 'Live') : (ar ? 'غير سارية' : 'Not live')}
        </span>
        <span className="ga-grow" />
        {canEdit && (
          <button type="button" className="ga-icobtn" title={ar ? 'حذف القاعدة' : 'Delete'} onClick={onRemove}>
            <Icon name="delete" size={15} />
          </button>
        )}
      </div>

      {!live && reason && (
        <div className="ga-warn">
          <Icon name="warning" size={15} />
          <span>
            {ar
              ? `هذه القاعدة لا تصل للضيف إطلاقاً: ${reason} النظام يسقط أي جائزة ناقصة بدل عرض وعد غامض.`
              : `Dropped before reaching guests: ${reason}`}
          </span>
        </div>
      )}
      {!live && !reason && rule.active === false && (
        <p className="ga-hint">{ar ? 'موقوفة بإرادتك — لن تُعرض على أي ضيف حتى تُفعّلها.' : 'Switched off.'}</p>
      )}

      <div className="ga-two">
        <label className="ga-field">
          <span>{ar ? 'اللعبة' : 'Game'}</span>
          <select className="ga-input" disabled={!canEdit} value={rule.gameId || 'any'} onChange={(e) => set({ gameId: e.target.value })}>
            <option value="any">{ar ? 'كل الألعاب' : 'All games'}</option>
            {GAMES.map((g) => <option key={g.id} value={g.id}>{ar ? g.ar : (g.en || g.ar)}</option>)}
          </select>
        </label>
        <label className="ga-field">
          <span>{ar ? 'الشرط' : 'Condition'}</span>
          <select className="ga-input" disabled={!canEdit} value={metric} onChange={(e) => set({ metric: e.target.value })}>
            {REWARD_METRICS.map((m) => <option key={m.id} value={m.id}>{ar ? m.ar : m.en}</option>)}
          </select>
        </label>
      </div>

      {needsThreshold && (
        <label className="ga-field">
          <span>{metric === 'stage' ? (ar ? 'المرحلة المطلوبة' : 'Stage') : (ar ? 'النقاط المطلوبة' : 'Score needed')}</span>
          <input
            className="ga-input ga-num" type="number" inputMode="numeric" min="1" disabled={!canEdit}
            value={rule.threshold ?? ''} onChange={(e) => set({ threshold: e.target.value })}
          />
        </label>
      )}

      <div className="ga-two">
        <label className="ga-field">
          <span>{ar ? 'نوع الجائزة' : 'Prize kind'}</span>
          <select className="ga-input" disabled={!canEdit} value={kind} onChange={(e) => setPrize({ kind: e.target.value })}>
            {PRIZE_KINDS.map((k) => <option key={k.id} value={k.id}>{ar ? k.ar : k.en}</option>)}
          </select>
        </label>
        {kind !== 'freeItem' && (
          <label className="ga-field">
            <span>{kind === 'discount' ? (ar ? 'نسبة الخصم' : 'Discount %') : (ar ? 'عدد النقاط' : 'Points')}</span>
            <input
              className="ga-input ga-num" type="number" inputMode="numeric" min="1"
              max={kind === 'discount' ? 100 : undefined} disabled={!canEdit}
              value={rule.prize?.value ?? ''} onChange={(e) => setPrize({ value: e.target.value })}
            />
          </label>
        )}
      </div>

      <label className="ga-field">
        <span>{kind === 'freeItem' ? (ar ? 'اسم الصنف المجاني' : 'Free item name') : (ar ? 'وصف مختصر (اختياري)' : 'Short label (optional)')}</span>
        <input
          className="ga-input" type="text" maxLength={60} disabled={!canEdit}
          placeholder={kind === 'freeItem' ? (ar ? 'مثال: كوب قهوة مختصة' : 'e.g. Filter coffee') : ''}
          value={rule.prize?.label || ''} onChange={(e) => setPrize({ label: e.target.value })}
        />
      </label>

      <div className="ga-two">
        <label className="ga-field">
          <span>{ar ? 'لكل ضيف' : 'Per guest'}</span>
          <select className="ga-input" disabled={!canEdit} value={rule.perGuest || 'once'} onChange={(e) => set({ perGuest: e.target.value })}>
            {PER_GUEST.map((p) => <option key={p.id} value={p.id}>{ar ? p.ar : p.en}</option>)}
          </select>
        </label>
        <label className="ga-field">
          <span>{ar ? 'رمز ثابت (اختياري)' : 'Fixed code (optional)'}</span>
          <input
            className="ga-input ga-num" type="text" maxLength={24} dir="ltr" disabled={!canEdit}
            placeholder={ar ? 'يُولَّد تلقائياً إن تُرك فارغاً' : 'auto-generated if empty'}
            value={rule.prize?.code || ''} onChange={(e) => setPrize({ code: e.target.value })}
          />
        </label>
      </div>

      <label className="ga-check">
        <input type="checkbox" disabled={!canEdit} checked={rule.active !== false} onChange={(e) => set({ active: e.target.checked })} />
        <span>{ar ? 'مفعّلة' : 'Active'}</span>
      </label>

      {/* What the guest will literally read, generated by the same functions the
          guest-facing hub uses — so this preview cannot drift from reality. */}
      {live && (
        <div className="ga-preview">
          <span className="ga-preview-l">{ar ? 'ما سيقرؤه الضيف' : 'What the guest reads'}</span>
          <strong>{claimText(normalizeRule(rule, index).prize, { itemName: rule.prize?.label || '' })}</strong>
          <span className="ga-hint">
            {conditionText(normalizeRule(rule, index), rule.gameId === 'any' ? '' : gameName)}
            {' · '}
            {perGuestText(normalizeRule(rule, index))}
          </span>
        </div>
      )}

      {/* Claims — a floor, never a census. */}
      <div className="ga-claims">
        {!claimsOk ? (
          <span className="ga-hint">
            {ar
              ? 'عدد المطالبات غير متاح: تعذّرت قراءة سجل الرموز الصادرة. لا نعرض صفراً لأنه ليس قياساً.'
              : 'Claim count unavailable — not shown as zero, because it was not measured.'}
          </span>
        ) : claims ? (
          <>
            <span className="ga-tag">
              {ar ? 'رموز صدرت' : 'Codes issued'} <span className="ga-num">{fmtInt(claims.total)}</span>
            </span>
            {claims.redeemed > 0 && (
              <span className="ga-tag">
                {ar ? 'مُستخدمة' : 'Redeemed'} <span className="ga-num">{fmtInt(claims.redeemed)}</span>
              </span>
            )}
            <span className="ga-of ga-num">{ar ? 'آخرها' : 'last'} {dateTime(claims.lastAt)}</span>
            <span className="ga-hint">
              {ar
                ? 'هذا العدد حدّ أدنى: تسجيل الرمز في السحابة محاولة أفضل-جهد من جهاز الضيف، وقد يفوت بعضها. الكاشير هو البوابة الحقيقية.'
                : 'A floor, not a census: the mirror is best-effort from the guest device.'}
            </span>
          </>
        ) : (
          <span className="ga-hint">
            {ar
              ? 'لم يصدر أي رمز لهذه القاعدة بعد.'
              : 'No code issued for this rule yet.'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function RewardsPanel({
  ar = true, tenant, canEdit = false, claims = [], claimsOk = false,
  fromMs = 0, toMs = Number.MAX_SAFE_INTEGER, onSave, saving = false,
}) {
  const stored = tenant?.gameRewards || {}
  const [enabled, setEnabled] = useState(stored.enabled === true)
  const [note, setNote] = useState(String(stored.note || ''))
  const [rules, setRules] = useState(() => (Array.isArray(stored.rules) ? stored.rules : []))
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState('')

  // Reseed when the tenant document changes underneath (another tab, another
  // manager) — but never while there are unsaved edits on this screen.
  useEffect(() => {
    if (dirty) return
    setEnabled(stored.enabled === true)
    setNote(String(stored.note || ''))
    setRules(Array.isArray(stored.rules) ? stored.rules : [])
  }, [tenant, dirty])

  const byRule = useMemo(() => claimsByRule(claims, fromMs, toMs), [claims, fromMs, toMs])
  const liveCount = useMemo(
    () => rules.filter((r, i) => Boolean(normalizeRule(r, i))).length,
    [rules],
  )

  const edit = (i, next) => { setRules(rules.map((r, x) => (x === i ? next : r))); setDirty(true) }
  const add = () => { setRules([...rules, emptyRule(rules.length)]); setDirty(true) }
  const remove = (i) => { setRules(rules.filter((_, x) => x !== i)); setDirty(true) }

  const save = async () => {
    setErr('')
    try {
      await onSave?.({
        enabled,
        note: String(note || '').slice(0, 200),
        rules: rules.map((r, i) => ({
          ...r,
          id: String(r.id || `r${i + 1}`),
          threshold: num(r.threshold),
          prize: { ...(r.prize || {}), value: num(r.prize?.value) },
        })),
      })
      setDirty(false)
    } catch (e) { setErr(String(e?.message || e)) }
  }

  return (
    <div className="ga-stack">
      <div className="ga-card">
        <div className="ga-card-t">
          <Icon name="offers" size={15} /> {ar ? 'جوائز الألعاب' : 'Game rewards'}
          <span className="ga-grow" />
          <span className="ga-of ga-num">
            {fmtInt(liveCount)} {ar ? 'سارية من' : 'live of'} {fmtInt(rules.length)}
          </span>
        </div>
        <label className="ga-check">
          <input
            type="checkbox" disabled={!canEdit} checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); setDirty(true) }}
          />
          <span>{ar ? 'تفعيل الجوائز في ركن الألعاب' : 'Enable rewards'}</span>
        </label>
        <p className="ga-hint">
          {ar
            ? 'عند الإيقاف لا يُعرض على الضيف أي وعد بجائزة إطلاقاً — ولا حتى «ربما في المرة القادمة». الجائزة تُعرض فقط حين يستحقها فعلاً.'
            : 'When off, no prize is ever hinted at. A reward is shown only when actually earned.'}
        </p>
        <label className="ga-field">
          <span>{ar ? 'سطر تكتبه للضيف (اختياري)' : 'Your own line (optional)'}</span>
          <input
            className="ga-input" type="text" maxLength={200} disabled={!canEdit} value={note}
            placeholder={ar ? 'مثال: الجوائز تُستلم من الكاشير قبل الدفع' : 'e.g. Claim at the till before paying'}
            onChange={(e) => { setNote(e.target.value); setDirty(true) }}
          />
        </label>
        {!enabled && rules.length > 0 && (
          <div className="ga-warn">
            <Icon name="warning" size={15} />
            <span>
              {ar
                ? `لديك ${fmtInt(rules.length)} قاعدة محفوظة لكن الجوائز موقوفة — لا شيء منها يصل الضيف الآن.`
                : 'Rules are saved but rewards are off — none of them reach guests.'}
            </span>
          </div>
        )}
      </div>

      {err && <div className="ga-warn"><Icon name="warning" size={15} /><span>{err}</span></div>}

      {rules.length === 0 ? (
        <div className="ga-card">
          <p className="ga-empty-t">{ar ? 'لا قاعدة جوائز بعد' : 'No reward rules'}</p>
          <p className="ga-hint">
            {ar
              ? 'القاعدة تربط شرطاً حقيقياً (نقاط الجولة، الوصول لمرحلة، إكمال اللعبة) بجائزة تكتبها أنت. الضيف يرى رمزاً يُظهره للكاشير — لا خصم يُطبَّق تلقائياً في أي مكان.'
              : 'A rule ties a real condition to a prize you write. The guest gets a code for the cashier.'}
          </p>
        </div>
      ) : rules.map((r, i) => (
        <RuleCard
          key={r.id || i} ar={ar} rule={r} index={i} canEdit={canEdit}
          claims={byRule.get(String(r.id)) || null} claimsOk={claimsOk}
          onChange={(next) => edit(i, next)} onRemove={() => remove(i)}
        />
      ))}

      {canEdit && (
        <div className="ga-actions">
          <button type="button" className="ga-btn" onClick={add}>
            <Icon name="add" size={14} /> {ar ? 'قاعدة جديدة' : 'Add rule'}
          </button>
          <span className="ga-grow" />
          {dirty && <span className="ga-hint">{ar ? 'تغييرات غير محفوظة' : 'Unsaved changes'}</span>}
          <button type="button" className="ga-btn is-primary" disabled={!dirty || saving} onClick={save}>
            <Icon name="check" size={14} /> {ar ? 'حفظ الجوائز' : 'Save rewards'}
          </button>
        </div>
      )}
    </div>
  )
}
