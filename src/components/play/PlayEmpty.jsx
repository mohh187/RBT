// Empty state. It does one job: tell the truth about why the page is blank and
// exactly what will fill it, so nobody assumes the feature is broken.
import Icon from '../Icon.jsx'

const ROWS_AR = [
  ['chartBar', 'كم مرة لُعبت كل لعبة، كم لاعباً مختلفاً، ومتوسط مدة اللعب — أرقام حقيقية بحجم عينتها بجانبها.'],
  ['notepad', 'كل سؤال رآه الضيف وكل إجابة اختارها، محفوظة كما هي، مع نسبة الصحة حسب التصنيف.'],
  ['user', 'ملف لكل لاعب: محاولاته، أفضل نتائجه، أبعد مرحلة وصلها، ونتيجة اختبار الشخصية إن أنهاه.'],
  ['layers', 'شرائح تسويقية محسوبة بقواعد ثابتة — المنافسون، من توقّف في المنتصف، من أنهى الاختبار ولم يطلب — مع قائمة الأرقام التي يمكن مراسلتها فعلاً.'],
  ['sparkles', 'تحليل بالذكاء يقرأ هذه الأرقام وحدها، ويعرض تحت كل إجابة اللقطة التي بنى عليها كلامه.'],
]

export default function PlayEmpty({ ar = true, hasGames = true, periodLabel = '' }) {
  return (
    <div className="gp-card">
      <div className="gp-empty">
        <span className="gp-empty-ico"><Icon name="play" size={26} /></span>
        <strong>{ar ? 'لا نشاط ألعاب بعد' : 'No play activity yet'}</strong>
        <p>
          {ar
            ? (hasGames
              ? `لم يلعب أي ضيف داخل الفترة المختارة${periodLabel ? ` (${periodLabel})` : ''}. الصفحة تعمل — لا يوجد ما تعرضه بعد. جرّب توسيع الفترة أولاً.`
              : 'لا توجد ألعاب مفعّلة في هذا المكان. فعّل لعبة أو أكثر من إعدادات المنيو، وسيبدأ التسجيل من أول ضيف يلعب.')
            : 'No plays inside the selected period.'}
        </p>
        <div className="gp-empty-list">
          {ROWS_AR.map(([icon, text]) => (
            <div className="gp-empty-row" key={text}>
              <Icon name={icon} size={14} />
              <span>{text}</span>
            </div>
          ))}
        </div>
        <p className="gp-hint">
          {ar
            ? 'ملاحظة مهمة: يُسجَّل الضيف بمعرّف جهازه دائماً، أما الاسم ورقم الجوال فلا يُسجَّلان إلا إذا تركهما بنفسه. من لم يترك رقماً يظهر في الإحصاءات ولا يمكن مراسلته.'
            : 'Guests are always identified by device; name and phone only when they leave them.'}
        </p>
      </div>
    </div>
  )
}
