# HANDOFF — حالة المشروع الكاملة (آخر تحديث: 2026-07-22 — الجلسة الرابعة «الجولة الكبرى»)

ملف تسليم الجلسة. اقرأه أولاً في أي جلسة جديدة قبل لمس أي شيء.
المنشأة الحيّة: **صاج السمك** — `rbt360sa.com/m/sajalsamak` — tenant id `5Eg401SLtIhqjaMAdrIg` — ثيم `editorial` — باقة enterprise.

---

## 1. العقد المركزي — `src/lib/dishComposition.js`

**القاعدة الصارمة:** كل ميزة بصرية لها نصفان (محرّك يرسم + واجهة تتحكّم) يستوردان هذا الملف.
لا يُكتب رقم حدود محلياً أبداً — `RANGE.*` وأخواتها هي المصدر. مرّتان انكسر النظام لأن نصفين
بُنيا على فهمين مختلفين (جولات اللعب لم تُسجَّل؛ غلاف البطولة مُرّر كبطولة).

| النظام | الدوال | حقل التخزين | المحرّك | الواجهة |
|---|---|---|---|---|
| تركيب الصنف | `resolveComposition` / `bgStyle` / `imgStyle` / `bgVideoStyle` — حدود حرة (scale 0.2-4، offset ±100، rot ±180) + `tilt` منظور rotateX (imageTilt/listTilt) | حقول item (bg*/image*/list*/shadow*/effect/anim/tilt) | EditorialLayout + MenuView | Items.jsx «تركيب الصنف» |
| الطبقات (صور مفرّغة) | `resolveLayers` / `layerStyle` | `item.layers` (+`layersOff` للمحرّر فقط) | EditorialLayout `EdtLayers` | Items.jsx «عناصر مركّبة» (سحب) |
| الجدار | `resolveWall` / `wallStyle` (+`wallPaint` مُصدَّر من الثيم) + `vignette` (ذوبان أسفل صورة الطبق — `--edt-vig`، صفر يلغيه) | `tenant.menuWall` (+`.header` للهيدر الطوبي) | EditorialLayout `EdtWall` | Settings «جدار المنيو» `set-menuwall` |
| اتصال الأصناف | `resolveSections` | `tenant.menuSections` | `.edt-stage[data-sec]` + `sectionVars()` | Settings `set-menusections` |
| الزينة المعلّقة v2 | `resolveDecor` / `decorStyle` (+`decorPlace`/`glowPaint` من الثيم) — مراسٍ جديدة `page-free` (يتحرك مع التمرير، صندوقه الصفحة كلها) و`screen` (مثبت على الشاشة، portal) + عمق ثلاثي `depth: back/front/top` (بديل front المشتق) + حجم حتى 150 | `tenant.menuDecor` | `EdtDecorZones` (الهيدر والشاشة عبر portal) | Settings `set-menudecor` |
| الهيدر المخصص | `resolveMenuHeader` (mode ''/brick/image + scrim/blur/pos + إظهار logo/name/lang/theme) — brick يفوّض للجدار، والوضع '' يرجع لـ`menuWall.header` القديم | `tenant.menuHeader` | DinerBar (`.app-bar-img` + `--hd-*`) لكل الثيمات؛ الطوبي عبر `headerBrickVars` | Settings `set-menuheader` |
| كساء الأزرار | `resolveButtons` (skin brick/image + radius/scrim/ink + **scope** primary/all + **shape** ''/slab/pill/sharp/chamfer + **imgScale/imgX/imgY** لصورة الوجه) + `buttonSkinVars` في الثيم — slab («طوبة واحدة») يرسم طوبة من لون الجدار | `tenant.menuButtons` | index.css `[data-btnskin]` + `[data-btnscope='all']` (رقاقات/خيارات/عدّاد/إغلاق مع حلقة كهرمانية للمختار) + `[data-btnshape]` | Settings `set-menubuttons` |
| لوح القراءة | `menuWall.panel` (0-1، الافتراضي 0.65) — بديل اللوح الأسود الصلب وهالته | ضمن `tenant.menuWall` | `--edt-panel` + color-mix في `::before` (مع fallback صلب) | شريط ضمن بطاقة الجدار |
| **الطاولة** (فكرة المالك) | `resolveTable(tenant, {variant})` / `tableStyle` / `tableLift` + **تحكم حر** `x/y/w/h` (`tableFreeStyle`، origin أعلى-وسط فالمقعد لا ينزاح) + `dim` (تعتيم كامل) + `melt` (`tableMeltStops` — 0.5 = السلوك القديم) + **تخصيص نافذة الصنف** `menuTable.stage` جزئي (`TABLE_STAGE_KEYS` فقط؛ الخامة موحدة عمداً) | `tenant.menuTable` (+`.stage`) | `EdtTable` في `.edt-main` و`.edt-stg-body` (المسرح variant:'stage') | Settings `set-menutable` (مقبض «أين تضبط الآن؟» + زر توليد AI) |
| ثيم الشريط | `CHROME_THEMES` في `systemThemes.js` | `tenant.chromeTheme` | `applyChrome` — **منيو الزبون فقط** (مفصول عن النظام عمداً) | Settings «لون الشريط» |
| سطح/زينة الطبق القديمة | `dishProps.js` — **opt-in فقط** | `item.surface`/`item.props` (+`contactShadow`/`reflect`) | DishProps.jsx | Items.jsx «السطح والزينة» |
| **الظلال** (جولة 4) | `SHADOW_RANGE` / `resolveShadows` / `shadowVars` / `scaleDishShadow` — 8 قنوات 0..1 (1=اليوم، 0=إزالة؛ `tableTop` ريشة تنعيم opt-in dflt 0 مقصورة CSSياً على `.edt-table-art:not([data-m])`) | `tenant.menuShadows` | vars على الجذرين + `--hd-sh` (DinerBar) و`--edt-hd-sh` (headerBrickVars) | Settings `#set-menushadows` (زر إزالة الكل + روابط لقرصي contact/vignette القديمين) |
| **أحبار الوضعين** | `INK_FIELDS`/`INK_ALPHA`/`resolveInk`/`inkVars`/`chromeInkVars`/`inkLocked`/`inkModeFor` — 8 حقول hex لكل وضع؛ **القفل**: أي جدار مُفعّل بلا أحبار فاتحة صريحة يبقى داكناً في الفاتح (`followTheme` يفك القفل) | `tenant.menuInk` | inline vars تغلب كتلتي التوكِنات + `data-edt-dark` على الجذرين وجذر MenuView | Settings `#set-menuink` (مثبّت المعاينة عبر `previewTheme` أعلى مستوى في مغلف postMessage) |
| **إمالة الطبق v2** | `imgTiltBoxStyle` (غلاف perspective var `--dish-persp` لكل سطح، origin 50% 100%، lift عليه، blend ينتقل إليه) + `RANGE.tiltContact` (قطع ناقص أرضي opt-in) — `imgStyle` لم يعد يبث perspective/rotateX | `item.imageTilt`/`listTilt`/`tiltContact` | EdtDish (fx داخل الغلاف) + ItemSheet في MenuView | Items.jsx (منزلقا قائمة/نافذة منفصلان + منزلق ظل الملامسة) |
| **الطاولة v3** | `y`±100 و`h` حتى 300، `meltBottom` (ذوبان الحافة السفلية)، `veil` (حجاب قراءة)، `extend===true` (تمتد لأسفل النافذة، `data-tbl-extend`)، `heroPad` 20-80 / `heroMax` 20-60 (+`--edt-stg-heromin` المشتق) + `tableMeltBottom`/`tableStageVars` — كلها ضمن `TABLE_STAGE_KEYS` | `tenant.menuTable` (+`.stage`) | EdtTable (ترتيب الطلاء art→tint→dim→melt→melt-b→veil→edge→contact) | بطاقة الطاولة (كتلة «نافذة الصنف» — المعاينة لا تُظهر extend/heroPad/heroMax) |
| **البانر والمميزة والغرفة** | `BANNER_RANGE` (`melt` قناع شفافية حقيقي يطفئ الـfade المرسوم، `meltLen`، `scrim`) + `FEATURED_RANGE.film` + `resolveWall().room` (الجدار خلف الصفحة كلها عبر `EditorialRoomBg` — يُشتق من resolveWall لا من truthiness النمط) | `tenant.bannerMelt/bannerMeltLen/bannerScrim/featuredFilm` + `menuWall.room` | MenuView (`.menu-hero-media` قناع mask + `data-room` + `data-film`) | بطاقتا البانر والجدار (مفتاح «الغرفة» يزرع قيماً مقترحة عند null فقط) — **الحقول في القوائم الأربع كلها** |
| **ترتيب الصفحة الرئيسية** | `HOME_BLOCKS` (9 كتل، ids تطابق مفاتيح hidden القائمة) + `resolveHomeOrder` (يعيد الغائب لموضعه الافتراضي) | `tenant.menuHome.order` | MenuView `HOME_RENDER` خارطة + حلقة مرتبة | Settings `#set-menuhome` (سحب dnd-kit؛ الترتيب فوري والعيون مع Save) |
| **كساء الكروم** | `CHROME_ELEMENTS` (nav/cartFab/bellFab/langBtn/themeBtn/social) + `CHROME_SKIN_MODES` ('', room, image, none) + `CHROME_RANGE` (+x/y للعائمين فقط) + sheet + `CHROME_PAGE_IDS` (6 صفحات) + `resolveChrome/…Sheet/…Page` — `follow` واحد يجعل '' ترث الجدار | `tenant.menuChrome` | ChromeSkin.jsx (يبث `data-mch-*` + vars على body، ينظف بالكامل) + PageBackground.jsx + `chromeFaceVars` المصدَّر من الثيم | Settings `#set-menuchrome/-sheets/-pages` (أكورديون لكل عنصر) |
| **قصّ الفيديو** | `VIDEO_TRIM_RANGE`/`normalizeVideoTrim`/`trimWindow` — end 0 = للنهاية؛ كل مبدّل رابط **يصفّر** trim جاره | `bannerVideoTrim`/`bgVideoTrim`/`immersiveBgVideoTrim`/`appBg.trim`/`item.bgVideoTrim`(عبر composePayload)/`item.videoTrim`/`story.trim` | `useVideoTrim` hook (+`attachTrim`؛ خيار `onEnd` للقصص = تقدّم لا تكرار) على كل مواضع التشغيل | `VideoTrimRange.jsx` (dir=ltr عمداً) في بطاقات البانر/الخلفيات/القصص/محرر الصنف |
| **معاينة الصنف الحية** | مغلف postMessage: `{__rbt360Preview, appearance, draftItem, focus{itemId,view,replay}, previewTheme}` — `previewTheme` شقيق أعلى مستوى؛ `/preview/:slug` صار سطح زبون في i18n (باستثناء pos/pinlock) فلا يلوث ثيم الإدارة | — (عابر) | PreviewMenu (يدمج المسودة بالمعرّف أو `__draft__`؛ الثيم يُطبق داخل effect الـskin) + MenuView `previewFocus` | ItemLivePreview.jsx: لوح جانبي ≥1000px / درج سفلي مطويّ افتراضياً؛ محرر Items بشبكة `ie-grid` (معاينات dcx القديمة أُحيلت للتقاعد) |
| **مولد 3D الواقعي** | `GEN3D_RANGE` (مرآة يدوية في functions) — الافتراضي صورة واحدة واقعية (بلا texture_prompt/remesh)؛ `multiView===true` فقط يقرأ المعرض (حارس عملاء قدامى)؛ `smooth:true` يعيد وصفة الجلسة 2 | ar3dJobs تكسب `mode`+`views` | `imageTo3d` المعاد بناؤها | ModelStudio (منتقي لقطات حتى 4 + مفتاح واقعية افتراضه ON) |
| **الطلب الذكي صورة/صوت** | `AI_ORDER_RANGE` (مرآة `DINER_AI` في functions) — طلب `{tenantId, kind, inlineData, lang}` ← `{lines:[{id,qty,variantKey,note}]}` بفهارس لا نص حر؛ حصة شهرية 2000 + 20/دقيقة (transaction، 0 صريح يعطّل) | `voiceAiEnabled===true` / `dinerAiMonthly` / عدّادات `counters/dinerAi-YYYY-MM` (admin فقط) | دالة `dinerOrderAi` (غير موثّقة كـcreatePayIntent) + `dinerAi.js`/`voiceOrder.js` عميلاً | PhotoOrder (كاميرا + **استوديو** + تصغير canvas) / VoiceWaiter (سحابي/محلي/كتابة، خاتم مستوى، تأكيد متعدد مع فحص sold-out لكل سطر، variant من الخادم يُحترم) |

