// Segments: rule-derived audiences that stand entirely without the AI tab.
//
// The honest part of this screen is the split between "players matched" and
// "phones we can actually reach". A segment of forty enthusiastic players is
// worth nothing if thirty-eight of them never left a number, and this card says
// so on its face instead of letting a manager discover it after writing the
// campaign.
import Icon from '../Icon.jsx'
import { fmtNum } from '../../lib/format.js'
import { maskPhone, THIN_PLAYERS } from './engine.jsx'

// The draft handed to onCreateCampaign. Shape is fixed by the campaigns page:
//   { title, message, audience: { phones: [{phone,name}], count }, source }
export function segmentDraft(seg, extra = {}) {
  return {
    title: seg.ar,
    message: '',
    audience: {
      phones: seg.phones,
      count: seg.phones.length,
      anonymousUnreachable: seg.anonymousDevices,
      playerCount: seg.playerCount,
    },
    segmentId: seg.id,
    segmentLabel: seg.ar,
    segmentWhy: seg.why,
    source: 'guest-play',
    ...extra,
  }
}

export function SegmentCard({ seg, ar = true, onCreateCampaign, periodLabel = '', source = 'guest-play' }) {
  const reach = seg.phones.length
  const total = reach + seg.anonymousDevices
  const canPrepare = typeof onCreateCampaign === 'function'

  return (
    <div className="gp-seg">
      <span className="gp-seg-t">
        <Icon name="layers" size={16} /> {seg.ar}
        {seg.thin && <span className="gp-thin">{ar ? 'عينة صغيرة' : 'thin sample'}</span>}
      </span>
      <p className="gp-hint">{seg.why}</p>

      <div className="gp-seg-nums">
        <span><b className="gp-num">{fmtNum(seg.playerCount)}</b> {ar ? 'لاعب مطابق' : 'matching players'}</span>
        <span className="is-ok"><b className="gp-num">{fmtNum(reach)}</b> {ar ? 'رقم حقيقي يمكن مراسلته' : 'reachable phones'}</span>
        <span className="is-no"><b className="gp-num">{fmtNum(seg.anonymousDevices)}</b> {ar ? 'مجهول بلا رقم' : 'anonymous'}</span>
        {total > 0 && (
          <span className="gp-of">
            {ar ? 'نسبة القابلين للوصول' : 'reachable'} <b className="gp-num">{fmtNum(Math.round((reach / total) * 100))}%</b>
          </span>
        )}
      </div>

      {reach > 0 && (
        <div className="gp-qchips">
          {seg.phones.slice(0, 6).map((p) => (
            <span className="gp-qchip gp-num" key={p.phone}>{maskPhone(p.phone)}{p.name ? ` · ${p.name}` : ''}</span>
          ))}
          {reach > 6 && <span className="gp-qchip gp-num">+{fmtNum(reach - 6)}</span>}
        </div>
      )}

      {seg.thin && (
        <div className="gp-warn">
          <Icon name="warning" size={15} />
          <span>{ar
            ? `هذه الشريحة أقل من ${fmtNum(THIN_PLAYERS)} لاعبين. القاعدة التي بنتها صحيحة، لكن حجمها لا يكفي لاستنتاج نمط عام عن زبائنك.`
            : `Fewer than ${fmtNum(THIN_PLAYERS)} players — the rule holds, the sample does not generalise.`}</span>
        </div>
      )}

      {!reach ? (
        <p className="gp-hint">
          {ar
            ? 'لا يمكن إطلاق حملة على هذه الشريحة: كل من فيها لعب بلا رقم جوال. اطلب الرقم داخل اللعبة قبل عرض النتيجة لتتحول هذه الشريحة إلى جمهور حقيقي.'
            : 'No reachable phones in this segment.'}
        </p>
      ) : canPrepare ? (
        <button
          type="button" className="btn btn-sm btn-primary"
          onClick={() => onCreateCampaign(segmentDraft(seg, { source, period: periodLabel }))}
        >
          <Icon name="message" size={15} /> {ar ? 'جهّز حملة' : 'Prepare campaign'}
        </button>
      ) : (
        <p className="gp-hint">{ar ? 'صفحة الحملات غير موصولة بهذه الشاشة بعد.' : 'Campaigns page not wired to this screen yet.'}</p>
      )}
    </div>
  )
}

export default function PlaySegments({ segments = [], ar = true, onCreateCampaign, periodLabel = '' }) {
  return (
    <div className="gp-stack">
      <div className="gp-card">
        <span className="gp-card-t"><Icon name="customers" size={17} /> {ar ? 'شرائح جاهزة للتسويق' : 'Marketing segments'}</span>
        <p className="gp-hint">
          {ar
            ? 'كل شريحة هنا قاعدة رقمية على سلوك مسجّل فعلاً، محسوبة بلا ذكاء اصطناعي وتبقى صحيحة حتى لو كان المساعد متوقفاً. الأرقام مأخوذة من الضيوف الذين تركوا رقمهم، بعد إزالة التكرار.'
            : 'Each segment is a fixed rule over recorded behaviour, computed without any AI, de-duplicated by phone.'}
        </p>
      </div>

      {!segments.length ? (
        <div className="gp-card">
          <p className="gp-hint">
            {ar
              ? 'لا شريحة مطابقة بعد. تظهر الشرائح تلقائياً حين يتراكم لعب كافٍ: إعادة المحاولات، إنهاء اختبارات الشخصية، الانسحاب في المنتصف، ودقة الإجابات.'
              : 'No segment matches yet.'}
          </p>
        </div>
      ) : (
        <div className="gp-two">
          {segments.map((s) => (
            <SegmentCard
              key={s.id} seg={s} ar={ar}
              onCreateCampaign={onCreateCampaign} periodLabel={periodLabel}
            />
          ))}
        </div>
      )}
    </div>
  )
}
