# DESIGN AUDIT — 2026-07-17

Full-system design audit: 10 surfaces, 58 agents, every CRITICAL/HIGH finding adversarially verified against the code (46 confirmed, 1 refuted-and-dropped).

| Surface | Score | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| cashier | 7/10 | 1 | 4 | 6 | 4 |
| kds | 7/10 | 1 | 4 | 5 | 2 |
| menu-diner | 7/10 | 1 | 4 | 10 | 2 |
| checkout-payments | 7/10 | 0 | 3 | 6 | 2 |
| admin-core | 7/10 | 1 | 3 | 8 | 3 |
| admin-settings | 6/10 | 1 | 5 | 5 | 2 |
| auth-landing | 7/10 | 0 | 5 | 6 | 3 |
| platform-console | 6.5/10 | 0 | 4 | 8 | 4 |
| portals-events | 6.5/10 | 1 | 3 | 6 | 2 |
| global-system | 7/10 | 2 | 4 | 6 | 3 |

## cashier — 7/10

سطح الكاشير مبني جيداً عموماً: نظام tokens متّسق، خصائص منطقية للـ RTL، معالجة ثيمات متعددة، وحالات فارغة موجودة. لكن توجد مخالفة قاعدة صارمة (إيموجي ⏰ في إشعار الطلب المتأخر)، وثغرات في التغذية الراجعة للعمليات الحرجة (تأكيد الدفع وإغلاق الدرج بلا حالة انشغال أو معالجة خطأ)، وأهداف لمس مصغّرة قسرياً (32px وأقل) على شاشة تابلت-أولاً، وكسر استجابة على iPad landscape حيث تلتف اللوحة ذات الثلاث حارات إلى عمودين. كما أن إجمالي التذكرة — أهم رقم للمسح السريع — يُعرض بنفس حجم نص الأصناف.

- **[CRITICAL] إيموجي ⏰ في عنوان إشعار الطلب المتأخر — مخالفة قاعدة «لا إيموجي أبداً»**  
  src/routes/staff/Cashier.jsx:100 · hard-rule
  - الدليل: `alertParty({ title: lang === 'ar' ? '⏰ طلب متأخر' : '⏰ Late order', body: '${orderNumber(o.code)} · ...' })`
  - الإصلاح: احذف الرمز ⏰ من النصين العربي والإنجليزي واكتفِ بالنص، أو مرّر أيقونة عبر نظام الإشعارات إن كان يدعمها.
- **[HIGH] تأكيد الدفع بلا معالجة خطأ ولا تغذية راجعة — فشل الدفع صامت تماماً**  
  src/routes/staff/Cashier.jsx:133 · states
  - الدليل: `const confirmPay = async ({ method, tip, amountPaid, breakdown }) => { ... setPayTarget(null) ... await payOrder(tenantId, o.id, {...}) — لا try/catch ولا toast، والشيت يُغلق قبل انتهاء العملية`
  - الإصلاح: لفّ payOrder/payPartial في try/catch مع toast نجاح/فشل، وأبقِ الشيت بحالة انشغال حتى نجاح العملية بدل إغلاقه فوراً.
- **[HIGH] أزرار التذكرة (تفاصيل/طباعة/إلغاء) مصغّرة قسرياً إلى 32px وتتجاوز ترقية اللمس 46px**  
  src/routes/staff/Cashier.jsx:362 · touch
  - الدليل: `<button className="icon-btn" style={{ width: 32, height: 32 }} ...> ×3 مع gap: 4 — بينما CSS يرفع --tap إلى 46px على pointer: coarse؛ الـ inline style يتجاوزه، وزر الإلغاء المدمّر ملاصق لزر الطباعة`
  - الإصلاح: احذف width/height المضمّنة ودع icon-btn يأخذ var(--tap)، أو استخدم min 44px على اللمس وباعد زر الإلغاء عن بقية الأزرار.
- **[HIGH] لوحة الكاشير الثلاثية تلتف إلى عمودين على iPad landscape (1024px) — نقطة الكسر 1040px تفوّت أشهر تابلت**  
  src/index.css:2724 · responsive
  - الدليل: `@media (min-width: 1040px) { .board { grid-template-columns: repeat(3, 1fr); } } — بين 720 و1039 تظهر حارتان فقط في الصف الأول وحارة «جاهز» تهبط لصف ثانٍ نصفي الارتفاع داخل الإطار المثبّت (min-width: 980px)`
  - الإصلاح: اخفض نقطة كسر الأعمدة الثلاثة إلى 1000px أو 980px لتطابق إطار التثبيت وتغطي iPad landscape.
- **[HIGH] أزرار تعديل الكمية 22px وحذف الصنف 24px في تفاصيل الطلب — دون أي حد لمس مقبول**  
  src/components/OrderDetail.jsx:193 · touch
  - الدليل: `<button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setOrderItemQty(...)}> و <button ... style={{ width: 24, height: 24, color: 'var(--danger)' }} ... voidOrderItem`
  - الإصلاح: ارفع أهداف اللمس إلى 40-44px على الأقل (أو اعتمد var(--tap)) خاصةً أن الحذف عملية مدمّرة على شاشة موظفين.
- **[MEDIUM] إجمالي التذكرة بنفس حجم نص الأصناف — أهم رقم للمسح السريع لا يبرز**  
  src/routes/staff/Cashier.jsx:360 · hierarchy
  - الدليل: `<span className="price bold"><Price value={o.total} .../></span> — كلاس .price في index.css:316 يضبط tabular-nums فقط بلا حجم، بينما إجمالي POS يستخدم fs-xl وتفاصيل الطلب fs-md`
  - الإصلاح: أعطِ إجمالي التذكرة fontSize: var(--fs-lg) أو fs-md على الأقل ليتصدّر بصرياً على بقية سطور التذكرة.
- **[MEDIUM] مبلغ «المطلوب» في شيت الدفع بحجم fs-md فقط — يجب أن يهيمن على الشيت**  
  src/components/PaymentSheet.jsx:37 · hierarchy
  - الدليل: `<span className="price bold" style={{ fontSize: 'var(--fs-md)' }}><Price value={due} .../></span> — أهم رقم في تدفق التحصيل بحجم قريب من النص العادي`
  - الإصلاح: ارفع مبلغ المطلوب إلى var(--fs-2xl) أو ما يعادله كعنصر مهيمن أعلى الشيت ليتحقق الكاشير منه بلمحة.
- **[MEDIUM] فتح/إغلاق الوردية بلا حالة انشغال ولا معالجة خطأ — النقر المزدوج قد يكرّر الإغلاق والفشل صامت**  
  src/components/CashDrawer.jsx:48 · states
  - الدليل: `const doClose = async () => { await closeCashierSession(...); setCloseSheet(false) ... } — لا try/catch ولا disabled أثناء التنفيذ على زر «إغلاق الوردية» (line 89)`
  - الإصلاح: أضف حالة busy تعطّل الزر أثناء التنفيذ مع try/catch وtoast خطأ عند الفشل لكلا العمليتين.
- **[MEDIUM] window.prompt للكمية الكبيرة (وwindow.confirm للحذف في OrderDetail) — حوارات نظام غير مثيمة تكسر واجهة POS وقد لا تعمل في TWA**  
  src/components/CashierPOS.jsx:70 · consistency
  - الدليل: `const v = Number(window.prompt(ar ? 'الكمية الكبيرة؟' : 'Bulk quantity?', '10')) || 0 — وكذلك window.confirm في OrderDetail.jsx:205؛ بقية النظام يستخدم Sheet مخصصة`
  - الإصلاح: استبدل prompt/confirm بشيت أو Popover مخصص متّسق مع نظام التصميم (خاصةً أن التغليف Android TWA ضمن الخطة وprompt يُحظر فيه).
- **[MEDIUM] أيقونة X (close) تُستخدم كزر إنقاص كمية — تُقرأ كحذف، وبطاقة options تستخدم نمط stepper نصي مختلف (− / +)**  
  src/components/CashierPOS.jsx:459 · consistency
  - الدليل: `<button className="icon-btn pos-qty" onClick={() => setQty(l.key, l.qty - 1)}><Icon name="close" size={16} /></button> — مقابل <button ...>−</button> في PosOptionCard (line 119) وIcon name="close" أيضاً في POSItemSheet:604 وOrderDetail:193`
  - الإصلاح: وحّد الإنقاص على أيقونة minus في Icon.jsx في كل السطور (سلة POS، شيت الصنف، تفاصيل الطلب) بدل أيقونة الإغلاق.
- **[MEDIUM] تسميات مدد المراحل في الخط الزمني بحجم 9px ثابت — غير مقروءة على تابلت وخارج نظام الأحجام**  
  src/components/OrderDetail.jsx:151 · contrast
  - الدليل: `<span style={{ fontSize: 9, lineHeight: 1.1, minHeight: 11, fontWeight: 700, ... }}>{d ? fmtDur(d.ms) : '·'}</span> وكذلك fontSize: 9 لتسمية المرحلة في line 153`
  - الإصلاح: ارفعها إلى var(--fs-xs) على الأقل (11-12px) واستخدم token بدل قيمة px صلبة.
- **[LOW] أزرار الإكرامية تعرض أرقاماً مجردة (5 / 10 / 15) بلا عملة — تلتبس مع نسبة مئوية**  
  src/components/PaymentSheet.jsx:64 · consistency
  - الدليل: `<button ...>{tv === 0 ? (ar ? 'بدون' : 'None') : tv}</button> — القيم مبالغ ثابتة بالريال لكن لا شيء يدل على ذلك`
  - الإصلاح: أضف رمز العملة داخل الأزرار (<Price value={tv} .../>) أو لاحقة العملة في تسمية الحقل.
- **[LOW] محرف نصي ● كمؤشر حالة «الدرج مفتوح» بدل أيقونة أو عنصر مصمم — القاعدة: أيقونات فقط عبر Icon.jsx/SVG**  
  src/components/CashDrawer.jsx:63 · hard-rule
  - الدليل: `<span className="small bold" style={{ color: 'var(--success)' }}>● {ar ? 'الدرج مفتوح' : 'Drawer open'}...`
  - الإصلاح: استبدل ● بنقطة CSS (span مستدير بخلفية var(--success)) أو أيقونة من Icon.jsx لضبط الحجم والمحاذاة عبر الثيمات.
- **[LOW] تبويب «مكتملة» يعرض «لا طلبات مكتملة اليوم» أثناء التحميل الأولي — لا تمييز بين فارغ وجارِ التحميل**  
  src/routes/staff/Cashier.jsx:242 · states
  - الدليل: `const [todays, setTodays] = useState([]) (line 59) ثم completed.length === 0 ? <Empty ... 'لا طلبات مكتملة اليوم' /> — القيمة الابتدائية [] تعرض الحالة الفارغة قبل وصول snapshot`
  - الإصلاح: اجعل الحالة الابتدائية null واعرض Spinner حتى وصول أول snapshot كما يُفعل مع orders.
- **[LOW] زر «النافذة الكاملة» في بطاقة options مصغّر إلى 30px على سطح لمسي**  
  src/components/CashierPOS.jsx:90 · touch
  - الدليل: `<button type="button" className="icon-btn" style={{ width: 30, height: 30, flex: 'none' }} onClick={() => onOpenFull(it)} ...>`
  - الإصلاح: ارفعه إلى 40px على الأقل أو أزل الأبعاد المضمّنة على pointer: coarse ليرث var(--tap).

## kds — 7/10

شاشة KDS مبنية جيدا من حيث البنية: توكنات ألوان متسقة، حدود SLA قابلة للضبط مع تدرج warn/late ونبض للتذاكر المتأخرة، أربعة قوالب عرض، وشريط جاهز مثبت للإكسبو. لكن كتلة CSS متأخرة أعادت أشرطة تمرير مرئية بمسار في كل الأسطح القابلة للتمرير خرقا مباشرا للقاعدة الصلبة، وأهداف اللمس الأساسية (شطب السطر ~30px، استرجاع 32px، قُدّم/قبول 36px) كلها تحت حد 44px على جهاز يستخدم بأصابع دهنية. الأخطر تشغيليا: طابور الطلبات المعلقة وزر القبول يختفيان كليا تحت 1000px، وتحذير الحساسية هو أصغر نص في التذكرة (11px) رغم أنه معلومة سلامة، والقالب الافتراضي يستخدم سلم الخط المضغوط الخاص بالأدمن غير المناسب للقراءة من مسافة متر.

- **[CRITICAL] كتلة "Custom Scrollbar Styling" المتأخرة تعيد أشرطة تمرير مرئية بمسار في كل شاشة المطبخ**  
  src/index.css:4475 · hard-rule
  - الدليل: `index.css:4475 '::-webkit-scrollbar { width: 8px; height: 8px; }' + 4479 '::-webkit-scrollbar-track { background: var(--bg-2); ... }' + 4494 '* { scrollbar-width: thin; ... }' — تأتي بعد قاعدة الإخفاء الصلبة في السطر 1252 '* { scrollbar-width: none }' و1256 '*::-webkit-scrollbar { display: none }' و`
  - الإصلاح: احذف كتلة 4474-4497 كليا أو حولها إلى إبهام overlay يظهر عند التمرير فقط بدون مسار، بما يوافق القاعدة الصلبة في 1249
- **[HIGH] طابور الطلبات المعلقة وزر "قبول" يختفيان تماما على التابلت العمودي (أقل من 1000px)**  
  src/routes/staff/Kds.jsx:305 · responsive
  - الدليل: `قائمة pendingQ وزر Accept موجودان فقط داخل '<aside className="kds-side">' (Kds.jsx:298-313)، وفي index.css:2114 '@media (max-width: 1000px) { .kds-side { display: none; } }' — تابلت مطبخ عمودي (768-834px) لا يرى الطلبات المعلقة إطلاقا ولا يستطيع قبولها من شاشة المطبخ`
  - الإصلاح: أظهر شريط الطلبات المعلقة كصف أفقي فوق اللوحة (مثل kds-ready-strip) عندما يكون kds-side مخفيا
- **[HIGH] سطر شطب الصنف (kds-line) ارتفاعه نحو 30px فقط — أقل بكثير من 44px على تابلت المطبخ**  
  src/routes/staff/Kds.jsx:164 · touch
  - الدليل: `الصف قابل للنقر 'role="button" ... onClick={() => setOrderLineDone(...)}' وارتفاعه يحدده '.kds-qty { min-width: 26px; height: 26px; }' (index.css:1015) مع '.kds-line { padding: 2px 4px; margin: -2px -4px; }' (2144)، والفجوة بين السطور '.kds-items { gap: 7px }' (1013) — أصابع دهنية ستشطب السطر الخطأ`
  - الإصلاح: ارفع الحد الأدنى لارتفاع kds-line إلى 44px (padding-block أكبر) وزد gap بين السطور إلى 10px على الأقل تحت pointer: coarse