**خامات مشتركة:** `dishprops.css` — كل خامة selector مزدوج (`.dp-plane` + `.edt-table-art[data-m=…]`). خامة واحدة، لا نسختان.

## 2. فخاخ مثبتة — لا تكرّرها

1. **تعليق JSX** بين خصائص وسم أو أول سطر داخل return بقوسين = خطأ تحليل. حدث **5 مرات**. التعليقات فوق الـreturn.
2. **RTL:** لا تُوسّط بـ`translate(-50%,…)` مع `inset-inline-start` — التحويل فيزيائي والإزاحة منطقية، فينزاح العنصر بعرضه كاملاً بالعربية. النمط الصحيح: `margin-inline-start: calc(w/-2)` + `translateY(-50%)`. (`layerStyle` يفعلها؛ `decorStyle` يعوّضها `decorPlace` في الثيم — **لا تصلح الاثنين معاً**.)
3. **cqmin** يحتاج حاوية `container-type: size` **بارتفاع محدَّد** — وضعها على حاوية ارتفاعها من محتواها = انهيار للصفر وكل العناصر بحجم 0.
4. **صفوف الخيارات تلتفّ ولا تتمرّر** — شريط أفقي لا يلتفّ + شريط تمرير مخفي = خيارات لا يصلها الماوس (حدثت في تبويبات محرّر الصنف).
5. **الوكلاء يموتون وقد كتبوا ملفاتهم** — افحص القرص (`git status`) قبل افتراض الضياع. (هذه المرة: موت حدّ الإنفاق = لم يُكتب شيء.)
6. **لا وكيلين على ملف واحد.** `index.css` أُفسد مرتين هكذا. كل وكيل ملفاته + `lead_edits` للباقي.
7. **حذف مفتاح من العقد** = افحص كل قارئ (`RANGE.x` على undefined أسقط محرّر الأصناف). ماسح الانحراف يمسكها الآن.
8. **نماذج Gemini المتقاعدة** تظهر في القائمة وتفشل عند النداء (`gemini-2.5-pro` 404). اختبر بالنداء الفعلي قبل التبديل.
9. **جهاز المالك ضعيف الذاكرة** — البناء يفشل OOM عشوائياً؛ حلقة إعادة محاولة 3-4 مرات تكفي.
10. **بيئة sharp تنكسر داخل gltf-transform** على هذا الجهاز؛ استعملها مستقلّة أو تجاوز ضغط النسيج.

