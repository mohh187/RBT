// Players table. One row per DEVICE, because a device is the only thing we can
// always identify — a phone is a bonus, not a guarantee. Anonymous players are
// shown as «مجهول» with a shortened device id rather than being hidden, so the
// counts on this page always add up to the overview.
import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { tagLabel } from '../../lib/gameMemory.js'
import { dateTime, playerLabel, shortDevice, maskPhone, tagRule } from './engine.jsx'

const SORTS = [
  { key: 'lastAt', ar: 'الأحدث', en: 'Recent' },
  { key: 'totalPlays', ar: 'الأكثر لعباً', en: 'Most plays' },
  { key: 'bestScore', ar: 'أعلى نتيجة', en: 'Best score' },
  { key: 'accuracy', ar: 'أعلى دقة', en: 'Accuracy' },
]

export default function PlayersTable({ players = [], ar = true, onOpen }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('lastAt')
  const [onlyPhone, setOnlyPhone] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = players
    if (needle) {
      list = list.filter((p) => [p.customerName, p.customerPhone, p.deviceId, p.insight && p.insight.archetype]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)))
    }
    if (onlyPhone) list = list.filter((p) => p.customerPhone)
    const val = (p) => (sort === 'accuracy' ? (p.accuracy == null ? -1 : p.accuracy) : Number(p[sort] || 0))
    return [...list].sort((a, b) => val(b) - val(a))
  }, [players, q, sort, onlyPhone])

  return (
    <div className="gp-card">
      <span className="gp-card-t"><Icon name="customers" size={17} /> {ar ? 'اللاعبون' : 'Players'}</span>
      <p className="gp-hint">
        {ar
          ? 'كل صف جهاز واحد. من ترك رقم جوال يظهر باسمه أو رقمه ويمكن مراسلته؛ ومن لم يترك شيئاً يظهر «مجهول» مع معرّف جهازه — يُحتسب في الأرقام ولا يمكن الوصول إليه. اضغط أي صف لفتح ملفه الكامل.'
          : 'One row per device. Click a row for the full profile.'}
      </p>

      <div className="gp-search">
        <input
          className="input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'ابحث باسم أو رقم أو نمط' : 'Search name, phone or archetype'}
        />
        <div className="gp-scroll-x">
          <div className="gp-quick">
            {SORTS.map((s) => (
              <button
                key={s.key} type="button"
                className={`chip${sort === s.key ? ' active' : ''}`}
                aria-pressed={sort === s.key}
                onClick={() => setSort(s.key)}
              >{ar ? s.ar : s.en}</button>
            ))}
            <button
              type="button" className={`chip${onlyPhone ? ' active' : ''}`}
              aria-pressed={onlyPhone} onClick={() => setOnlyPhone((v) => !v)}
            >{ar ? 'من يمكن مراسلته فقط' : 'Reachable only'}</button>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <p className="gp-hint">{ar ? 'لا لاعب يطابق البحث.' : 'No player matches.'}</p>
      ) : (
        <div className="gp-tablewrap">
          <table className="gp-table">
            <thead>
              <tr>
                <th>{ar ? 'اللاعب' : 'Player'}</th>
                <th>{ar ? 'محاولات' : 'Plays'}</th>
                <th>{ar ? 'ألعاب' : 'Games'}</th>
                <th>{ar ? 'أعلى نتيجة' : 'Best'}</th>
                <th>{ar ? 'الدقة' : 'Accuracy'}</th>
                <th>{ar ? 'النمط' : 'Archetype'}</th>
                <th>{ar ? 'الوسوم' : 'Tags'}</th>
                <th>{ar ? 'آخر ظهور' : 'Last seen'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.deviceId} onClick={() => onOpen && onOpen(p)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' && onOpen) onOpen(p) }}
                >
                  <td>
                    <span className="gp-cell-name">
                      {playerLabel(p, ar)}
                      <small className="gp-num">
                        {p.customerPhone ? maskPhone(p.customerPhone) : shortDevice(p.deviceId)}
                        {p.outsideWindow ? (ar ? ' · خارج الفترة' : ' · outside period') : ''}
                      </small>
                    </span>
                  </td>
                  <td className="gp-num">{fmtNum(p.totalPlays)}</td>
                  <td className="gp-num">{fmtNum(p.gamesTried)}</td>
                  <td className="gp-num">{fmtNum(p.bestScore)}</td>
                  <td className="gp-num">
                    {p.accuracy == null ? '—' : `${fmtNum(Math.round(p.accuracy * 100))}%`}
                    {p.knowledge && p.knowledge.answered > 0 && (
                      <span className="gp-of"> ({fmtNum(p.knowledge.answered)})</span>
                    )}
                  </td>
                  <td>{p.insight && p.insight.archetype ? p.insight.archetype : <span className="gp-of">{ar ? 'غير معروف' : 'unknown'}</span>}</td>
                  <td>
                    <span className="gp-tags">
                      {(p.tags || []).slice(0, 3).map((t) => (
                        <span
                          className={`gp-tag${t === 'anonymous' ? ' is-anon' : ''}${t === 'identified' ? ' is-id' : ''}`}
                          key={t} title={tagRule(t, ar)}
                        >{tagLabel(t, ar)}</span>
                      ))}
                      {(p.tags || []).length > 3 && <span className="gp-tag gp-num">+{fmtNum(p.tags.length - 3)}</span>}
                      {!(p.tags || []).length && <span className="gp-of">—</span>}
                    </span>
                  </td>
                  <td className="gp-num">{dateTime(p.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="gp-hint gp-num">
        {ar ? `معروض ${fmtNum(rows.length)} من ${fmtNum(players.length)} لاعباً` : `${fmtNum(rows.length)} of ${fmtNum(players.length)}`}
      </p>
    </div>
  )
}