- **[HIGH] تحذير الحساسية (kds-warn) أصغر نص في التذكرة (11px) رغم أنه معلومة سلامة حرجة**  
  src/index.css:2152 · hierarchy
  - الدليل: `.kds-warn { ... font-size: var(--fs-xs); ... } والتعليق فوقه يقول "the loudest thing on the card" — لكن تحت الكثافة المضغوطة --fs-xs = 0.6875rem أي 11px (index.css:832)، أصغر من اسم الصنف (15px) ومن المعدلات (12px)، مع أيقونة size={11} في Kds.jsx:171`
  - الإصلاح: ارفع kds-warn إلى var(--fs-md) على الأقل بخلفية danger مصمتة (نص أبيض على أحمر) بدل danger-soft ليقرأ من مسافة متر
- **[HIGH] أزرار شريط الجاهز (استرجاع 32px وقُدّم 36px) تحت حد اللمس وهي أهم أفعال الإكسبو**  
  src/routes/staff/Kds.jsx:262 · touch
  - الدليل: `'<button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => recall(o)}' وبجانبه مباشرة '<button className="btn btn-sm btn-success" onClick={() => serve(o)}>' — .btn-sm min-height: 36px (index.css:588) والفجوة gap: 8px فقط (.kds-ready-chip، index.css:2129)؛ نقرة خاطئة تسترجع طلبا ج`
  - الإصلاح: اجعل الزرين بارتفاع 44px على الأقل (أزل الـ style المضمن واستخدم var(--tap)) وباعد بينهما 12px
- **[MEDIUM] أزرار bump/قُدّم/قبول بلا حالة busy أو تعطيل أثناء الكتابة غير المتزامنة**  
  src/routes/staff/Kds.jsx:181 · states
  - الدليل: `'<button className={\'btn kds-bump ...\'} onClick={() => updateOrderStatus(tenantId, o.id, next)}>' (181) وكذلك serve (204) وaccept (311) — لا disabled أثناء الطلب ولا معالجة رفض؛ نقرتان سريعتان على تذكرة قد تدفعان الطلب حالتين للأمام، وفي انقطاع الشبكة لا يظهر أي خطأ`
  - الإصلاح: عطل الزر أثناء الطلب المعلق (حالة saving لكل تذكرة) وأظهر toast خطأ عند فشل updateOrderStatus
- **[MEDIUM] التحميل الأولي سبينر عار بلا حالة خطأ — فشل onSnapshot يترك الشاشة معلقة للأبد**  
  src/routes/staff/Kds.jsx:90 · states
  - الدليل: `'if (orders === null) return <Spinner />' مع 'watchActiveOrders(tenantId, setOrders)' (السطر 56) بدون رد نداء خطأ — إن رفضت القواعد أو انقطع الاتصال تبقى orders === null وتظل شاشة المطبخ سبينر إلى الأبد (نمط stuck-spinner الموثق في تدقيق 2026-07-07)`
  - الإصلاح: مرر معالج خطأ لـ watchActiveOrders واعرض حالة خطأ مع زر إعادة محاولة بدل السبينر الدائم
- **[MEDIUM] حشوة kds-ready-chip فيزيائية (left/right) فتنعكس خطأ في العربية — اللغة الأساسية**  
  src/index.css:2130 · rtl
  - الدليل: `.kds-ready-chip { padding: 6px 8px 6px 12px; ... } — القصد 12px جهة رقم الطلب و8px جهة الأزرار، لكن في RTL يصير 12px بجانب زر "قُدّم" و8px بجانب الكود`
  - الإصلاح: استبدلها بـ padding-block: 6px; padding-inline: 12px 8px لتتبع اتجاه الكتابة
- **[MEDIUM] القالب الافتراضي rail يعرض أسماء الأصناف 15px والمعدلات 12px — صغيرة لقراءة من مسافة متر**  
  src/routes/staff/Kds.jsx:34 · hierarchy
  - الدليل: `useCompactUI() يفرض data-density='compact' فيهبط --fs-md إلى 0.9375rem/15px (index.css:835) المستخدم في .kds-name (1017) و--fs-sm إلى 12px في .kds-mods/.kds-note (1018-1019)، وشريحة المحطة ثابتة 'font-size: 10px' (2148). التكبير موجود فقط في قالب display (1032-1040) بينما الافتراضي rail (Kds.jsx:45)`
  - الإصلاح: طبق سلم خط أكبر على تذاكر KDS في كل القوالب (kds-name ≥ 18px، kds-mods ≥ 14px) واجعل kds-station بتوكن بدل 10px الثابتة
- **[MEDIUM] زر "قبول" الطلبات الجديدة btn-sm بارتفاع 36px — قرار تشغيلي متكرر تحت حد اللمس**  
  src/routes/staff/Kds.jsx:311 · touch
  - الدليل: `'<button className="btn btn-sm btn-primary" style={{ flex: 'none' }} onClick={() => accept(o)}>{ar ? 'قبول' : 'Accept'}</button>' مع .btn-sm { min-height: 36px } (index.css:588) — أقل من --tap: 46px المقرر للمس (index.css:2649)`
  - الإصلاح: استخدم btn عادي بارتفاع var(--tap) لزر القبول في طابور الوارد
- **[LOW] مقاسات خط مضمنة خارج سلم التوكنات: 10px لشارة "مباشر" و9px لشارة النشاط + حرف ● نصي بدل أيقونة**  
  src/routes/staff/Kds.jsx:218 · consistency
  - الدليل: `السطر 218: '<span className="badge badge-success" style={{ fontSize: 10 }}>● {ar ? 'مباشر' : 'Live'}</span>' والسطر 335: 'style={{ marginInlineStart: 'auto', fontSize: 9 }}' — نص 9px غير مقروء وكلاهما يتجاوز سلم --fs-*، والنقطة الحية حرف نصي بدل عنصر CSS/أيقونة`
  - الإصلاح: استخدم var(--fs-xs) للشارتين ونقطة حية عبر ::before بعرض 6px بلون var(--success)
- **[LOW] شريحة الحالة "جديدة/تحضير" في القوالب المختلطة 11px — إشارة الحالة الوحيدة على السطح المشترك ضعيفة من بعد**  
  src/index.css:1029 · hierarchy
  - الدليل: `.kds-status { font-size: var(--fs-xs); ... } (11px تحت الكثافة المضغوطة) — والتعليق في Kds.jsx:140-142 يقر أن شريحة الحالة ضرورية لأن نص زر الـ bump وحده لا يكفي كإشارة حالة في rail/grid/display`
  - الإصلاح: ارفع kds-status إلى var(--fs-sm) بوزن 800 وخلفية أكثر تشبعا لتمييز الجديدة عن قيد التحضير من مسافة

## menu-diner — 7/10

قائمة الضيف مبنية على نظام رموز CSS ناضج مع عمق تخصيص مبهر (13+ تخطيطاً، زجاج، حركات، سكنات) وحالات فارغة وتغذية راجعة جيدة للإضافة والطلب. المشاكل الحقيقية تتركز في حواف الثيمات: ألوان #fff مثبتة تنكسر مع هويات فاتحة (storefront بأكمله، بانر التتبع، نمط glow)، وعناصر مصمتة تصطدم بالخلفيات المخصصة (شريط التصنيفات اللاصق، حقول نموذج الدفع خارج منظومة الزجاج)، وبقايا خصائص فيزيائية left/right تكسر RTL في مواضع متفرقة. توجد مخالفة قاعدة صارمة واحدة مؤكدة (عرض ing.emoji في تفاصيل الصنف) وعلة ظاهرة للمستخدم: أيقونة بطاقة عضو VIP تُعرض فارغة لأن الحقل .emoji غير موجود في TIER_META.

- **[CRITICAL] عرض إيموجي من بيانات المكوّنات داخل شاشة تفاصيل الصنف**  
  src/components/MenuView.jsx:1256 · hard-rule
  - الدليل: `<span className="ic">{ing.emoji || (pickLang(ing, 'name', lang) || '•').charAt(0)}</span>`
  - الإصلاح: استبدل حقل ing.emoji بأيقونة من Icon.jsx أو اكتفِ بالحرف الأول من اسم المكوّن، لأن القاعدة الصارمة تمنع أي إيموجي في الواجهة.
- **[HIGH] أيقونة بطاقة عضو VIP تظهر فارغة لأن TIER_META لا يحتوي حقل emoji**  
  src/components/MenuView.jsx:514 · states
  - الدليل: `<span className="welcome-ic" ...>{(TIER_META[memberCard.tier] || TIER_META.silver).emoji}</span> — بينما TIER_META في membership.js:24 يعرّف { ar, en, icon: 'award', color } فقط بلا emoji، فتُعرض دائرة فارغة`
  - الإصلاح: استخدم <Icon name={(TIER_META[memberCard.tier] || TIER_META.silver).icon} /> بلون الفئة بدل الحقل غير الموجود .emoji.
- **[HIGH] قالب storefront يستخدم #fff مثبتاً فوق خلفية var(--brand) فيصبح غير مقروء مع الألوان الفاتحة**  
  src/index.css:3721 · contrast
  - الدليل: `[data-menu-layout='storefront'] { background: var(--brand); } مع .cat-heading { color: #fff; } (3722) و.menu-hero-title { color: #fff } (3724) و.store-sec strong { color: #fff } (3727) و.store-hero-name { color: #fff } (3734) و.store-add { color: #fff } (3745)`
  - الإصلاح: استبدل كل #fff وrgba(255,255,255,…) في قالب storefront بـ var(--on-brand) حتى تبقى النصوص مقروءة عندما يختار المتجر لوناً فاتحاً للهوية.
- **[HIGH] شريط التصنيفات اللاصق يرسم شريطاً معتماً بلون var(--bg) يقطع خلفية المتجر المخصصة**  
  src/components/MenuView.jsx:685 · consistency
  - الدليل: `style={{ position: 'sticky', top: 'calc(var(--appbar-h) + var(--safe-t))', zIndex: 50, ..., background: 'var(--bg)' }} — لا يوجد أي تجاوز إلا [data-menuglass] .cat-bar بـ !important (index.css:1087)، فالمتاجر التي لها bgImageUrl بدون menuGlass تحصل على شريط مصمت فوق الخلفية`
  - الإصلاح: عند data-venue-bg='1' اجعل خلفية الشريط شفافة جزئياً مع backdrop-filter (كما في .spot-cats) بدل var(--bg) المصمت.
- **[HIGH] حقول نموذج الدفع (الاسم/الجوال/الكوبون/الملاحظات/العنوان) تبقى مصمتة على القوائم الزجاجية**  
  src/index.css:704 · consistency
  - الدليل: `.input, .select, .textarea { ... background: var(--surface); } — وقوائم [data-menuglass='full'] تُزجّج .chip و.otype-chip و.stepper و.sheet (index.css:1103-1133) لكنها لا تشمل .input/.textarea إطلاقاً، فتظهر صناديق بيضاء صارخة داخل السلة المزججة`
  - الإصلاح: أضف .input و.textarea و.select إلى قائمة محددات [data-menuglass='full'] بخلفية color-mix(in srgb, var(--surface) …%, transparent) مثل بقية العناصر.
- **[MEDIUM] بانر تتبع الطلب يستخدم color:'#fff' مثبتاً فوق var(--brand) بدل var(--on-brand)**  
  src/components/MenuView.jsx:445 · contrast
  - الدليل: `background: isReady ? 'var(--success, #16a34a)' : 'var(--brand)', color: '#fff'`
  - الإصلاح: استخدم var(--on-brand) للنص وvar(--success) بدون قيمة hex احتياطية مثبتة ليتوافق البانر مع كل هويات الألوان.
- **[MEDIUM] نمط glow لاسم الصنف يثبّت اللون أبيض فيختفي الاسم على القوائم الفاتحة**  
  src/components/MenuView.jsx:36 · contrast
  - الدليل: `nameStyle.textShadow = '0 0 6px ${color}, 0 0 12px ${color}'; nameStyle.color = '#fff'`
  - الإصلاح: اجعل لون النص var(--text) أو it.nameColor واحصر التوهج في textShadow فقط حتى يبقى الاسم مقروءاً في الوضع الفاتح.
- **[MEDIUM] شارة «نفد» في بطاقات المعرض مثبتة بـ right فيزيائي بدل الاتجاه المنطقي**  
  src/components/MenuView.jsx:386 · rtl
  - الدليل: `{out && <span className="badge badge-danger" style={{ position: 'absolute', top: 8, right: 8 }}>{t('soldOut')}</span>} — بينما .special-badge في CSS يستخدم inset-inline-start (index.css:3416)`
  - الإصلاح: استبدل right: 8 بـ insetInlineEnd: 8 لتنعكس الشارة صحيحاً بين العربية والإنجليزية وتتسق مع بقية الشارات.
- **[MEDIUM] هالة spotlight على الشاشات العريضة مثبتة بـ left:30% فتضيء خلف النص بدل المنتج في RTL**  
  src/index.css:5065 · rtl
  - الدليل: `@media wide: .spot-slide { flex-direction: row; ... } مع .spot-bg { left: 30%; } — في RTL ينعكس ترتيب flex فيصبح المنتج في الجهة المقابلة للهالة`
  - الإصلاح: استخدم inset-inline-start: 30% بدل left حتى تلاحق الهالة صورة المنتج في الاتجاهين.
- **[MEDIUM] عداد سلة الزر الأوسط: ألوان hex مثبتة خارج نظام الرموز + right فيزيائي + دائرة 15px تفيض بعددين**  
  src/index.css:3596 · consistency
  - الدليل: `.cart-badge-count { position: absolute; top: -3px; right: -3px; background: #ef4444; color: #ffffff; font-size: 8px; ... width: 15px; height: 15px; } — بينما الشارة المجاورة .cart-badge تستخدم inset-inline-end: 26% وvar(--brand) (index.css:3597)`
  - الإصلاح: استخدم var(--danger)/var(--on-brand) وinset-inline-end وmin-width مع padding بدل width مثبت، وارفع الخط إلى 9-10px.
- **[MEDIUM] أزرار m-fab العائمة مثبتة بـ left/right فيزيائيين وشارة العداد كذلك**  
  src/index.css:3880 · rtl
  - الدليل: `.m-fab-cart { right: 12px; } .m-fab-bell { left: 12px; } و.m-fab .b { ... right: -4px; } (3883)`
  - الإصلاح: استبدلها بـ inset-inline-start/end حتى تنعكس مواضع الجرس والسلة عند التبديل إلى الإنجليزية مثل بقية عناصر الواجهة.