## 3. أدوات الفحص (scratchpad `459f1182…/scratchpad/`)

- `tdz.mjs` — ماسح TDZ. **إيجابيات كاذبة معروفة:** استدعاءات داخل معالجات/setTimeout/تنظيف effect آمنة؛ الخطر الحقيقي فقط مراجع مصفوفة التبعيات أو تقييم وقت الرسم. آخر 7 بلاغات على Settings.jsx فُحصت = كلها آمنة.
- ماسح الانحراف (inline): يقارن كل `X_RANGE.key` مستعمل ضد العقد. يتجاهل أسطر التعليقات.
- التحقق القياسي: `node scripts/guard.mjs && npx eslint src --quiet && npx vite build` (مع إعادة محاولة للبناء).
- النشر: `npx firebase-tools deploy --only hosting --project menu-88996` (والدوال باسمها عند الحاجة).
- وصول Firestore/Storage من السكربتات: token من `firebase-tools.json` (نمط `fsauth.mjs`) — يعمل، استُعمل لاستيراد القائمة والصور.

## 4. ما شُحن هذه الجلسة (رؤوس الالتزامات)

`a8cec52` إصلاح المساعد (نموذج متقاعد + thinkingBudget يكسر pro + سجل أخطاء) →
استيراد قائمة صاج السمك (9 تصنيفات/56 صنفاً، موثّق بالقراءة العكسية) → قصّ السمكة + مجسّم 3D (70.6→10.5MB) →
`84f51e2` إصلاحات الثيم (زر السلة غير المرئي/تغطية التصنيفات/المقترحات) → إثراء البيانات (أسعار كيلو، خيارات 17 طبقاً، prep/serves) →
`2d35992` مكتبة الزينة والأسطح + كروم → `95e44e7` الزينة opt-in + القصّاصة تختار النسبة →
`d5aeddc` شاشات التحكم (كروم + سطح/زينة) → `de44eeb`+`5747e17` مؤلّف تركيب الصنف →
`439639c` طبقات الصور الحقيقية + محرّك الجدار (10 روابط/6 تشطيبات) → `ec289b6` تبويبات تلتف + إزالة صورة →
`320b6d0` شاشة الجدار → `37b9e43` إزالة الفاصل الأسود/الظل/الرسوم + التعليق (فوانيس) + هيدر طوبي + إصلاح RTL
→ `dfe5b09` الطاولة (render+card) + زر AR في الثيم →
**جلسة 2026-07-22 الثانية (الحدود السوداء والغرفة):**
1. كل مصادر السواد عولجت: لوح النص صار قابلاً للضبط (`panel` + color-mix بدل الصلب وهالة 16px)، ظله يُلغى مع الطاولة، vignette أنعم تحت الجدار، catbar مصنفر شفاف فوق الجدار، ظل الهيدر الطوبي أخف.
2. **التشطيبات الإجرائية لا تُرسم فوق الجدران الفوتوغرافية** (كانت بقعاً داكنة فوق صورة المالك) — بطاقة الجدار تخفي التشطيب ومنزلقي اللحام للصور.
3. **طاولة kind:'image' برابط فارغ ترجع للخامة بدل الاختفاء** (كانت علة صاج السمك الحية: لوح أسود صافٍ) + اختيار الخامة في البطاقة يضبط kind تلقائياً.
4. **معاينة الاستوديو لحظية فعلاً**: previewOverride كان يُسقط menuWall/menuTable/menuSections/menuDecor كلها — الآن تُبث من حالات البطاقات نفسها (كل نقرة منزلق) وبشرط وجود الحقل على المستأجر (وإلا عاينّا جداراً افتراضياً لم يُفعَّل).
5. **صورة جدار صاج السمك الحية عولجت seamless ورُفعت** (cross-fade 12% للحواف) وحُدّث `menuWall.url` مباشرة في Firestore + زر «إزالة فواصل التكرار» في البطاقة + `src/lib/seamless.js` للأجل الطويل.
6. زينة v2 + الهيدر المخصص + كساء الأزرار (الجدول أعلاه) مع بطاقاتها وبثها للمعاينة.
7. الاستوديو أُعيد تقسيمه: تبويب جديد **«غرفة المنيو»** (جدار/هيدر/أزرار/طاولة/اتصال/زينة) منفصل عن «الخلفيات والوسائط» + مصفوفة إظهار/إخفاء مجمّعة تضم مفاتيح التجارب الفورية + مفتاح `welcome` جديد لبطاقة الترحيب.
8. **محرر الأصناف أعيد ترتيبه**: التسعير يضم المقاسات والإضافات فعلاً، قسم جديد «التفاصيل والوصف»، AR نقي، المفاتيح الإدارية في «متقدم» — والرقاقات تطابق أقسامها. **استوديو 3D يفتح فوق المحرر** (لا يغلقه) ويعيد روابط المجسم لنموذجه عبر formPatchRef.
9. **Meshy جودة**: meshy-5 + quad + 150k مضلع + symmetry off + remesh + texture_prompt غذائي + **متعدد الصور** (كل لقطات المعرض حتى 4 عبر multi-image-to-3d) — نُشرت الدالة. **[تصحيح الجلسة 4: هذه الوصفة أفسدت الواقعية (كريم كراميل كرتوني) — صارت opt-in خلف `smooth:true`، والافتراضي صورة واحدة واقعية، والمعرض لا يُقرأ إلا مع `multiView:true` من منتقي اللقطات.]**

**جلسة 2026-07-22 الثالثة (التحكم الحر الكامل):**
1. **الأزرار**: scope «كل الأزرار» (رقاقات التصنيفات on/off + خيارات المقاسات + عدّادات الكمية + زر الإغلاق + طوب الإقران — المختار يبقى بحلقة كهرمانية inset)، shape (طوبة واحدة slab من لون جدار المنشأة/كبسولة/حاد/مشطوف chamfer clip-path)، imgScale/imgX/imgY لتكبير وتحريك الصورة داخل الوجه (على طوب الجدار يكبّر وحدة الطوب).
2. **الطاولة الحرة**: x/y/w/h (transform، origin أعلى-وسط)، dim، melt، lift حتى 60 — وكلها قابلة للتخصيص **لنافذة الصنف وحدها** عبر `menuTable.stage` (مقبض في البطاقة + «ألغِ تخصيص النافذة»). المعاينة تستعمل `tableMeltStops`/`tableFreeStyle` نفسها.
3. **الطبق الحر**: حدود التركيب اتسعت (scale 4x، إزاحة ±100%، دوران ±180°) + منزلق «الإمالة على السطح» (imageTilt، perspective rotateX) في المحرر.
4. **سطح المكتب/التابلت**: مع الطاولة المفعّلة يعود التخطيط المكدّس الموسّط (كالجوال) بدل عمودين يفصلان الطبق عن طاولته — في القائمة (`.edt-sec[data-table]`) والمسرح (`.edt-stg[data-table]`) كليهما.
5. **الخط الشفاف الداكن**: أُزيل حدّ+ظل catbar فوق الجدار، شريط السلة السفلي صار مصنفراً فوق الجدار بلا حد، vignette صار منزلق `menuWall.vignette` (صفر = لا شيء)، ظل حافة الطاولة المضاءة خُفف .45→.26.
6. **زر AR**: خرج من فوق صورة الطبق إلى تدفق الصفحة تحت الصورة (وسط) — لا يغطي الطعام أبداً.
7. **توليد طاولة بالذكاء**: دالة `generateTableImage` (Gemini `gemini-2.5-flash-image`، برومبت من لون/نمط/تشطيب الجدار + وصف اختياري، حد 30/شهر في `aiImageJobs`، تخزين `library/tables/`) + زر «ولّد طاولة تناسب الثيم» في بطاقة الطاولة يركّبها فوراً — **نُشرت** (غير مجرَّبة بنداء حي بعد؛ إن رفض النموذج جرّب برومبتاً أوضح أو افحص سجل الدالة).
8. **خامات فوتوغرافية حقيقية** (طلب «أسطح واقعية بالكامل» اكتمل): 8 صور CC0 من ambientCG في `public/textures/` (المصادر في SOURCES.txt) طبقة سفلية تحت تدرجات الإضاءة نفسها في dishprops.css — selector مزدوج واحد يرقّي الطاولة وأسطح الأطباق معاً؛ فشل التحميل يرجع للتدرجات وحدها. (تحسين مؤجل: ضغط webp حين يتوفر sharp.)
9. **مود البانر**: bannerFilter/bannerBlend/bannerTint+Amount تُقرأ في MenuView (صورة وفيديو) + عناصر تحكم في بطاقة البانر تعيد استعمال FILTERS/BLEND_MODES (تذكير: البانر لا يظهر في editorial).
10. **شكر + تقييم عند الدفع**: حالة paid انضمت للإشعارات — واتساب (سطر حر بعد القالب داخل نافذة 24س) وإيميل بزر «قيّمنا على خرائط جوجل» من حقل `tenant.googleMapsUrl` الجديد (حقل في الإعدادات/الهوية) + `msgTemplates.thankYou` لنص مخصص — **نُشرت**.