- **[MEDIUM] رمز ✓ نصي داخل زر «تم تحديد الموقع» بدل أيقونة من Icon.jsx**  
  src/components/MenuView.jsx:1727 · hard-rule
  - الدليل: `geo ? (lang === 'ar' ? 'تم تحديد الموقع ✓' : 'Location set ✓') — ونفس النمط في Stories.jsx:159: placeholder={sent ? (ar ? 'وصل ردك ✓' : 'Sent ✓') ...}`
  - الإصلاح: استبدل حرف ✓ بـ <Icon name="check" size={14} /> في الزر، وفي حقل الرد استخدم نصاً بلا رموز لأن placeholder لا يقبل أيقونات.
- **[MEDIUM] الأشرطة اللاصقة تفترض وجود شريط علوي 56px حتى مع سكنات header='none' فتترك فجوة يتسرب المحتوى فوقها**  
  src/components/MenuView.jsx:669 · hierarchy
  - الدليل: `top: 'calc(var(--appbar-h) + var(--safe-t))' (السطران 669 و685) و.spot-cats { top: calc(var(--appbar-h) + var(--safe-t)) } (index.css:4954) — بينما DinerBar.jsx:18 يعيد db-floating بلا شريط عندما head === 'none' وvar(--appbar-h) ثابت 56px عالمياً (index.css:93)`
  - الإصلاح: صفّر متغير --appbar-h (أو مرّر data-header='none' لضبط top: var(--safe-t)) عندما يختار السكن إخفاء الشريط العلوي.
- **[MEDIUM] نقاط شريط التقدم في spotlight هدف لمس 8px فقط على الجوال**  
  src/index.css:5128 · touch
  - الدليل: `.spot-dot { width: 8px; height: 8px; ... cursor: pointer; } مع gap: 9px في .spot-rail — وهي أزرار قفز فعلية (onClick scrollIntoView في MenuView.jsx:988)؛ كذلك زر مسح البحث 28px (MenuView.jsx:497) وزر إغلاق بطاقة الولاء 30px (MenuView.jsx:538)`
  - الإصلاح: كبّر منطقة اللمس إلى 24-44px عبر padding شفاف حول النقطة (والأزرار الصغيرة إلى 36px على الأقل) مع إبقاء الحجم المرئي كما هو.
- **[MEDIUM] حقل الكوبون بلا أي تغذية راجعة عند إدخال كود غير صالح أو منتهٍ**  
  src/components/MenuView.jsx:1768 · states
  - الدليل: `<input className="input" dir="ltr" value={coupon} onChange={...} placeholder="WELCOME10" /> — evaluateOffers (السطر 1499) يتجاهل الكود الخاطئ بصمت ولا يظهر سطر الخصم إلا عند النجاح، فلا يعرف الضيف هل الكود مرفوض أم لم يُقرأ`
  - الإصلاح: أظهر رسالة صغيرة «كود غير صالح» بلون var(--danger) عندما يُدخل كود ولا ينتج عنه خصم، وعلامة نجاح خضراء عند قبوله.
- **[LOW] هامش سفلي مضاعف بين بطاقات القائمة: marginBottom فوق gap الحاوية**  
  src/components/MenuView.jsx:321 · spacing
  - الدليل: `className="food-card" ... style={{ marginBottom: 'var(--sp-2)' }} داخل <div className="stack" style={{ gap: 'var(--sp-2)' }}> (السطر 414) فتصبح المسافة الفعلية ضعف الإيقاع المقصود`
  - الإصلاح: احذف marginBottom من البطاقة واعتمد على gap الحاوية وحده لتوحيد إيقاع المسافات.
- **[LOW] زر الإضافة في قالب coffeepan سهم اتجاهي يوحي بالتنقل بينما بقية القوالب تستخدم أيقونة +**  
  src/components/MenuView.jsx:383 · consistency
  - الدليل: `<span className="coffeepan-add-btn"><Icon name={lang === 'ar' ? 'back' : 'next'} size={14} /></span> — مقابل <Icon name="add"> في food-add (335) وcl-add (404) وstore-add (426)`
  - الإصلاح: وحّد الأيقونة إلى name="add" في coffeepan حتى تقرأ كإجراء إضافة للسلة لا كسهم انتقال.

## checkout-payments — 7/10

أسطح الدفع مبنية بعناية وظيفية جيدة: المبالغ مشتقة من الخادم، حالات النجاح/الفشل/الانتظار موجودة، والفاتورة تحاكي ورقة طباعة بيضاء مقصودة. لا توجد انتهاكات للقواعد الصارمة (لا إيموجي، أرقام لاتينية، لا شريط تمرير). المشاكل الحقيقية هي في «الدروز»: نموذج ميسر المضمّن بلا أي تخصيص فيظهر أبيض صارخ على الوضع الداكن، صفحة العودة بعد الدفع طريق مسدود يعيد الضيف لصفحة المنصة بدل طلبه، زر الطباعة داخل الفاتورة البيضاء يستخدم توكنات الوضع الداكن فيختفي، وأزرار الدفع تعرض «جارٍ الحفظ» أثناء الدفع.

- **[HIGH] صفحة نتيجة الدفع طريق مسدود: كل الحالات تعيد الضيف إلى '/' وتفقده سياق طلبه، وحالة الفشل بلا زر إعادة محاولة**  
  src/routes/PayReturn.jsx:49 · states
  - الدليل: `<Link to="/" className="btn btn-primary btn-block">{ar ? 'العودة للرئيسية' : 'Back home'}</Link> — الإجراء الوحيد في النجاح والفشل والانتظار، رغم أن النص في السطر 46 يعد الضيف: 'سنؤكّد دفعتك خلال لحظات؛ يمكنك متابعة طلبك' بلا أي رابط للمتابعة، وintent متاح لإعادة فتح /pay/checkout عند الفشل`
  - الإصلاح: عند الدفع لطلب اجعل الزر الأساسي 'متابعة طلبك' يوجه إلى صفحة تتبع الطلب (المسار محفوظ في payIntent/sessionStorage)، وفي حالة الفشل أضف زر 'حاول مرة أخرى' يعيد إلى /pay/checkout/:intentId.
- **[HIGH] نموذج ميسر المضمّن (.mysr-form) بلا أي تخصيص CSS فيعرض حقولاً وأزراراً بيضاء صارخة تتصادم مع الوضع الداكن وثيمات المطاعم**  
  src/routes/InlineCheckout.jsx:178 · hard-rule
  - الدليل: `<div className="mysr-form" style={{ display: state === 'ready' ? 'block' : 'none' }} /> — يُحمَّل SDK_CSS من CDN ميسر (السطر 17) ولا يوجد أي محدد .mysr-form في src/index.css أو أي ملف CSS بالمشروع (grep بلا نتائج)، فتظهر حقول البطاقة بخلفية بيضاء ونص داكن داخل بطاقة var(--surface) الداكنة — نفس شكوى`
  - الإصلاح: أضف طبقة تجاوز .mysr-form تربط حقول ميسر وأزراره بتوكنات النظام (var(--surface-2), var(--text), var(--border), var(--brand)) في الوضعين الفاتح والداكن.