**جلسة 2026-07-22 الرابعة — «الجولة الكبرى» (11 محوراً دفعة واحدة، أوركسترا 33 وكيلاً: استقصاء+تحقق عدائي+معماري ثم 10 منفّذين بملكية ملفات صارمة):**
كل صف جديد في جدول §1 أعلاه بُني هذه الجلسة: نظام الظلال الكامل، أحبار الوضعين مع القفل التلقائي، إمالة v2 (غلاف يصلح جودة الصورة + fx ملتصق + ظل ملامسة)، الطاولة v3 (ذوبان سفلي/حجاب/امتداد لأسفل النافذة/تحكم مساحة الهيرو)، melt البانر الشفاف + film المميزة + وضع الغرفة (جدار واحد خلف الصفحة)، ترتيب كتل الصفحة بالسحب، كساء الكروم الموحد (6 عناصر + الشيتات + 6 صفحات فرعية + أيقونات مخصصة للتواصل/السلة/الجرس/اللغة/الثيم)، قصّ الفيديو في 7 مواضع تخزين، المعاينة الجانبية الحية في محرر الصنف (لوح/درج) عبر مغلف postMessage موحد، مولد 3D عاد للواقعية، والطلب بالصورة (رفع من الاستوديو + تصغير) والصوت (Gemini سحابي متعدد اللهجات مع حصص) عبر `dinerOrderAi`.
**تغييرات سلوك مقصودة (data-driven لا opt-in):** (1) منشآت الجدران المفعّلة لم تعد تنقلب كريميّاً في الفاتح (القفل؛ `followTheme` يعيد القديم)؛ (2) افتراضي 3D صار صورة واحدة واقعية؛ (3) رقاقات التجارب تلبس كساء الأزرار على editorial متى ما وُجد menuButtons وتظهر في معاينة الاستوديو (بنقرات معطّلة)؛ (4) الهيدر الطوبي يحترم `menuHeader.scrim` المحفوظ (مشدود 0.35-0.9)؛ (5) شريط OrderStatus يعرض المنشأة الحقيقية وهيدر VenueProfile صار DinerBar؛ (6) `/preview/:slug` يحفظ ثيمه في `ml.theme.menu` لا مفتاح الإدارة.
**جولة إصلاح الظل (نفس اليوم، `7de19d8`، نُشرت hosting+storage):** شكوى «الظل» شُخّصت بالبيانات الحية لا بالتخمين — (1) طبقات القراءة في EdtTable (ذوبان/ذوبان سفلي/حجاب/تعتيم) **مثبتة على اللوح** الآن بينما الأثاث (art+tint) والحافة+التماس يركبون التحويل الحر في غلافي `.edt-table-free` متطابقين: مدّ h=250 كان يسحب الذوبان خارج اللوح فيغرق النص في slab مادة صماء؛ (2) قرص `menuTable.textPad` (ضمن TABLE_STAGE_KEYS، `--tbl-textpad` على `.edt-stg-body`) يمنع الطبق المُنزَل بعمق من دفن اسم الصنف؛ (3) زر «أزل كل الظلال» صار يصفّر أيضاً `menuWall.vignette` + `menuTable.contact` (القاعدة والمسرح) + `menuSections.fade` في حفظة واحدة، والثلاثة منزلقات ضيفة داخل بطاقة الظلال (نفس الكتّاب، نفس التخزين)؛ (4) رفع glb كان يفشل: Windows يبلّغ type فارغاً → fileKind يعدّه صورة بحد 10MB — صنف `model` جديد في storage.js (glb/usdz، حد 60MB، contentType صريح) + فرع `isModel()` في storage.rules لمسار library + رسالة خطأ تحمل الكود الفعلي؛ (5) بيانات صاج السمك الحية: `menuWall.vignette=0` و`menuTable.stage.textPad=96` كُتبتا مباشرة في Firestore. **حقيقة بيانات مهمة:** 54 من 56 صنفاً بلا صور أصلاً (بلطي وكريم كراميل فقط) — الفراغ الطوبي الضخم في القائمة هو أقسام 92svh لأصناف بلا صور، لم يُغيَّر عمداً (المالك يعرف ولم يطلب).
**ملاحظات تقنية مثبتة:** `--dish-persp` لكل سطح (قائمة 1000px/مسرح 1700px/سطح المكتب 1700px/كانفسات المحرر محسوبة)؛ iOS<16.2 بلا color-mix يفقد الظلال المُدارة بدل العودة للحرفي (نفس فئة فشل اللوح المشحون سابقاً — ~12 إعلاناً لو أراد أحد لفّها بـ@supports)؛ خلفية nav المكسوّة تستعمل !important لتغلب preset الكروم؛ ارتفاعات `.menu-hero-media` منسوخة من قواعد الغلاف (140/190/250) — تغيير ارتفاع البانر يحرّر الموضعين؛ ماسح الانحراف الجديد `scan-drift.mjs` (scratchpad الجلسة) يغطي 17 كائن RANGE.

## 5. حالة القنوات (واتساب/إيميل/AI)

- **الإيميل:** يعمل. نطاق rbt360sa.com موثّق في Resend، المرسِل `notification@rbt360sa.com` (يصل ردّه للمالك عبر توجيه Cloudflare). قالب HTML جداول+UTF-8 صريح.
- **واتساب:** القناة مثبتة عبر رقم Meta التجريبي لكن **الرمز المؤقت انتهى**. قالبان عربيان قُدّما: `rbt360_order_update` (3 متغيرات) و`rbt360_order_status` (5: اسم العميل/المنشأة/الرقم/الحالة/الإجمالي) — **افحص حالتهما** (كانا PENDING). للإنتاج: System User دائم بصلاحيتَي whatsapp_business_* + رقم مخصّص + تبديل `WA_TEMPLATE_ORDER_UPDATE=rbt360_order_status` و`WA_LANG=ar` ثم نشر `onOrderCustomerNotify`. **الرمز الدائم لا يُلصق في المحادثة** — المالك يضعه في `functions/.env`.
- الشيفرة تمرّر اسم العميل والإجمالي وجدول أصناف مختصراً (بحارس waParam ضد الفراغ/الأسطر).
- **المساعد:** يعمل (flash حي، deep على `gemini-pro-latest`، PDF مرقمن بميزانية حجم ~3.6MB).
- WABA id: `1995852554340731`. مفاتيح Meshy/Gemini/Moyasar(TEST)/Resend في `functions/.env` (gitignored).