- **[HIGH] زر 'طباعة / حفظ PDF' داخل الفاتورة البيضاء القسرية يستخدم توكنات .btn-outline العامة فيصبح نصاً فاتحاً على أبيض في الوضع الداكن**  
  src/routes/Invoice.jsx:109 · contrast
  - الدليل: `<button className="btn btn-outline btn-block no-print" ...> داخل .inv-doc المعرفة في السطر 116: .inv-doc{...;background:#fff;color:#16181d;...} — الحاوية تفرض #fff دائماً بينما .btn-outline يرث var(--text)/var(--border) التي تكون فاتحة في الثيم الداكن، فيختفي الزر على الورقة البيضاء`
  - الإصلاح: أعطِ الزر داخل الفاتورة ألواناً مكودة تناسب الورقة البيضاء (نص #16181d وحد #d9d9de) بمحدد .inv-doc .btn بدل التوكنات المتغيرة.
- **[MEDIUM] زرا الدفع 'ادفع الآن' و'ادفع أونلاين' يعرضان نص الانشغال t('saving') أي 'جارٍ الحفظ' أثناء عملية دفع مالية**  
  src/routes/menu/OrderStatus.jsx:253 · states
  - الدليل: `<button ... disabled={paying} onClick={payNow}><Icon name="wallet" size={16} /> {paying ? t('saving') : (lang === 'ar' ? 'ادفع الآن' : 'Pay now')}</button> — والنمط نفسه مكرر في السطر 262؛ فعل 'الحفظ' على زر أموال يضعف الثقة لحظة الحسم`
  - الإصلاح: استخدم نصاً خاصاً بالدفع أثناء الانشغال: 'جارٍ فتح الدفع…' بدلاً من t('saving') في الزرين (السطران 253 و262).
- **[MEDIUM] حالة 'قيد التأكيد' ساكنة تماماً: لا إعادة استعلام تلقائية ولا مؤشر تقدم، فيبقى الضيف عالقاً على 'Confirming…' إلى الأبد**  
  src/routes/PayReturn.jsx:25 · states
  - الدليل: `const r = await confirmPayment({ payIntentId: intent, paymentId }); if (alive) setState(r.settled ? 'paid' : 'pending') — استدعاء واحد فقط في useEffect، وحتى catch يثبت الحالة على 'pending' (السطر 26) بلا polling ولا زر 'تحديث'`
  - الإصلاح: أعد محاولة confirmPayment كل 3-5 ثوانٍ (مع حد أقصى) في حالة pending أو أضف زر 'تحقّق مجدداً' مع مؤشر دوران صغير.
- **[MEDIUM] متتبع مراحل الطلب دوائر منفصلة بلا خط واصل، فلا يُقرأ كمسار تقدم والخطوات غير المنجزة تكاد لا تتمايز**  
  src/routes/menu/OrderStatus.jsx:209 · hierarchy
  - الدليل: `<div className="center" style={{ width: 34, height: 34, borderRadius: '50%', background: done ? 'var(--brand)' : 'var(--surface-2)', ... border: '1px solid var(--border)' }}> — خمس دوائر flex:1 متجاورة بلا أي خط/مسار يربطها ولا تمييز خاص للخطوة الحالية عن المنجزة`
  - الإصلاح: أضف خطاً واصلاً بين الدوائر (يمتلئ بلون var(--brand) حتى الخطوة الحالية) وميّز الخطوة الحالية بحلقة أو نبضة عن الخطوات المكتملة.
- **[MEDIUM] أزرار نجوم التقييم هدف لمس نحو 22px فقط بفواصل 6px، أقل بكثير من 44px على شاشة هاتف الضيف**  
  src/routes/menu/OrderStatus.jsx:275 · touch
  - الدليل: `<button ...><Icon name="star" size={22} /></button> مع CSS في src/index.css:3583 — .stars { display:inline-flex; gap:6px } و.stars button بلا padding ولا min-width/min-height، فالهدف الفعلي بحجم الأيقونة 22px والنجوم المتجاورة تسبب لمسات خاطئة`
  - الإصلاح: أضف padding يجعل كل زر نجمة 44x44 على الأقل (.stars button{padding:10px;margin:-4px}) مع إبقاء الحجم البصري للأيقونة.
- **[MEDIUM] سهم 'next' في بطاقة تقييم خرائط جوجل يشير إلى اليمين (الخلف) في الواجهة العربية لعدم وجود أي انعكاس RTL للأيقونات**  
  src/routes/menu/OrderStatus.jsx:293 · rtl
  - الدليل: `<Icon name="next" size={16} className="faint" /> — في Icon.jsx:37 يُعرَّف next: ChevronRight بلا شرط اتجاه، وgrep على index.css لا يجد أي انعكاس svg لـ[dir=rtl] (فقط .ai-sidebar)، فالسهم يشير عكس اتجاه التنقل في RTL`
  - الإصلاح: اجعل مكون Icon يعكس أيقونات next/back تلقائياً في RTL (transform:scaleX(-1) عند dir=rtl) أو أضف قاعدة CSS عامة لذلك.
- **[MEDIUM] مبلغ الدفع الرئيسي يُنسّق يدوياً بنص 'ر.س' بينما بقية أسطح الأموال (تتبع الطلب والفاتورة) تستخدم مكون Price برمز الريال الرسمي**  
  src/routes/InlineCheckout.jsx:151 · consistency
  - الدليل: `{sar.toLocaleString('en-US', {...})} {ar ? 'ر.س' : 'SAR'} — بينما OrderStatus.jsx:232 يستخدم <Price value={order.total} .../> وInvoice.jsx:86 يستخدم <Price value={rec.total} .../> — نفس المبلغ يظهر برمزين مختلفين قبل الدفع وبعده`
  - الإصلاح: استخدم مكون Price نفسه لعرض مبلغ الدفع في InlineCheckout ليتطابق رمز العملة عبر رحلة الدفع كاملة.
- **[LOW] المبلغ في صفحة الدفع — أهم معلومة على الإطلاق — بحجم var(--fs-xl) فقط ولا يتصدر بصرياً كما يليق بسطح أموال**  
  src/routes/InlineCheckout.jsx:150 · hierarchy
  - الدليل: `<strong style={{ fontSize: 'var(--fs-xl)' }}>{sar.toLocaleString(...)} — نفس الحجم المستخدم لعنوان حالة الطلب العادي في OrderStatus.jsx:155، بينما اسم المتجر والوصف حوله xs/small فقط`
  - الإصلاح: كبّر المبلغ إلى حجم عرضي مميز (نحو clamp(28px,6vw,40px) بوزن 800) ليكون البؤرة الأولى في صفحة الدفع.
- **[LOW] علامة ~ الملاصقة لرقم الدقائق داخل جملة عربية قد تُعرض في الجهة الخاطئة من الرقم بسبب قواعد bidi**  
  src/routes/menu/OrderStatus.jsx:195 · rtl
  - الدليل: `{lang === 'ar' ? 'يصل خلال ~${etaMin} دقيقة' : ...} — الرمز المحايد ~ بين نص عربي ورقم لاتيني يُحل اتجاهه حسب السياق RTL وقد يظهر بعد الرقم بدل قبله`
  - الإصلاح: استبدل الرمز بكلمة عربية: 'يصل خلال نحو ${etaMin} دقيقة' لتفادي التباس bidi.

## admin-core — 7/10

أدوات المالك اليومية مبنية على نظام توكنات ناضج مع حالات فارغة وتحميل شبه كاملة، وقوالب عرض مرنة (exec/ops/min وkanban/grid/timeline) تخدم الاستخدام الفعلي. أبرز المشاكل: محرر الصنف نموذج مسطح ضخم بلا تجميع يدفن الحقول الأساسية بين خيارات تجميلية، وصفحة الطلبات تحوي خطأ CSS فعلياً (insetStart غير موجودة) يكسر تموضع أيقونة البحث، مع ألوان مكتوبة يدوياً (#e0a82e، #C9A24B) تكسر الثيمات. توجد خروقات صريحة لقاعدة الأيقونات (رمز ✕ النصي وحقل «إيموجي» للمكوّنات) وأهداف لمس دون 44 بكسل في مبدّل القوالب ومقبض سحب الفئات.

- **[CRITICAL] رمز نصي "✕" مستخدم كأيقونة حذف بدل Icon.jsx**  
  src/routes/admin/Items.jsx:746 · hard-rule
  - الدليل: `<button className="icon-btn" onClick={() => delVariant(i)}>✕</button> (سطر 746) و <button className="icon-btn" onClick={() => delOpt(gi, oi)}>✕</button> (سطر 819) — بينما نفس الوظيفة في سطر 767 تستخدم <Icon name="close" size={16} />`
  - الإصلاح: استبدال الرمز النصي ✕ في السطرين 746 و819 بـ <Icon name="close" size={16} /> كما هو معمول في سطر 767.
- **[HIGH] حقل المكوّنات يطلب من المالك إدخال إيموجي صراحةً رغم قاعدة منع الإيموجي**  
  src/routes/admin/Items.jsx:760 · hard-rule
  - الدليل: `<label>{t('ingredients')} <span className="faint xs">({lang === 'ar' ? 'إيموجي + اسم' : 'emoji + name'})</span></label> وحقل الإدخال value={x.emoji} placeholder='رمز' (سطر 765) — القيمة تُعرض لاحقاً في منيو الزبون`
  - الإصلاح: تحويل حقل emoji إلى منتقي أيقونات من Icon.jsx (قائمة أسماء أيقونات) وتغيير النص التوضيحي من «إيموجي» إلى «أيقونة».
- **[HIGH] خاصية CSS غير موجودة insetStart/insetEnd — أيقونة البحث وزر المسح لا يتموضعان**  
  src/routes/admin/Orders.jsx:229 · rtl
  - الدليل: `<Icon name="search" ... style={{ position: 'absolute', top: 12, insetStart: 12, opacity: 0.5 }} /> (سطر 229) و style={{ position: 'absolute', top: 8, insetEnd: 8, ... }} (سطر 233) — الخاصية الصحيحة هي insetInlineStart/insetInlineEnd (مستخدمة صحيحاً في Items.jsx:484)، فالمتصفح يتجاهلها ويبقى الحقل بح`
  - الإصلاح: استبدال insetStart بـ insetInlineStart و insetEnd بـ insetInlineEnd في السطرين 229 و233.
- **[HIGH] محرر الصنف نموذج مسطح ضخم (~330 سطراً) بلا أي تجميع أو أقسام**  
  src/routes/admin/Items.jsx:443 · hierarchy
  - الدليل: `من <div className="stack"> (سطر 443) حتى سطر 774: صورة، صور إضافية، أسلوب الصورة، حجم الصورة، تنسيق الاسم والسعر، خلفية فيديو، السعر، السعرات، التقييم، التصنيف، الاقترانات، الوصف، تحذير المطبخ، 4 checkboxes، الأحجام، الوصفة، المكوّنات، الإضافات — كلها في عمود واحد متساوي الوزن؛ حقول أساسية كالسعر (س`
  - الإصلاح: تقسيم المحرر إلى أقسام قابلة للطي أو تبويبات (أساسي / الصور والمظهر / الأحجام والإضافات / المخزون) مع إبقاء الاسم والسعر والتصنيف في أعلى القسم الأول.
- **[MEDIUM] لون كهرماني مكتوب يدوياً #e0a82e بدل توكن النظام**  
  src/routes/admin/Orders.jsx:207 · contrast
  - الدليل: `<strong style={{ fontSize: 20, color: '#e0a82e' }}>{stats.activeCount} ...</strong> — بينما باقي النظام يستخدم var(--warning) / var(--gold)؛ اللون الثابت لا يتكيف مع الثيمات (noir/neon/glass) ولا الوضع الداكن`
  - الإصلاح: استبدال '#e0a82e' بـ 'var(--warning)' في سطر 207.
- **[MEDIUM] توكن غير معرّف var(--accent) مع hex ثابت كاحتياط لنجمة المميّز**  
  src/routes/admin/Items.jsx:132 · consistency
  - الدليل: `style={{ color: it.featured ? 'var(--accent, #C9A24B)' : 'var(--text-muted)' }} (سطر 132 ومكرر في 158) — لا يوجد توكن --accent في index.css، فيُعرض دائماً اللون الثابت #C9A24B؛ نفس المفهوم في Dashboard.jsx:16 و Items.jsx:727 يستخدم var(--gold)`
  - الإصلاح: استبدال 'var(--accent, #C9A24B)' بـ 'var(--gold)' في السطرين 132 و158.
- **[MEDIUM] بطاقات إحصاءات الطلبات مبنية يدوياً بأحجام خط خام بدل نظام .stat-grid المعتمد في اللوحة**  
  src/routes/admin/Orders.jsx:197 · consistency
  - الدليل: `<div className="card grow card-pad stack" style={{ gap: 4, minWidth: 140, background: 'linear-gradient(...)' }}> مع <strong style={{ fontSize: 20 }}> (سطور 197-212) — بينما Dashboard.jsx:113-130 يعرض نفس المؤشرات (مبيعات اليوم/الطلبات/متوسط الفاتورة) عبر .stat-grid/.stat/.value؛ نفس المفهوم بمظهرين `
  - الإصلاح: إعادة استخدام مكوّن/أصناف .stat-grid و .stat نفسها في صف إحصاءات صفحة الطلبات بدل البطاقات المخصصة.
- **[MEDIUM] أزرار مبدّل القوالب 34×34 بكسل — أقل من الحد الأدنى 44 بكسل للمس**  
  src/index.css:2470 · touch
  - الدليل: `.pos-tpl-switch .icon-btn { width: 34px; height: 34px; ... } — مستخدمة في Dashboard.jsx:89 و Items.jsx:172 و Orders.jsx:164 وهي أزرار متجاورة بفاصل gap: 2 فقط`
  - الإصلاح: رفع أبعاد .pos-tpl-switch .icon-btn إلى 44×44 (var(--tap)) أو زيادة الفاصل بينها مع منطقة لمس ممتدة.
- **[MEDIUM] مقبض سحب الفئات span عارٍ بأيقونة 18 بكسل — هدف لمس صغير جداً للسحب**  
  src/routes/admin/Categories.jsx:21 · touch
  - الدليل: `<span {...listeners} {...attributes} ... style={{ cursor: 'grab', touchAction: 'none', display: 'inline-flex' }}><Icon name="drag" size={18} className="faint" /></span> — بينما مقبض السحب في Items.jsx:216 يستخدم .icon-btn بأبعاد var(--tap) الكاملة`
  - الإصلاح: تغليف مقبض السحب في CatRow بصنف icon-btn (44×44) كما في Items.jsx ليسهل الإمساك به على التابلت.
- **[MEDIUM] زر حفظ الفئة بلا حالة انشغال — النقر المزدوج ينشئ فئة مكررة**  
  src/routes/admin/Categories.jsx:121 · states
  - الدليل: `<button className="btn btn-primary grow" onClick={save}>{t('save')}</button> — دالة save (سطر 70) غير محمية بـ busy/disabled، بعكس محرر الصنف الذي يستخدم disabled={busy || uploading} (Items.jsx:439)؛ نقرتان سريعتان على «حفظ» لفئة جديدة تستدعيان saveCategory مرتين`
  - الإصلاح: إضافة حالة busy تعطّل زري الحفظ والحذف أثناء العملية وتعرض نص «جارٍ الحفظ» كما في محرر الصنف.
- **[MEDIUM] سهم نصي خام "›" لا ينعكس في RTL ويتجاوز نظام الأيقونات**  
  src/routes/admin/Categories.jsx:25 · rtl
  - الدليل: `<span className="faint">›</span> في صف الفئة — الحرف النصي › يشير دائماً لليمين حتى في الواجهة العربية حيث يجب أن يشير اتجاه التقدم لليسار؛ نفس النمط في AdminLayout.jsx:339 يستخدم <Icon name="next" size={18} className="faint" />`
  - الإصلاح: استبدال الحرف › بـ <Icon name="next" size={16} className="faint" /> ليتوافق مع بقية الصفوف وينعكس مع الاتجاه.
- **[MEDIUM] كانبان بخمسة أعمدة (230px لكل عمود) يتمدد أفقياً بلا أي مؤشر تمرير على التابلت**  
  src/routes/admin/Orders.jsx:295 · responsive
  - الدليل: `قالب kanban يعرض 5 أعمدة (pending/accepted/preparing/ready/done) عبر .ord-lanes { grid-auto-flow: column; grid-auto-columns: minmax(230px, 1fr); overflow-x: auto; } (index.css:2699) — بعرض إجمالي أدنى ~1200px، ومع إخفاء كل أشرطة التمرير عالمياً (index.css:1252-1256) لا يوجد أي دليل بصري أن عمودَي «ج`
  - الإصلاح: على العروض الأضيق من ~1100px اجعل الأعمدة تلتف لصفّين (grid-template-columns بدل auto-flow column) أو أضف تدرّج حافة/نقاط تشير لوجود أعمدة إضافية.
- **[LOW] نقطة نصية "●" داخل شارة «تحديث لحظي» بدل عنصر مصمم**  
  src/routes/admin/Orders.jsx:160 · consistency
  - الدليل: `<span className="badge badge-success" style={{ fontSize: 11 }}>● {ar ? 'تحديث لحظي نشط' : 'Live updates active'}</span> — رمز نصي كأيقونة خلافاً لقاعدة الأيقونات عبر Icon.jsx، كما أن الشارة ثابتة لا تعكس حالة الاتصال الفعلية`
  - الإصلاح: استبدال ● بنقطة CSS صغيرة (span مستدير بخلفية currentColor) مع نبضة حركية خفيفة.
- **[LOW] ملخص الأصناف يُفصل بفاصلة عربية حتى في الواجهة الإنجليزية**  
  src/routes/admin/Orders.jsx:111 · consistency
  - الدليل: `const itemsSummary = (o) => (o.items || []).map(...).join('، ') — الفاصلة العربية «،» تُستخدم دائماً حتى عندما lang === 'en' وتُعرض أسماء إنجليزية`
  - الإصلاح: استخدام join(ar ? '، ' : ', ') حسب اللغة الحالية.
- **[LOW] زر «المزيد» في الشريط السفلي مصمم inline بمعزل عن أنماط .bottom-nav a**  
  src/components/AdminLayout.jsx:315 · consistency
  - الدليل: `<button onClick={() => setMoreOpen(true)} style={{ flex: 1, display: 'flex', ..., fontSize: 10, color: 'var(--text-faint)' }}> — روابط الشريط تأخذ أنماطها من .bottom-nav a (index.css:500) بما فيها min-height: var(--tap) وحالة hover وأنماط ثيم glass، بينما الزر ينسخها يدوياً وسيتخلف عن أي تحديث ثيم م`
  - الإصلاح: إضافة صنف CSS مشترك (مثل .bottom-nav a, .bottom-nav .nav-btn) يطبَّق على الزر بدل الأنماط المضمنة.

## admin-settings — 6/10

Settings.jsx is a 2,721-line monolith that has clearly been through a redesign pass: the 4-tab + sub-tab IA is sane, the live preview panel follows the active sub-tab, and there is an unsaved-changes banner. But the page carries two independent, simultaneously-active undo/redo systems that both intercept Ctrl+Z, a confusing mix of instant-save and draft-save controls inside the same cards, hard-rule glyph violations (raw checkmark/cross/arrow characters instead of Icon.jsx), a fake "OAuth connected" alert(), and unguarded destructive actions on 20px targets. The satellite cards (SubscriptionCard, CustomDomainCard, TemplateGallery) are comparatively clean and token-driven.

- **[CRITICAL] نظاما تراجع/إعادة متعارضان يعملان معاً ويعترضان Ctrl+Z مرتين**  
  src/routes/admin/Settings.jsx:535 · states
  - الدليل: `Handler 1 (line 302-316): window.addEventListener('keydown', onKey) → applyHistRef.current('undo') on Ctrl+Z. Handler 2 (line 535-550): window.addEventListener('keydown', handleKeyDown) → undo() on Ctrl+Z. Both call e.preventDefault() and both fire on the same keypress; histRef writes to Firestore v`
  - الإصلاح: احذف أحد النظامين بالكامل (يفضل الإبقاء على نظام histRef المبني على لقطات المستأجر) وأزرار التراجع المكررة معه، بحيث يبقى مصدر واحد للتاريخ ومعالج واحد لاختصار Ctrl+Z.
- **[HIGH] رموز نصية (✓ ✕ ▴ ▾ ↗) مستخدمة كأيقونات بدل Icon.jsx**  
  src/routes/admin/Settings.jsx:1800 · hard-rule
  - الدليل: `Line 1800: {on ? '✓ ' : '✕ '} inside show/hide chips; line 976: <span className="badge badge-success">✓</span>; line 1603: delete button content is the character ✕; line 1587: 'طي قائمة الثيمات ▴' / '▾'; line 819: 'فتح المنيو العام ↗'; line 1899: '✓ فيديو مرفوع'; lines 2703-2704: '✓ 'order.paid''. T`
  - الإصلاح: استبدل كل هذه المحارف بمكوّن <Icon name="check"/> و<Icon name="close"/> و<Icon name="chevronDown"/> وأيقونة رابط خارجي من Icon.jsx.
- **[HIGH] زر «اتصال نشط» يعرض alert() نجاح وهمي دون أي اتصال فعلي**  
  src/routes/admin/Settings.jsx:2632 · states
  - الدليل: `onClick={() => alert(ar ? 'تم ربط الحساب بنجاح عبر OAuth 2.0!' : 'Account connected successfully via OAuth 2.0!')} — no async call, no OAuth flow, and it uses the raw browser alert instead of the app's toast system; the accountingSystem select saves a value but nothing is ever connected.`
  - الإصلاح: أزل رسالة النجاح الكاذبة واستبدلها إما بتدفق ربط حقيقي أو بشارة «قريباً» صادقة عبر نظام الـ toast/badge الموحّد.
- **[HIGH] خلط نموذجي حفظ متناقضين داخل تبويب «الثيم» نفسه دون أي تمييز بصري**  
  src/routes/admin/Settings.jsx:1546 · consistency
  - الدليل: `System-theme swatches save instantly (line 1113: await saveNow({ systemTheme: th.id }) + toast) while the skin gallery two cards below only sets local state (line 1558: setSkinId(s.id); setColor(...)) and requires the big Save at line 2244. Same pattern in General: social inputs save onBlur (line 89`
  - الإصلاح: وسم كل بطاقة بنمط حفظها (شارة «يُحفظ فوراً» مقابل «مسودة — يتطلب حفظ») أو توحيد الاستوديو كله على نموذج المسودة مع زر حفظ واحد.
- **[HIGH] زر الحفظ وتحذير التغييرات غير المحفوظة مدفونان أسفل عمود ضوابط طويل جداً**  
  src/routes/admin/Settings.jsx:2244 · hierarchy
  - الدليل: `The designDirty warning (line 2238) and the single <button className="btn btn-primary btn-block btn-lg" onClick={save}> (line 2244) render only at the very end of the appearance-controls column that contains ~10 stacked cards per sub-tab; a user editing colors at the top never sees that the live men`
  - الإصلاح: اجعل شريط «تغييرات غير محفوظة + حفظ» شريطاً لاصقاً (position: sticky, bottom) يظهر فور اتساخ المسودة في أي موضع تمرير.
- **[HIGH] حذف الثيمات المحفوظة فوري بلا تأكيد وعلى هدف لمس 20 بكسل**  
  src/routes/admin/Settings.jsx:1603 · touch
  - الدليل: `Line 1603: <button className="icon-btn" style={{ position:'absolute', top:-4, insetInlineEnd:-4, width:20, height:20 ... }} onClick={() => removeCustomTheme(ct.id)}>✕</button> — deletes a saved theme snapshot instantly; line 2150-2153 'حذف المخصص' also deletes the custom system theme with no confirm`
  - الإصلاح: أضف تأكيداً موحّداً (نافذة تأكيد أو تراجع عبر toast) لكل أفعال الحذف وكبّر هدف اللمس إلى 44 بكسل على الأقل.
- **[MEDIUM] لقطة التراجع تُسقط حقل ovSpotSize فيمسح التراجع إعداد حجم صورة السبوتلايت**  
  src/routes/admin/Settings.jsx:436 · states
  - الدليل: `getSnapshot() (line 435-440) lists ovDetailLayout, ovItemImageStyle, ovHidden but omits ovSpotSize, and it is missing from the watcher deps (line 456); yet applySnapshot calls setOvSpotSize(snap.ovSpotSize) (line 482) — every undo sets spotlight image size to undefined, silently resetting the user's`
  - الإصلاح: أضف ovSpotSize إلى getSnapshot وقائمة التبعيات (أو احذف النظام المكرر كاملاً كما في الملاحظة الأولى).
- **[MEDIUM] المعاينة الحية غير مرئية أثناء التعديل على التابلت والجوال (أقل من 1000 بكسل)**  
  src/index.css:2255 · responsive
  - الدليل: `.appearance-grid { grid-template-columns: 1fr } stacks the preview ABOVE the controls, and sticky positioning applies only inside @media (min-width: 1000px); on a portrait tablet the user drags glass/opacity sliders (Settings.jsx line 1220) with the MenuPreview scrolled fully off-screen, defeating t`
  - الإصلاح: دون 1000 بكسل اجعل المعاينة شريطاً لاصقاً مصغّراً أعلى الشاشة أو زر معاينة عائماً يفتحها كطبقة فوقية.
- **[MEDIUM] بطاقتا «الاشتراك والفواتير» و«النطاق المخصص» مدفونتان تحت تبويب فرعي باسم «الربط الفني»**  
  src/routes/admin/Settings.jsx:2573 · hierarchy
  - الدليل: `<SubscriptionCard .../> and <CustomDomainCard .../> (lines 2573-2574) render only inside intSubTab === 'gateways' under the tab labeled 'التكاملات والسياسات' → 'الربط الفني والتكاملات'; a venue owner looking for due invoices or plan expiry has no scent trail — billing is neither a tab nor mentioned `
  - الإصلاح: انقل بطاقة الاشتراك والفواتير إلى موضع بارز (تبويب «الاشتراك» مستقل أو أعلى تبويب الإعدادات العامة) بدل دفنها خلف تسمية تقنية.
- **[MEDIUM] تبويب «الثيم» الفرعي وحده يكدّس سبع بطاقات ضخمة غير مترابطة**  
  src/routes/admin/Settings.jsx:1098 · spacing
  - الدليل: `The aSec === 'theme' block (lines 1098-1614) stacks: system theme + custom theme editor + glass sliders + theme schedule + menu glass + per-section mix, THEN button designer, system background, system templates (TemplateGallery loop line 1535), the 8+ skin gallery, and custom snapshots — mixing back`
  - الإصلاح: افصل ضوابط ثيم النظام الإداري عن سكنات منيو الزبائن في تبويبين فرعيين مستقلين لموازنة كثافة الأقسام.
- **[MEDIUM] أزرار أيقونية إدارية بأحجام 24-30 بكسل تحت حد اللمس**  
  src/routes/admin/Settings.jsx:984 · touch
  - الدليل: `Line 984: clear-PIN icon-btn style={{ width: 30, height: 30, color: 'var(--danger)' }}; line 1838: typography reset icon-btn width: 24, height: 24 — both are the only way to perform their action and sit beside other inputs, well under the 44px minimum on the phones/tablets managers actually use.`
  - الإصلاح: ارفع أبعاد كل icon-btn التفاعلية إلى 44×44 بكسل (مساحة نقر padding حتى لو بقيت الأيقونة صغيرة بصرياً).
- **[LOW] نص «أبجد» أبيض مثبت فوق تدرج لون البراند قد يفقد التباين مع الألوان الفاتحة**  
  src/routes/admin/Settings.jsx:1576 · contrast
  - الدليل: `<span style={{ color: '#fff', fontWeight: 800, fontSize: 11 ... }}> over background: 'linear-gradient(135deg, ${s.tokens.brand}, ${s.tokens.accent})' (line 1575) — skins with light brand tokens (e.g. gold #D8A24A in GRADIENT_PRESETS) render near-invisible white-on-light text.`
  - الإصلاح: احسب لون النص ديناميكياً حسب سطوع لون البراند (أبيض/داكن) أو أضف طبقة تعتيم خفيفة خلف الحرف.
- **[LOW] علامات backtick حرفية وأيقونتان مكررتان في ترويسة الضريبة**  
  src/routes/admin/Settings.jsx:2703 · consistency
  - الدليل: `Line 2703: <span className="xs">✓ 'order.paid'</span> renders literal backticks in the UI (JSX does not parse markdown); line 2508: <strong><Icon name="reports" .../> ...</strong> sits directly after <Icon name="cashier" .../> giving the VAT card two leading icons unlike every other card header.`
  - الإصلاح: أزل علامات backtick واستخدم عنصر <code> منسّقاً، وأبقِ أيقونة واحدة في ترويسة بطاقة الضريبة.

## auth-landing — 7/10

سطح الهبوط والدخول مبني بعناية واضحة: نظام توكنات ثنائي الثيم مخصص للتسويق (landing.css) مع خصائص منطقية RTL، محاكاة منتج حقيقية بدل صور، وتسلسل إقناع جيد (مشكلة، عرض، مزايا، تسعير، أسئلة). لا انتهاكات للقواعد الصارمة (لا إيموجي، لا أرقام هندية، شريط التمرير مخفي عالمياً). أبرز الثغرات تحويلية وعملية: قائمة الجوال تختفي عند فتحها بعد التمرير، الهيدر يفيض على 360px، نموذج «جرّب الآن» يرمي بيانات المستخدم، لا مسار لاستعادة كلمة المرور، وبطاقة المشاركة الاجتماعية مكسورة (og:image بصيغة SVG). كما تتسرب ألوان مثبّتة للثيم الداكن (ظل أسود 55% وشارة خضراء فاتحة) إلى المقاطع الفاتحة.

- **[HIGH] قائمة الجوال المنسدلة تختفي عند فتحها بعد التمرير لأنها ليست مثبتة مع الهيدر**  
  src/landing.css:125 · responsive
  - الدليل: `.rl-mobnav { display: none; flex-direction: column; ... } — بلا position، بينما .rl-nav { position: sticky; top: 0 } (landing.css:112). القائمة عنصر شقيق في التدفق الطبيعي بعد الهيدر (Landing.jsx:129)، فعند فتح البرجر بعد التمرير لأسفل تُرسم القائمة في أعلى المستند خارج الشاشة ولا يظهر شيء للمستخدم.`
  - الإصلاح: اجعل .rl-mobnav ضمن الهيدر أو أعطها position: fixed/sticky أسفل شريط التنقل مع z-index مناسب.
- **[HIGH] هيدر الهبوط يفيض ويُقتطع على شاشات 360px لأن أزرار الدخول والبدء لا تُخفى**  
  src/landing.css:258 · responsive
  - الدليل: `@media (max-width: 720px) يخفي .rl-nav .links فقط؛ يبقى في .act: زرا الثيم واللغة (38px لكل)، رابط الدخول، زر «ابدأ مجاناً»، والبرجر (Landing.jsx:121-126) بجانب BrandMark — مجموع يتجاوز 360px، و.rl { overflow-x: clip } (landing.css:57) يقتطع آخر العناصر (البرجر) بدل تمريرها.`
  - الإصلاح: على الشاشات الصغيرة أخفِ رابط الدخول وزر الثيم من الهيدر وانقلهما إلى القائمة المنسدلة، مع إبقاء زر CTA واحد والبرجر.
- **[HIGH] نموذج «جرّب الآن» يتجاهل اسم المنشأة والجوال المُدخلين ويرمي المستخدم لصفحة التسجيل فارغة**  
  src/routes/Landing.jsx:330 · states
  - الدليل: `onSubmit={(e) => { e.preventDefault(); navigate('/signup') }} — قيمتا bizName وbizPhone (states بالأسطر 21-22) لا تُمرَّران إطلاقاً، فيُعيد المستخدم إدخال بياناته من جديد بلا أي إشعار.`
  - الإصلاح: مرّر القيم إلى /signup عبر state أو query params واملأ بها حقول التسجيل مسبقاً، أو احذف الحقلين واجعلها زر CTA صريحاً.
- **[HIGH] لا يوجد رابط «نسيت كلمة المرور» في صفحة الدخول — طريق مسدود عند نسيان كلمة المرور**  
  src/routes/Login.jsx:49 · states
  - الدليل: `نموذج الدخول يحتوي بريداً وكلمة مرور وزر إرسال فقط، وfoot يعرض رابط التسجيل فقط (Login.jsx:40)؛ لا وجود لأي sendPasswordResetEmail في src/lib/auth.jsx أو مسار استعادة في التطبيق كله.`
  - الإصلاح: أضف رابط «نسيت كلمة المرور؟» تحت حقل كلمة المرور يستدعي sendPasswordResetEmail مع رسالة نجاح واضحة.
- **[HIGH] بطاقة المشاركة الاجتماعية مكسورة: og:image يشير إلى SVG وبمسار نسبي**  
  index.html:23 · consistency
  - الدليل: `<meta property="og:image" content="/favicon.svg" /> مع <meta name="twitter:card" content="summary_large_image" /> — زواحف واتساب/تويتر/فيسبوك لا تعرض SVG وتتطلب رابط صورة مطلقاً، فتظهر مشاركات الموقع بلا صورة نهائياً.`
  - الإصلاح: أنشئ صورة OG بصيغة PNG بأبعاد 1200x630 وضع رابطها المطلق (https://rbt360.sa/og.png) في og:image وtwitter:image.
- **[MEDIUM] أسهم مخطط «تدفّق واحد» تشير للأعلى بدل الأسفل في العربية على الجوال**  
  src/index.css:3222 · rtl
  - الدليل: `@media (max-width: 819px) { .r-link svg { transform: rotate(90deg); } } بينما Landing.jsx:400 يستخدم Icon name={ar ? 'back' : 'next'} وback = ChevronLeft بلا انعكاس RTL (Icon.jsx:36) — تدوير سهم يسار 90 درجة ينتجه سهماً للأعلى بين خطوات مكدّسة عمودياً.`
  - الإصلاح: على الجوال استخدم أيقونة سهم لأسفل موحّدة (rotate(-90deg) للـ back أو أيقونة chevron-down) بدل تدوير سهم يعتمد اتجاهه على اللغة.
- **[MEDIUM] تعطيل تكبير القرص (pinch-zoom) على صفحة تسويقية عامة يخالف إمكانية الوصول**  
  index.html:7 · a11y
  - الدليل: `<meta name="viewport" content="... maximum-scale=1.0, user-scalable=no ..." /> يسري على الهبوط والتسجيل أيضاً وليس على شاشات الطاقم فقط — زوار ضعاف البصر لا يستطيعون تكبير نصوص الأسعار والمزايا (WCAG 1.4.4).`
  - الإصلاح: اسمح بالتكبير على المسارات التسويقية (landing/login/signup) بتعديل الـ viewport ديناميكياً أو بإزالة user-scalable=no عموماً.
- **[MEDIUM] شارة «متوفر» في محاكاة المخزون بألوان خضراء مثبّتة لا تُقرأ في الثيم الفاتح**  
  src/index.css:3324 · contrast
  - الدليل: `.iv-badge.ok { background: rgba(96, 186, 132, .16); color: #74c793; } — لون نص أخضر فاتح مثبّت (تباين نحو 1.9:1 على خلفية --bg-2 الفاتحة) بينما بقية المحاكاة تعتمد توكنات تنقلب مع الثيم؛ في وضع الهبوط الفاتح تكاد الشارة تختفي.`
  - الإصلاح: استخدم توكن نجاح متكيّفاً مع الثيم (مثل var(--ok) أو color-mix مع var(--text)) بدل #74c793 المثبّت.
- **[MEDIUM] ظل نوافذ المحاكاة أسود ثقيل مثبّت (55%) يبدو متسخاً على أقسام الهبوط الفاتحة**  
  src/index.css:3244 · contrast
  - الدليل: `.r-win { ... box-shadow: 0 24px 70px rgba(0, 0, 0, .55); } — الظل مضبوط للثيم الداكن ويُستخدم كما هو داخل .rl-show-media على خلفيات --panel الفاتحة (لا يُصفَّر إلا في إطار الهيرو .rl-frame بـ landing.css:158).`
  - الإصلاح: اربط الظل بتوكن متغيّر مع الثيم (مثل var(--hero-shadow) المعرّف أصلاً في landing.css) بدل rgba(0,0,0,.55) المثبّت.
- **[MEDIUM] بطاقات قسم «الباقات» بلا أي سعر أو وسم «مجاني» على البطاقة نفسها**  
  src/routes/Landing.jsx:86 · hierarchy
  - الدليل: `مصفوفة plans تحوي name/tag/items فقط، والبطاقة تعرض tag ثم h3 ثم قائمة مزايا ثم زر (الأسطر 288-294) — قسم عنوانه Pricing لا يجيب عن سؤال السعر؛ عبارة «مجاناً خلال الإطلاق» موجودة في الفقرة التمهيدية فقط ولا يراها من يمسح البطاقات مباشرة.`
  - الإصلاح: أضف سطر سعر بارز داخل كل بطاقة (ولو «مجاناً خلال الإطلاق» مع السعر المستقبلي مشطوباً) ليكون هو العنصر المهيمن بصرياً.
- **[MEDIUM] زر إغلاق شريط الإعلان ونقاط مبدّل الثيمات أهداف لمس أصغر من 44px**  
  src/landing.css:106 · touch
  - الدليل: `.rl-annc .x { ... padding: 4px; } مع أيقونة 15px يعطي هدفاً نحو 23px؛ و.tsw-dot { width: 23px; height: 23px; } مع gap: 9px (index.css:3374) — ثماني نقاط متلاصقة دون الحد الأدنى للمس على الجوال.`
  - الإصلاح: كبّر منطقة النقر إلى 44px على الأقل (padding أو ::after شفاف موسّع) لزر الإغلاق ولنقاط الثيمات.
- **[LOW] شرط كلمة المرور (6 أحرف كحد أدنى) غير معلَن في واجهة التسجيل**  
  src/routes/Signup.jsx:53 · states
  - الدليل: `<PasswordInput ... minLength={6} /> بلا أي نص مساعد تحت الحقل — المستخدم لا يكتشف الشرط إلا من فقاعة تحقق المتصفح الافتراضية بعد محاولة الإرسال.`
  - الإصلاح: أضف سطراً مساعداً صغيراً تحت حقل كلمة المرور يوضح الحد الأدنى قبل محاولة الإرسال.
- **[LOW] عنوان الصفحة <title> مجرد «rbt360» بلا وصف — انطباع أول ضعيف في التبويب ونتائج البحث**  
  index.html:55 · consistency
  - الدليل: `<title>rbt360</title> بينما og:title المجاور يحمل الصيغة الكاملة «rbt360 — نظام تشغيل مقهاك ومطعمك».`
  - الإصلاح: وحّد العنوان الافتراضي ليطابق og:title مع تحديثه ديناميكياً حسب الصفحة.
- **[LOW] زر قائمة الجوال يستخدم أيقونة «المزيد» (ثلاث نقاط) بدل أيقونة قائمة**  
  src/routes/Landing.jsx:126 · consistency
  - الدليل: `<button className="rl-icon-btn rl-burger" ...><Icon name={menuOpen ? 'close' : 'more'} /></button> — more = MoreHorizontal (Icon.jsx:22)، رمز غير متعارف عليه لفتح قائمة تنقل.`
  - الإصلاح: أضف أيقونة Menu (همبرغر) إلى Icon.jsx واستخدمها لزر القائمة.

## platform-console — 6.5/10

The platform console is functionally rich and mostly token-driven with good empty states, but danger actions are unevenly guarded: deleting invoices has no confirmation at all, and plan/subscription changes in the Chat side panel apply instantly on select-change. Suspension flows are duplicated in three places with three different UX patterns (prompt with reason, confirm with canned reason, prompt again), and several async writes lack busy/disabled states or error handling. There are a few hard-rule adjacent issues (physical paddingRight in RTL, hardcoded red/#fff colors) and small-type readability problems in the dense Chat admin panel.

- **[HIGH] حذف فاتورة مالية بنقرة واحدة دون أي تأكيد**  
  src/routes/platform/Billing.jsx:115 · states
  - الدليل: `const remove = async (inv) => { try { await deleteInvoice(inv.id); ... } — no window.confirm; the delete button (line 162) is icon-only with danger color`
  - الإصلاح: أضف حوار تأكيد قبل deleteInvoice كما هو معمول به في حذف النطاقات (Domains.jsx:111)، مع ذكر اسم المنشأة والمبلغ في نص التأكيد.
- **[HIGH] تغيير باقة الاشتراك يُنفَّذ فوراً عند تغيير القائمة المنسدلة دون تأكيد**  
  src/routes/platform/Chat.jsx:272 · states
  - الدليل: `updatePlan called directly from <select onChange={(e) => updatePlan(e.target.value)}> (line 530) — a mis-click instantly changes a paying venue's plan; same for updatePlanStatus (line 538)`
  - الإصلاح: أضف تأكيداً قبل الحفظ أو زر «حفظ» منفصلاً كما في VenueDetail بدلاً من التنفيذ الفوري عند onChange.
- **[HIGH] إيقاف المنشأة عبر window.prompt دون معالجة أخطاء أو حالة انشغال**  
  src/routes/platform/Venues.jsx:29 · states
  - الدليل: `const toggleActive = async (t) => { ... await setTenantActive(t.id, true); toast.success(...) } — no try/catch; a Firestore failure throws unhandled and the admin sees nothing; button has no disabled/busy state`
  - الإصلاح: غلّف setTenantActive بـ try/catch مع toast.error وعطّل الزر أثناء التنفيذ، واستبدل prompt بحوار تأكيد موحّد.
- **[HIGH] خاصية فيزيائية paddingRight في واجهة RTL**  
  src/routes/platform/Chat.jsx:546 · rtl
  - الدليل: `style={{ ..., overflowY: 'auto', paddingRight: 4 }} — in RTL this pads the start edge instead of the scroll edge`
  - الإصلاح: استبدل paddingRight بـ paddingInlineStart أو paddingInlineEnd حسب الجهة المقصودة.
- **[MEDIUM] ثلاثة أنماط مختلفة لنفس إجراء الإيقاف عبر الشاشات**  
  src/routes/platform/Chat.jsx:259 · consistency
  - الدليل: `Chat.jsx uses confirm + canned reason 'تجميد إداري من المنصة'; Venues.jsx:34 and VenueDetail.jsx:115 use window.prompt asking for a reason shown to the venue — the Chat path silently skips the custom reason`
  - الإصلاح: وحّد تدفق الإيقاف في مكوّن واحد يطلب السبب دائماً ويستخدم نفس الصياغة والألوان في الشاشات الثلاث.
- **[MEDIUM] لون red مكتوب حرفياً بدل رمز التصميم في شريط التسجيل الصوتي**  
  src/routes/platform/Chat.jsx:444 · contrast
  - الدليل: `<span className="pulse-red" style={{ ..., background: 'red' }} /> and <span ... style={{ color: 'red' }}> (line 445) — ignores var(--danger) and may clash with themes/dark mode`
  - الإصلاح: استخدم var(--danger) بدلاً من 'red' في الخلفية والنص.
- **[MEDIUM] لون #fff مكتوب حرفياً في شارة الرسائل غير المقروءة**  
  src/routes/platform/PlatformLayout.jsx:65 · contrast
  - الدليل: `background: 'var(--danger)', color: '#fff' — hardcoded white instead of a token like var(--on-danger)/var(--on-brand)`
  - الإصلاح: استبدل '#fff' برمز تصميم مثل var(--on-danger) ليتوافق مع كل الثيمات.
- **[MEDIUM] نص بحجم 10px فوق فئة xs faint في لوحة الإجراءات**  
  src/routes/platform/Chat.jsx:501 · contrast
  - الدليل: `<div className="faint xs" style={{ fontSize: 10, color: 'var(--text-muted)' }}>معرّف المنشأة</div> — doubly-shrunk faint labels (also line 503) below readable size on tablets`
  - الإصلاح: احذف fontSize:10 المضمّن واكتفِ بفئة xs مع الرمز اللوني القياسي.
- **[MEDIUM] أزرار إجراءات الصف (عرض/دردشة/إيقاف) أصغر من 44px**  
  src/routes/platform/Venues.jsx:94 · touch
  - الدليل: `style={{ padding: '6px 10px' }} with <Icon size={16} /> yields roughly 30px-high targets placed 6px apart, including the destructive suspend button (line 100)`
  - الإصلاح: ارفع الحد الأدنى لارتفاع أزرار الأيقونات إلى 40-44px وزد المسافة بينها، خاصة زر الإيقاف.
- **[MEDIUM] أزرار الحفظ الحساسة بلا حالة انشغال/تعطيل أثناء الإرسال**  
  src/routes/platform/VenueDetail.jsx:254 · states
  - الدليل: `<button className="btn btn-primary" onClick={saveSubscription}> — no busy/disabled state; double-click fires the write twice; same for saveNote (line 285) which also lacks try/catch`
  - الإصلاح: أضف حالة busy تعطّل الزر وتُظهر مؤشراً أثناء الحفظ، مع try/catch حول saveNote.
- **[MEDIUM] مؤشر «مبيعات اليوم» بلا عملة رغم تعدد عملات المنشآت**  
  src/routes/platform/Overview.jsx:73 · hierarchy
  - الدليل: `<div className="value num">{kpi.revenue.toLocaleString('en-US')}</div> — a bare number summed across venues that may use SAR/USD/AED (Billing supports 4 currencies)`
  - الإصلاح: أظهر العملة بجانب الرقم أو وضّح أن المجموع بالريال فقط مع استبعاد العملات الأخرى.
- **[MEDIUM] لوحة الإجراءات الجانبية بعرض ثابت 280px تتكدس تحت المحادثة على الأجهزة الصغيرة دون ترتيب أولوية**  
  src/routes/platform/Chat.jsx:494 · responsive
  - الدليل: `style={{ flex: '0 0 280px', width: 280, ... }} inside .platform-chat-grid which wraps below 1024px — on tablet portrait the admin panel (with all AI settings) pushes far below the 65dvh chat pane`
  - الإصلاح: على الشاشات الأصغر من 1024px اجعل لوحة الإجراءات قابلة للطي أو انقلها إلى Drawer بدلاً من التكديس بعرض ثابت.
- **[LOW] نص مختلط بلا مسافة: «رابطslug المنيو»**  
  src/routes/platform/Chat.jsx:503 · consistency
  - الدليل: `<div ...>رابطslug المنيو</div> — Arabic and Latin words fused together, renders garbled in RTL`
  - الإصلاح: صحّح النص إلى «رابط المنيو (slug)» مع فصل الكلمة اللاتينية بمسافة واتجاه مناسب.
- **[LOW] احتياطي #fff في خلفية Tooltip المخطط قد يكسر الوضع الداكن**  
  src/routes/platform/Analytics.jsx:35 · contrast
  - الدليل: `contentStyle={{ background: 'var(--surface, #fff)', ... }} — if --surface is ever unset the tooltip renders white with themed light text`
  - الإصلاح: احذف الاحتياطي #fff واكتفِ بـ var(--surface) مع تحديد color: var(--text) صراحةً.
- **[LOW] مشغّل الصوت بعرض ثابت 240px قد يتجاوز فقاعة الرسالة على الشاشات الضيقة**  
  src/routes/platform/Chat.jsx:44 · overflow
  - الدليل: `<audio controls src={m.fileUrl} style={{ maxWidth: '240px', height: 32 }} /> inside a bubble capped at maxWidth: '78%' — on 360px phones 78% of the pane is less than 240px`
  - الإصلاح: استخدم maxWidth: '100%' مع minWidth مناسب بدل القيمة الثابتة 240px.
- **[LOW] انتحال هوية المالك عبر window.confirm نصي طويل بدل حوار واضح**  
  src/routes/platform/VenueDetail.jsx:143 · states
  - الدليل: `window.confirm('سيتم تسجيل خروجك من حساب المنصة والدخول بحساب مالك ... متابعة؟') — multi-line native confirm for a high-impact identity switch, with no persistent visual indicator planned after the switch`
  - الإصلاح: استبدل confirm بحوار مخصص يوضح خطوات العودة، وأضف شريطاً دائماً في وضع الانتحال يبيّن أنك تتصفح كمالك المنشأة.

## portals-events — 6.5/10

هذه الواجهات الثانوية (بوابة الموظف، بوابة المندوب، الماسح، شاشة العرض، الفعاليات، بطاقة العضوية) مبنية جيداً على نظام التوكنز وتلتزم بالقواعد الصارمة (لا إيموجي، أرقام لاتينية، شريط التمرير مخفي عالمياً). أبرز المشاكل الحقيقية: حقل meta.emoji غير موجود في TIER_META فتظهر دائرة فارغة عند مسح بطاقة عضو، زر حجز التذكرة يعلق في حالة «جارٍ الحفظ» عند فشل فتح الدفع، أزرار المندوب الأساسية صغيرة (36px) لعمل خارجي بقفازات/شمس، وقيمة --gold-soft غير معرّفة فيَظهر لون فاتح ثابت في الوضع الداكن.

- **[CRITICAL] دائرة نتيجة مسح العضو تعرض meta.emoji وهو حقل غير موجود في TIER_META فتظهر فارغة**  
  src/routes/staff/Scanner.jsx:149 · states
  - الدليل: `<div className="center" style={{ width: 64, height: 64, ... fontSize: 30 }}>{meta.emoji}</div> — بينما TIER_META في src/lib/membership.js:24 يحتوي فقط { ar, en, icon: 'award', color } بلا حقل emoji`
  - الإصلاح: استبدل {meta.emoji} بـ <Icon name={meta.icon} size={30} /> كما تفعل MemberCard.jsx بالضبط.
- **[HIGH] زر حجز التذكرة المدفوعة يبقى معطلاً بحالة «جارٍ الحفظ» للأبد إذا فشل فتح صفحة الدفع**  
  src/routes/events/PublicEvents.jsx:143 · states
  - الدليل: `try { await startPayment('ticket', tenantId, res.id); return } catch (_) { toast.error(...'تعذّر فتح صفحة الدفع — تذكرتك محفوظة') } — لا يوجد setBusy(false) بعد الـ catch ولا finally، والزر disabled={busy}`
  - الإصلاح: أضف setBusy(false) داخل الـ catch الخاص بـ startPayment (أو انقل الحجز إلى finally) ليستعيد الزر حالته بعد فشل الدفع.
- **[HIGH] لون تغطية الوردية يستخدم var(--gold-soft) غير المعرّف فيسقط دائماً على لون فاتح ثابت يكسر الوضع الداكن**  
  src/routes/portal/StaffPortal.jsx:440 · contrast
  - الدليل: `background: eff ? (covering ? 'var(--gold-soft, #f6e9cf)' : 'var(--brand-soft)') : 'var(--surface-2)' — البحث في index.css لا يجد أي تعريف لـ --gold-soft، فالخلية البيج الفاتحة تظهر كما هي في الثيم الداكن`
  - الإصلاح: عرّف --gold-soft في توكنز index.css (بنسختين فاتحة وداكنة) أو استخدم color-mix(in srgb, var(--gold) 18%, transparent) بدل القيمة الاحتياطية الثابتة.
- **[HIGH] أزرار المندوب الأساسية (استلمت/انطلقت/تم التسليم) بحجم btn-sm أي 36px فقط لعمل خارجي أثناء القيادة**  
  src/routes/driver/DriverPortal.jsx:105 · touch
  - الدليل: `<button className="btn btn-sm btn-primary" onClick={() => (nx.to === 'delivered' ? deliver(o) : advance(o, nx.to))}> — و .btn-sm { min-height: 36px } في index.css:588، أقل من الحد 44px`
  - الإصلاح: اجعل زر تقدّم الحالة الأساسي btn-lg بعرض كامل أسفل البطاقة وأبقِ btn-sm للأفعال الثانوية (اتصال/تنقّل).
- **[MEDIUM] تحصيل الكاش عند التسليم يستخدم window.confirm الأصلي بدل حوار النظام، وإلغاؤه يُسجّل التسليم بلا تحصيل بصمت**  
  src/routes/driver/DriverPortal.jsx:72 · consistency
  - الدليل: `if (unpaid && window.confirm(ar ? 'هل حصّلت مبلغ ${o.total} نقداً من العميل؟' : ...)) { await collectCod(...) } else { await setDeliveryStatus(tenantId, o.id, 'delivered') } — المبلغ بلا عملة والحوار غير مصمم ولا RTL`
  - الإصلاح: استبدل window.confirm بورقة Sheet مصممة تعرض المبلغ مع العملة (Price) وزرّين واضحين «حصّلت نقداً» / «لم أحصّل».
- **[MEDIUM] أثناء المسح تظهر الكاميرا الخام فقط بلا أي إرشاد أو زر فلاش أو نص توجيهي**  
  src/routes/staff/Scanner.jsx:126 · states
  - الدليل: `<div id="reader" style={{ width: '100%', maxWidth: 380, ... display: scanning ? 'block' : 'none' }} /> ثم فقط {scanning && <button className="btn btn-outline" onClick={stop}>{t('cancel')}</button>}`
  - الإصلاح: أضف نصاً توجيهياً فوق المنظار («وجّه الكاميرا نحو رمز QR») وزر تشغيل الفلاش (torch عبر html5-qrcode) للإضاءة الضعيفة.
- **[MEDIUM] لون فئة «فضي» (#9aa3ad) نص أساسي بتباين ضعيف (~2.5:1) على الخلفية الفاتحة في البطاقة العامة**  
  src/routes/member/MemberCard.jsx:56 · contrast
  - الدليل: `<span className="bold" style={{ color: meta.color, fontSize: 'var(--fs-md)' ...}}> مع TIER_META.silver.color = '#9aa3ad' والبطاقة على تدرج شبه شفاف من نفس اللون`
  - الإصلاح: استخدم color-mix(in srgb, ${meta.color} 60%, var(--text)) لنص اسم الفئة أو اجعل النص var(--text) واحصر لون الفئة في الأيقونة والحد.
- **[MEDIUM] زر «أضِف إلى Apple Wallet (قريباً)» معطل دائماً في بطاقة عامة قابلة للمشاركة — عنصر ميت يضعف الثقة**  
  src/routes/member/MemberCard.jsx:81 · states
  - الدليل: `<button className="btn btn-outline btn-block" disabled>{ar ? 'أضِف إلى Apple Wallet (قريباً)' : 'Add to Apple Wallet (soon)'}</button>`
  - الإصلاح: احذف الزر المعطل حتى تتوفر الميزة، أو استبدله بزر «مشاركة البطاقة» فعلي (navigator.share) وهو أنفع لقابلية المشاركة.
- **[MEDIUM] شرائح الحالة في الهيرو تستخدم ألواناً ثابتة (#fff / #ffffff55 / #ff6b6b) بدل التوكنز وتنكسر مع براند فاتح**  
  src/routes/portal/StaffPortal.jsx:372 · contrast
  - الدليل: `style={{ background: myStatus === id ? '#fff' : 'transparent', color: myStatus === id ? color : '#fff', borderColor: '#ffffff55' ... }} وسطر 372: background: ... > statusLimitMs ? '#ff6b6b' : 'transparent'`
  - الإصلاح: استخدم var(--on-brand) بدل #fff و var(--danger) بدل #ff6b6b ليتبع الثيم ويظل مقروءاً على أي لون براند.
- **[MEDIUM] شبكة سلايد القائمة على التلفاز تعالج أعداد 1/2/3/6 فقط — عند 5 أو 7 أصناف يظهر صف يتيم غير متوازن على الشاشة الكبيرة**  
  src/routes/screen/ScreenPlayer.jsx:555 · responsive
  - الدليل: `.scr-menu-grid { grid-template-columns: repeat(4, 1fr) } مع [data-n='1'],[data-n='2'] و [data-n='3'],[data-n='6'] فقط (index.css:1548-1550) والقائمة .slice(0, 8)`
  - الإصلاح: أضف قواعد data-n='5' و data-n='7' (مثلاً أعمدة 3 مع توسيط الصف الأخير عبر grid auto-flow dense أو flex) لتوازن الصف الأخير.
- **[LOW] موقع الفعالية نص حر بلا اقتصاص فيمتد على أسطر متعددة داخل بطاقة الفعالية**  
  src/routes/events/PublicEvents.jsx:65 · overflow
  - الدليل: `{e.location && <span className="xs faint"><Icon name="pin" size={13} /> {e.location}</span>} — بلا ellipsis أو حد أسطر`
  - الإصلاح: أضف قصّاً بسطر واحد (overflow hidden + textOverflow ellipsis + whiteSpace nowrap) على سطر الموقع.
- **[LOW] زر «طلب إجازة» يستخدم علامة + نصية بدل أيقونة من Icon.jsx خلافاً لبقية الأزرار**  
  src/routes/portal/StaffPortal.jsx:632 · consistency
  - الدليل: `<button className="btn btn-primary btn-sm" onClick={() => setLeaveOpen(true)}>+ {ar ? 'طلب إجازة' : 'Request'}</button>`
  - الإصلاح: استبدل «+» النصية بـ <Icon name="plus" size={14} /> اتساقاً مع باقي أزرار النظام.

## global-system — 7/10

نظام التصميم في index.css ناضج بشكل ملحوظ: توكنات شاملة للألوان والمسافات والحركة، ثيمات نظام كاملة (noir/glass/airy...)، خصائص منطقية RTL في معظم الملف، وتغطية جيدة لـ prefers-reduced-motion و focus-visible. لكن توجد مخالفة قاعدة صارمة حرجة: كتلة "Custom Scrollbar Styling" في نهاية الملف تعيد تفعيل أشرطة تمرير مرئية على مستوى النظام كله وتلغي قاعدة الإخفاء، إضافة إلى رمز "✕" النصي في Sheet.jsx بدل مكوّن الأيقونات. كما أن توكن --info-soft غير معرّف في الوضع الفاتح فتفقد شارات KDS خلفيتها، وهناك ألوان #fff مثبتة تتجاهل --on-brand في قالب storefront، وسلّم z-index يُتجاوز بأرقام سحرية (900/950/9999).

- **[CRITICAL] كتلة أشرطة التمرير المخصصة في نهاية الملف تعيد إظهار أشرطة التمرير في النظام كله وتخالف القاعدة الصارمة**  
  src/index.css:4494 · hard-rule
  - الدليل: `line 4494: * { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--brand) 42%, transparent) var(--bg-2); } + lines 4475-4491: ::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-track { background: var(--bg-2); } — تأتي بعد قاعدة الإخفاء الصارمة في السطر 1252 (* { scrol`
  - الإصلاح: احذف كتلة "Custom Scrollbar Styling" (الأسطر 4474-4497) بالكامل لأن قاعدة الإخفاء في السطر 1252 هي السياسة النهائية المعتمدة.
- **[CRITICAL] زر إغلاق الشيت يستخدم الرمز النصي ✕ بدل مكوّن Icon في كل نوافذ النظام**  
  src/components/Sheet.jsx:34 · hard-rule
  - الدليل: `line 33-35: <button className="icon-btn" onClick={onClose} aria-label={t('close')}>✕</button> — رمز نصي (U+2715) يعرض بخط النص ويختلف شكله حسب الخط، بينما قاعدة المستودع: أيقونات فقط عبر Icon.jsx`
  - الإصلاح: استبدل ✕ بـ <Icon name="close" size={20} /> مع استيراد Icon.jsx — هذا الزر يظهر في رأس كل Sheet بالمنصة.
- **[HIGH] توكن --info-soft غير معرّف في الوضع الفاتح (:root و .platform-scope) فتفقد شارات KDS ولوحة التشغيل خلفياتها**  
  src/index.css:34 · contrast
  - الدليل: `:root يعرّف --info: #3a6ea5; فقط بلا --info-soft (معرّف فقط في dark سطر 134 وnoir سطر 1709 وneon سطر 2010) — بينما يستهلكه .kds-status { background: var(--info-soft); } (سطر 1029) و .dash-live-cell[data-tone='info'] (سطر 2686)، فتصبح الخلفية شفافة في الثيم الكلاسيكي الفاتح`
  - الإصلاح: أضف --info-soft: #e5edf6 (أو color-mix من --info) في :root وفي .platform-scope الفاتح.
- **[HIGH] شارة مخاطر مساعد الذكاء تستخدم لون --info الصلب كخلفية مع نص أزرق داكن — تباين شبه معدوم**  
  src/index.css:4035 · contrast
  - الدليل: `.ai-badge-risk.confirm { background: var(--info, #e8f0ff); color: #1d4ed8; } — الـ fallback الفاتح لا يُستخدم أبداً لأن --info معرّف دائماً (#3a6ea5 فاتح / #7aa7d6 داكن)، فيصبح النص #1d4ed8 على أزرق متوسط بتباين أقل من 2:1`
  - الإصلاح: استخدم background: var(--info-soft) مع color: var(--info) بعد إضافة التوكن الناقص، وأزل اللون المثبّت #1d4ed8.
- **[HIGH] قالب storefront يثبّت #fff على خلفية var(--brand) متجاهلاً توكن --on-brand — علامة فاتحة تجعل النصوص غير مقروءة**  
  src/index.css:3722 · contrast
  - الدليل: `[data-menu-layout='storefront'] .cat-heading { color: #fff; } (3722)، .menu-hero-title...{ color: #fff } (3724)، .store-sec strong { color: #fff } (3727)، .store-add { background: var(--brand); color: #fff } (3745)، وكذلك مصمم الأزرار [data-btnfx='gradient'] ... color: #fff (1292، 1316) رغم أن --btn`
  - الإصلاح: استبدل كل color: #fff فوق أسطح العلامة بـ var(--on-brand) الذي يحسبه applyTheme حسب فتوح لون العلامة.
- **[MEDIUM] أزرار المنيو العائمة (السلة والجرس) وشاراتها تستخدم left/right فيزيائية بعكس بقية النظام المنطقي**  
  src/index.css:3880 · rtl
  - الدليل: `.m-fab-cart { right: 12px; } .m-fab-bell { left: 12px; } .m-fab .b { ... right: -4px; } (3880-3883) و .cart-badge-count { ... right: -3px; } (3596) — بينما الشقيق .m-bell يستخدم inset-inline-end (3876)، فلا تنعكس المواضع عند التبديل للإنجليزية LTR`
  - الإصلاح: استبدلها بـ inset-inline-end/inset-inline-start لتتطابق مع بقية الملف وتنعكس مع اتجاه اللغة.
- **[MEDIUM] هالة السبوت لايت على الشاشات العريضة مثبّتة بـ left: 30% فتقع خلف النص بدل المنتج في RTL**  
  src/index.css:5065 · rtl
  - الدليل: `@media (min-width: 760px) { ... .spot-bg { left: 30%; } } — التخطيط صف flex ينعكس في RTL فيصير المنتج على اليمين، لكن الهالة الشعاعية تبقى عند 30% من اليسار خلف لوحة النص`
  - الإصلاح: استخدم inset-inline-start: 30% بدل left حتى تلاحق الهالة موضع صورة المنتج في الاتجاهين.
- **[MEDIUM] سلّم z-index المعرّف بالتوكنات يُتجاوز بأرقام سحرية متناثرة (900، 950، 9999)**  
  src/index.css:1411 · consistency
  - الدليل: `التوكنات تعرّف --z-appbar:100 حتى --z-toast:400 (98-104)، لكن .pinlock { z-index: 900 } (1411)، .upload-hud { z-index: 950 } (1402)، .img-zoom { z-index: 9999 } (3484)، .spot-fly { z-index: 9999 } (5124)، .m-fab { z-index: 60 } (3879) — كما أن .story-viewer يستخدم var(--z-toast) نفسه (1583) فقد تُدف`
  - الإصلاح: أضف توكنات --z-overlay و--z-lock و--z-hud إلى السلّم في :root وأسند كل القيم السحرية إليها، وارفع التوست فوق عارض القصص.
- **[MEDIUM] شارة عدّاد السلة في زر الوسط ثابتة العرض 15px بخط 8px — أي عدد من رقمين يُقصّ**  
  src/index.css:3596 · overflow
  - الدليل: `.m-bottomnav button.center-cart-btn .cart-badge-count { ... font-size: 8px; ... width: 15px; height: 15px; border-radius: 50%; } — بعكس الشارات الأخرى التي تستخدم min-width: 16px مع padding (مثل .cart-badge سطر 3597)`
  - الإصلاح: استبدل width الثابت بـ min-width: 15px مع padding: 0 3px وborder-radius: 999px، وارفع الخط إلى 9px على الأقل.
- **[MEDIUM] الشيت المشترك (كل النوافذ الحوارية بالنظام) بلا حبس تركيز ولا إعادة تركيز عند الإغلاق**  
  src/components/Sheet.jsx:12 · a11y
  - الدليل: `useEffect يعالج Escape وقفل التمرير فقط؛ العنصر role="dialog" aria-modal="true" لكن Tab يخرج إلى عناصر الصفحة خلف الـ backdrop، ولا يعود التركيز للزر الفاتح بعد الإغلاق`
  - الإصلاح: أضف حبس تركيز بسيط (تركيز أول عنصر عند الفتح، حلقة Tab داخل الشيت، إعادة التركيز للمُشغِّل عند الإغلاق).
- **[MEDIUM] التوست يختفي فجأة بلا حركة خروج ولا حد أقصى للتكديس ولا تنظيف للمؤقتات**  
  src/components/Toast.jsx:12 · states
  - الدليل: `setTimeout(() => setToasts(...filter...), ms) — إزالة فورية من الـ DOM (يوجد fade-up دخول في CSS سطر 2313 فقط)، وضغطات متتالية تكدّس توستات بلا حد، والمؤقتات لا تُلغى عند unmount`
  - الإصلاح: أضف حالة خروج (class تُضاف قبل الإزالة بـ 200ms مع انتقال opacity/translate)، وحداً أقصى 3 توستات، وتنظيف المؤقتات في cleanup.
- **[LOW] أزرار عناصر تفاعلية مشتركة تحت حد 44px للمس: الستيبر 38px والرقائق 38px وأزرار auth 34px**  
  src/index.css:748 · touch
  - الدليل: `.stepper button { width: 38px; height: 38px; } (748-750)، .chip { min-height: 38px } (657)، .auth2-lang { height: 34px } (2863)، .auth2-eye { width: 34px; height: 34px } (2877) — والستيبر يُستخدم في سلة الطلب على الجوال دون تكبير عند pointer: coarse بعكس .pos-qty`
  - الإصلاح: ارفع أهداف اللمس هذه إلى 44px داخل @media (pointer: coarse) كما فُعل مع .pos-qty في السطر 2648.
- **[LOW] نجمة العنصر المميز تستخدم var(--accent) الرمادي بينما الـ fallback الذهبي #C9A24B ميت لا يعمل أبداً**  
  src/index.css:3418 · consistency
  - الدليل: `.special-star { background: color-mix(in srgb, var(--accent, #C9A24B) 22%, var(--surface)); color: var(--accent, #C9A24B); } — لكن --accent معرّف دائماً في :root كـ #5c5c66 (رمادي، سطر 20/25) فتظهر شارة "مميز" رمادية باهتة بدل الذهبي المقصود`
  - الإصلاح: استخدم var(--gold) بدل var(--accent, #C9A24B) لأن توكن الذهبي معرّف ومضبوط للوضعين.
- **[LOW] قواعد ميتة وازدواجية أنظمة: .m-bell القديم بجانب .m-fab-bell وصنف .emoji بقايا حقبة الإيموجي**  
  src/index.css:3876 · consistency
  - الدليل: `.m-bell (3876) نسخة قديمة من .m-fab-bell (3879-3881) بنفس الأبعاد والموضع؛ .empty .emoji (2352) اسم موروث رغم أن المحتوى صار <Icon> (ui.jsx سطر 24)؛ ونظاما بطاقات متوازيان .item-card (2372) و .food-card (3438) لنفس المفهوم`
  - الإصلاح: احذف .m-bell إن لم يعد مستخدماً، وأعد تسمية .emoji إلى .empty-ic، ووحّد نظامي بطاقة الصنف تدريجياً.

## REFUTED (verified false-positives, excluded above)
- أرضية قراءة الشيت الزجاجي تطبَّق على كل الشيتات في الوضع الداكن العادي فتجعلها نصف شفافة بلا ضبابية

## FLUTTER FEASIBILITY

**Verdict:** التوصية الصريحة: لا تُعِد كتابة المنصة كاملة بـ Flutter الآن. المشروع ضخم (93 شاشة راوت + 52 مكوّن + نظام ثيمات ديناميكي لكل منشأة يتجاوز 5,400 سطر CSS) ومطوّر واحد بمساعدة الذكاء الاصطناعي لا يستطيع صيانة قاعدتي كود متطابقتين دون انجراف بينهما، كما أن قائمة الزبائن يجب أن تبقى ويب لأن الزبون يمسح QR ولن يثبّت تطبيقاً. سبب "الانهيار" الحقيقي موثّق أصلاً في تدقيق 2026-07-07 (onSnapshot بلا معالج أخطاء، تعليق الماسح، إلخ) وإصلاحه في الويب أرخص بعشرات المرات من إعادة الكتابة. الخطة المثلى على مرحلتين: أولاً أكمِل الخيار A فوراً (إصلاح أخطاء الثبات المرصودة + TWA على أندرويد و PWA على iOS، وهو مخطط له أصلاً في RBT360_MASTER_PLAN) لتحصل على تطبيق قابل للتثبيت خلال أسابيع قليلة مع بقاء النشر الفوري؛ ثم إن بقيت الحاجة لمتانة أصلية حقيقية للطاقم، نفّذ الخيار C: تطبيق Flutter صغير للكاشير وشاشة المطبخ والماسح فقط (6-10 أسابيع) يضرب نفس Firestore بنفس القواعد، مع كاميرا أصلية وطباعة حرارية وعمل دون اتصال أقوى، بينما تبقى القائمة ولوحة الإدارة والمنصة المركزية ويب. الخيار B (إعادة كتابة كاملة) مرفوض حالياً: 20-36 أسبوعاً، يجمّد تطوير الميزات (المدفوعات والتوصيل هما الخط القادم)، ويستبدل النشر الفوري بمراجعة المتاجر.

### A: Keep React web + TWA (Android) / PWA (iOS) installable wrap — 1-3 weeks
Pros:
- قاعدة كود واحدة، صفر انجراف، النشر فوري بدون مراجعة متاجر
- مخطط له أصلاً في RBT360_MASTER_PLAN (per-venue PWA + Android TWA) — أقل مقاومة
- نظام الثيمات الديناميكي (5,400+ سطر CSS + متغيرات لكل منشأة) يبقى كما هو دون إعادة بناء
- معظم أسباب الانهيار مشخّصة في تدقيق 2026-07-07 وقابلة للإصلاح في الويب مباشرة (error callbacks + ErrorBoundary)
- Firestore offline persistence متاح في الويب (persistentLocalCache) للصمود عند انقطاع الشبكة
Cons:
- iOS يبقى PWA: الإشعارات تعمل فقط من iOS 16.4+ وبعد الإضافة للشاشة الرئيسية، وقيود على الكاميرا والتشغيل بالخلفية
- المتصفح قد يفرّغ التبويب/الذاكرة على أجهزة ضعيفة — أقل متانة من تطبيق أصلي في وضع الكشك
- الطباعة الحرارية عبر window.print تبقى غير مثالية مقارنة بـ ESC/POS الأصلي
- لا يحل مشاكل html5-qrcode (تعليق الماسح المرصود) إلا بإصلاح الكود نفسه

### B: Full Flutter rewrite (diner + staff + admin + platform) — 20-36 weeks
Pros:
- متانة أصلية كاملة: عزل الأعطال، كشك أندرويد، Firestore offline أصلي، كاميرا وطباعة وصوت أصلي
- أداء ورسوم متحركة أفضل على الأجهزة اللوحية الضعيفة
- FlutterFire ناضج وقواعد Firestore الحالية تُستخدم كما هي دون تغيير في الخلفية
Cons:
- 93 شاشة راوت + 52 مكوّن + وحدة تحكم المنصة + نظام قانوني وفواتير ZATCA — حجم إعادة كتابة هائل لمطوّر واحد
- نظام الثيمات لكل منشأة (CSS variables ديناميكية + مكتبة سكِنات) يتطلب إعادة تصميم كاملة كـ ThemeExtension — أصعب جزء وأعلى مخاطرة
- قائمة الزبائن عبر QR يجب أن تبقى ويب على أي حال → ستنتهي بقاعدتي كود مهما فعلت
- مراجعة المتاجر تقتل سرعة النشر الفوري الحالية (إصلاح خطأ حرج يستغرق أياماً بدل دقائق)
- Moyasar Flutter موجود لكن Apple Pay/3DS entitlements ومسارات الدفع تحتاج إعادة اختبار كاملة
- يجمّد خط المدفوعات/التوصيل القادم (الأولوية المعلنة) لأشهر

### C: Hybrid — Flutter staff app (Cashier + KDS + Scanner) on same Firestore; web stays for menu/admin/platform — 6-10 weeks
Pros:
- يستهدف بالضبط الشاشات التي يجب ألا تنهار أبداً (الكاشير وشاشة المطبخ والماسح) بأقل مساحة إعادة كتابة (~3 شاشات + نموذج الطلب)
- mobile_scanner الأصلي يقضي جذرياً على مشاكل html5-qrcode المرصودة (التعليق والصوت)
- Firestore أصلي بدون تغيير في القواعد أو الدوال السحابية — نفس الخلفية تماماً
- طباعة حرارية ESC/POS أصلية + وضع كشك أندرويد + عمل دون اتصال أقوى للكاشير
- شاشات الطاقم لا تحتاج نظام الثيمات الكامل (ثيم النظام فقط، وليس سكِنات القائمة) فتتجنب أصعب جزء
Cons:
- قاعدتا كود جزئيتان: أي تغيير في نموذج الطلب/الأسعار/الولاء يجب تطبيقه مرتين — خطر انجراف حقيقي لمطوّر واحد
- تحديثات تطبيق الطاقم تمر بمراجعة المتجر (يخفَّف بجعل المنطق في Firestore/Functions قدر الإمكان)
- منحنى تعلم Dart/Flutter وإعداد بيئة iOS (حساب مطور Apple + جهاز Mac للبناء)
- لا يحسّن تجربة الزبون أو لوحة الإدارة إطلاقاً — تلك تبقى بحاجة إصلاحات الويب نفسها

### Dependency map
| Web | Flutter | Risk |
|---|---|---|
| firebase JS SDK v11 (Auth, Firestore, Storage, Functions, Messaging) | FlutterFire: firebase_core, firebase_auth, cloud_firestore, firebase_storage, cloud_functions, firebase_messaging — same project, same rules | easy |
| react-router-dom v6 (93 route files under src/routes/**) | go_router (deep links + guards) | medium |
| html5-qrcode (src/routes/staff/Scanner.jsx — known hang/stale-closure bugs) | mobile_scanner (CameraX/AVFoundation) — strictly better native | easy |
| recharts (analytics dashboards) | fl_chart — every chart hand-rebuilt, no drop-in | medium |
| @dnd-kit core/sortable/utilities (menu item reordering) | ReorderableListView / Draggable + LongPressDraggable | medium |
| react-easy-crop + canvas getContext in src/lib/cropImage.js | image_cropper or crop_your_image + image package | easy |
| lucide-react icons (hard rule: icons only, no emojis) | lucide_icons_flutter (same icon set exists) | easy |
| qrcode (table QR generation) | qr_flutter / barcode_widget | easy |
| pdfjs-dist (PDF viewing) | pdfx / syncfusion_flutter_pdfviewer | medium |
| xlsx (Excel export of reports) | excel package or syncfusion_flutter_xlsio; sharing via share_plus | medium |
| Moyasar web inline SDK (src/routes/InlineCheckout.jsx, PayReturn.jsx, payments.js; payIntents + webhook arch stays server-side) | moyasar official Flutter package — but Apple Pay entitlements, 3DS redirect flows, and STC Pay need full re-certification and re-testing | hard |
| window.print receipts + ZATCA invoice pages (src/lib/print.js, /invoice/:tid/:id) | printing (PDF/AirPrint) + esc_pos_utils/flutter_esc_pos for thermal — native is better but invoice HTML templates must be rebuilt as pdf widgets | medium |
| Service worker + Web Push (public/sw.js, manifest.webmanifest, src/lib/push.js) | firebase_messaging + flutter_local_notifications (more reliable than web push, esp. iOS) | easy |
| localStorage (~20 call sites: device id, PIN, prefs, i18n, customer identity) | shared_preferences + flutter_secure_storage for PIN/tokens | easy |
| Audio .play() notification sounds (CashierPOS, KDS, notify.js — 17 files) | audioplayers / just_audio (no browser autoplay-policy problems) | easy |
| video elements: Stories.jsx, ScreenPlayer.jsx (digital signage), VenueBackground video skins | video_player + chewie; signage loop playback needs kiosk handling | medium |
| 5,487-line CSS theming: runtime per-venue CSS custom properties (--brand-base, --sel, --btn-g1) via themes.js/systemThemes.js + skins/watermark/background library | Full rebuild as ThemeData + custom ThemeExtension driven by tenant doc; every glass/gradient/skin effect hand-ported; no CSS-variable equivalent — largest single line item | hard |
| Arabic RTL layout (dir=rtl) + ar-SA-u-nu-latn Latin-digit formatting | Directionality.rtl + intl with explicit Latin-digit locale — first-class in Flutter | easy |
| IntersectionObserver (lazy menu images/sections) | Not needed: ListView.builder virtualizes natively; visibility_detector if required | easy |
| Per-venue PWA install + Android TWA (planned in RBT360_MASTER_PLAN) | Superseded by real native app in options B/C; irrelevant to option A | easy |

### Stability notes
- الخيار A: الثبات يأتي من إصلاح الجذور المشخّصة أصلاً — إضافة معالج أخطاء لكل onSnapshot (سبب الدوّامة العالقة في 15+ شاشة)، ErrorBoundary عام مع زر إعادة تحميل، تفعيل persistentLocalCache في Firestore للويب، وإصلاح ماسح html5-qrcode؛ TWA يمنع فقدان الحالة بإبقاء التطبيق ككيان مثبّت بدل تبويب متصفح
- الخيار B: متانة قصوى نظرياً — عزل أعطال Dart (الاستثناء لا يُسقط التطبيق)، Firestore offline أصلي بمزامنة تلقائية، وضع كشك مثبّت على أندرويد يمنع الخروج، لا تفريغ ذاكرة من المتصفح، إشعارات FCM موثوقة على iOS؛ لكن أشهر إعادة الكتابة نفسها هي أكبر خطر على الثبات (أخطاء جديدة في كود جديد بالكامل)
- الخيار C: يعطي متانة أصلية حيث تهم فقط — الكاشير يعمل دون اتصال بالكامل عبر Firestore الأصلي ويزامن عند العودة، mobile_scanner لا يعلّق مثل html5-qrcode، الطباعة الحرارية مباشرة عبر ESC/POS بلا حوار طباعة المتصفح، وضع كشك على أجهزة الطاقم؛ بينما شاشات الزبون والإدارة تحصل على إصلاحات ثبات الويب من الخيار A
- في كل الخيارات: القواعد المشتركة في Firestore والدوال السحابية (invoicing, webhooks, payIntents) تبقى نقطة الحقيقة الوحيدة — كلما نُقل منطق أكثر إلى الخادم قلّ خطر انجراف قاعدتي الكود وقلّت الحاجة لتحديثات المتجر العاجلة
- قاعدة عملية: التطبيق لا ينهار عندما يكون لكل اشتراك بيانات معالج خطأ ومسار تراجع، ولكل شاشة حالة فارغة وحالة خطأ صريحتان — هذا صحيح في React وFlutter على السواء، والتقنية وحدها لا تشتري الثبات