## 6. المعلَّق — بالترتيب المقترح للجلسة القادمة

1. **تحقق ما بعد نشر الجولة الكبرى** (قائمة wave-4 المعمارية): (أ) مسارات بلا تخصيص مطابقة بكسلياً؛ (ب) بطاقة الظلال تمحو حزام الطاولة (tableEdge=0 + contact/vignette 0 + tableTop 0.6)؛ (ج) تبديل الفاتح يبقي الأحبار داكنة على جدار الصورة؛ (د) extend يلامس شريط الإضافة بلا فائض 18px؛ (هـ) صنف مائل + بخار يبقى ملتصقاً قائمةً ومسرحاً وسطح مكتب؛ (و) وضع الغرفة يوحّد المناطق الثلاث؛ (ز) صورة incognito + مقطع لهجة خليجية → أصناف تصل + عدّاد `counters/dinerAi-YYYY-MM` يُكتب (الحصة هي الحائط الوحيد أمام فاتورة Gemini)؛ (ح) توليد Meshy واقعي واحد لكريم كراميل قبل أي batch (قد يحتاج رفع `ar3dMonthly` من كونسول المنصة)؛ (ط) قصّ بانر/قصة/خلفية يدور نافذته على iPhone (autoplay صامت)؛ (ي) لوح المحرر يحدّث ≤100ms والدرج يبدأ مطوياً؛ (ك) سحب الترتيب يحرك الكتل حياً؛ (ل) تثبيت الفاتح في الاستوديو لا يقلب ثيم الإدارة بعد reload؛ (م) لا بقايا `--chrome-*/--mch-*` على body بعد منيو→/admin؛ (ن) منشأة بلا جدار + جولة فاتح (مسارات bars التي لا تمرّ بها صاج السمك)؛ (س) الميزات الجديدة فوق شبكة RTL كاملة.
2. **مود `appBg`/`immersiveBg`** (فلتر/دمج/صبغة كما أخذ البانر) — لم يشمله هذا الراوند (القص فقط).
3. ~~معاينة جانبية~~ **تم لمحرر الصنف** (لوح + درج). استوديو Settings الضيق ما زال مكدساً — درج مشابه إن اشتكى.
4. **انزياح مرساة المسرح** ~7-9% بين محرّر الطبقات والمنيو على الجوال — وحّد المرساة إن اشتكى.
5. **إنتاج واتساب** (أعلاه) + قرار المالك في مفاتيح Moyasar الحية + إبطال رمز CI المسرّب (قديم ومازال معلقاً).
6. تحسينات مؤجّلة موثّقة: ضغط خامات public/textures إلى webp، ضغط نسيج المجسّم، فيديو خلفية iOS autoplay غير مُجرَّب، حدّ سطوع طاولة/جدار فاتحين، «صور بارزة» (embossed)، مفاتيح إظهار/إخفاء لعناصر نافذة الصنف (سعرات/تحضير/مكونات…)، لفّ الإعلانات الـ~12 المُدارة بـ@supports لعودة iOS<16.2 للحرفي، تنظيف CSS الميت `.dcx-*` في appearance.css، قصّ `posBg`/PinLock (طرف الموظفين — لو قصد المالك «كل مكان» حرفياً)، chips لكل سطر في تأكيد الصوت المتعدد، `--dish-persp` لمنطقة dish-detail في الثيمات غير editorial، أداة menuHome/menuChrome للمساعد ضمن جولة أدواته العشرين.
8. **ملاحظة توافق الثيمين**: أحبار الوضعين (menuInk) حلّت النصف editorial+الشريطين؛ الثيمات غير editorial فوق خلفيات مخصصة ما زالت على الانقلاب العام — الطلب الأعم «نفس التصميم فاتحاً وداكناً لكل تخصيص» ما زال جولة خاصة.

## 7. سياسات تصميم مقرَّرة (لا تُنقض بلا سبب)

- **الواقعية من صور المالك المفرّغة، لا من رسم متجهي** — الرسوم حُذفت نهائياً بعد رفضه لها.
- كل زخرفة **opt-in** والافتراضي مطفأ؛ لا قرار جمالي يُتّخذ عنه.
- الطوب = البناء، الكهرماني = الضوء (الأسعار/العروض).
- «معلّق» يتأرجح من حافته **العليا** وإلا بدا ملصقاً.
- منيو الزبون مفصول عن ثيم النظام (شاشات الموظفين) — الفصل موثّق في `systemThemes.js`، لا يُعاد ربطه.
- لا شريط تمرير مرئي إطلاقاً؛ لا إيموجي؛ أرقام لاتينية فقط (`ar-SA-u-nu-latn`).
- الميلت في الطاولة/الجدار هو **ضمانة القراءة** — أي تعديل عليه يجب أن يحافظ على 4.5:1 للنص.

## 8. حقول Firestore الجديدة هذه الجلسة (كلها على مسار updateTenant/saveItem المسموح للمدير)

`tenant`: menuWall (+`panel` +`vignette` +**`room`**), menuSections, menuDecor (+`depth` لكل قطعة), menuTable (+`x/y/w/h/dim/melt` +**`meltBottom/veil/extend/heroPad/heroMax`** +`stage{}` جزئي), menuHeader, menuButtons (+`scope/shape/imgScale/imgX/imgY`), chromeTheme, elementLibrary, `googleMapsUrl`, `bannerFilter/bannerBlend/bannerTint/bannerTintAmount`, `msgTemplates.thankYou`, `skin.overrides.hidden` (+`welcome`), و**من الجولة الكبرى**: `menuShadows{8}`, `menuInk{followTheme,light{},dark{}}`, `bannerMelt/bannerMeltLen/bannerScrim/featuredFilm` (أيضاً داخل لقطات customThemes), `menuHome{order[]}`, `menuChrome{follow,elements{6},socialIcons{},sheet{},pages{6}}`, `voiceAiEnabled` (**`=== true` حصراً**), `dinerAiMonthly` (0 صريح يعطّل), `bannerVideoTrim/bgVideoTrim/immersiveBgVideoTrim` (+داخل customThemes), `appBg.trim` (متداخل).
`item`: layers, layersOff, surface, props, contactShadow, reflect, وكل حقول التركيب (bg*/image*/list*/shadow*/effect/anim) + `imageTilt`/`listTilt` + **`tiltContact`** + **`bgVideoTrim`** (عبر composePayload) + `videoTrim` (محرك فقط). `story`: **`trim`**.
لم تُضف قواعد جديدة — كلها تمرّ ضمن مسارات updateTenant/saveItem/addStory القائمة. تُكتب من الدوال فقط (admin SDK): `aiImageJobs`، **`counters/dinerAi-YYYY-MM`**، وar3dJobs كسبت `mode`+`views`.
دوال: `imageTo3d` (معاد بناؤها — `multiView`/`smooth`، الافتراضي واقعي بصورة واحدة)، `generateTableImage`، **`dinerOrderAi` جديدة** (غير موثّقة، حصص شهرية/دقيقة عبر transaction). النشر: الدوال **أولاً** ثم hosting (حارس multiView هو ما يجعل عملاء SPA المخزَّنين آمنين).
