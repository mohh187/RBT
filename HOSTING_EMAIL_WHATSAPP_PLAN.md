# 🌐📧💬 النطاقات المخصّصة + الإيميل + إشعارات واتساب — بحث وتنفيذ

**التاريخ:** 2026-07-04 · **البناء:** ناجح. هذه الوثيقة تشرح **كيف ننفّذ** الثلاثة، وما بُني فعلاً، وما تحتاج إعداده خارجياً.

---

## الجزء الأول: نطاق/رابط خاص لكل منشأة (حسب الباقة)

### الفكرة
- **الباقة المجانية:** تبقى على النطاق العام لشركتنا: `menulink.app/m/اسم-المنشأة` (يظهر اسمنا).
- **الباقات المتقدمة (احترافي/متكامل):**
  - **نطاق فرعي لنا:** `اسم-المنشأة.menulink.app`.
  - **نطاق المنشأة الخاص:** `menu.مقهاهم.com` (نطاقهم هم).

### التحدّي التقني
كل المنشآت تعمل حالياً من **نطاق واحد** عبر توجيه Firebase Hosting (`** → index.html`)، وتُميَّز بالمسار `/m/slug`. لجعل كل منشأة على **نطاق مستقل** نحتاج شيئين لكل نطاق: **توجيه DNS** إلى منصّتنا، و**شهادة SSL** لذلك النطاق. المشكلة أن Firebase Hosting:
- يتطلّب إضافة كل نطاق مخصّص **يدوياً** مع تحقق TXT، ولا يوجد API للأتمتة، وله حدود عملية → لا يصلح لمئات النطاقات.

### الخيارات المدروسة

| الطريقة | كيف | ملاءمة للتوسّع | التكلفة |
|---|---|---|---|
| **أ. مسار فقط (الحالي)** | `menulink.app/m/slug` | ممتازة | مجاناً |
| **ب. نطاقات فرعية `*.menulink.app`** | DNS wildcard + شهادة wildcard على واجهة أمامية (Cloudflare) | ممتازة | منخفضة |
| **ج. نطاقات المنشآت الخاصة (الموصى بها للتوسّع)** | **Cloudflare for SaaS (Custom Hostnames / SSL for SaaS)** — تُصدر شهادة لكل نطاق تلقائياً عبر API وتوجّه لمصدرنا (Firebase) | ممتازة (مئات/آلاف النطاقات) | ~رمزية لكل نطاق |
| د. Firebase custom domains يدوياً | تحقق يدوي لكل نطاق | ضعيفة | مجاناً لكنها لا تتأتمت |

### المعمارية الموصى بها (Cloudflare for SaaS)
1. نطاقنا `menulink.app` على Cloudflare مع تفعيل **SSL for SaaS**.
2. عند تفعيل نطاق لمنشأة: نستدعي **Cloudflare API** لإنشاء «Custom Hostname» (يُصدر SSL تلقائياً)، وتوجّه Cloudflare الطلب إلى **مصدر Firebase Hosting** الخاص بنا.
3. المنشأة تضيف عند مزوّد نطاقها سجل **CNAME** يشير إلى نقطة توجيه Cloudflare (نعطيهم القيمة).
4. التطبيق يقرأ `window.location.hostname`؛ إن لم يكن نطاقنا → يبحث في مجموعة `domains/{host}` عن المنشأة ويعرض منيوها **في جذر النطاق**.

### ✅ ما بُني الآن (كود يعمل — الأساس كامل)
- **حلّ النطاق** [src/lib/domains.js](src/lib/domains.js): `isPlatformHost` + `resolveHostVenue` (يقرأ `domains/{host}` العامة).
- **العرض في الجذر** [App.jsx](src/App.jsx): مسار `/` صار `RootRoute` — على نطاق منشأة يعرض منيوها مباشرةً (`PublicMenu slug=...`)، وعلى نطاقنا يعرض الصفحة التعريفية. (أضفت دعم `slug` كخاصية في [PublicMenu](src/routes/menu/PublicMenu.jsx).)
- **مجموعة `domains`** + قواعدها في [firestore.rules](firestore.rules): قراءة عامة (لحلّ المنيو)، والمدير **يطلب** فقط (pending)، و**التفعيل من المنصة حصراً** (منع اختطاف النطاقات).
- **شاشة إدارة** [/platform/domains](src/routes/platform/Domains.jsx): ربط نطاق/نطاق فرعي بأي منشأة وتفعيله/تعطيله. (طبقة البيانات [platformDomains.js](src/lib/platformDomains.js).)

### يتبقى عليك (بنية خارجية)
1. حساب **Cloudflare** لنطاق `menulink.app` + تفعيل **SSL for SaaS** + إنشاء **API Token** و**Zone ID** (أضفتُ `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID` في `functions/.env`).
2. **DNS wildcard** `*.menulink.app` للنطاقات الفرعية.
3. (اختياري لاحقاً) دالة `provisionCustomDomain` تستدعي Cloudflare API لأتمتة إصدار الشهادة عند التفعيل — الآن الربط **يدوي** من الشاشة (يعمل بمجرد جاهزية DNS/SSL).
4. اربط الميزة بالباقة: أضِف `customDomain` إلى `FEATURE_MIN` في `lib/plans.js` (Pro+) واحجب طلب النطاق لغير المؤهّلين.

---

## الجزء الثاني: نظام إيميلات متقدّم (Resend)

### القرار
نعيد استخدام **Resend** — نفس مزوّد wbs (المفتاح الحقيقي `re_…` نُسخ إلى `functions/.env`، غير متتبّع بـ git). Resend ممتاز للرسائل المعاملاتية، دعم نطاقات مرسِل موثّقة، وواجهة بسيطة.

### ✅ ما بُني الآن ([functions/messaging.js](functions/messaging.js))
- `sendEmail({to,subject,html})` عبر Resend + قالب HTML عربي RTL جاهز (`emailShell`).
- **تريجر ترحيب:** `onVenueWelcomeEmail` يرسل بريد ترحيب لمالك المنشأة عند إنشائها (مع رابط منيوه).
- **إيصال للعميل:** ضمن تريجر إشعار الطلب — إذا حمل الطلب بريد العميل، يصله إيميل بحالة الطلب.
- الدوال المساعدة متاحة لبقية دوال الخادم (يمكن ربط إيصالات الفواتير/الاشتراك بها لاحقاً).

### يتبقى عليك
1. **توثيق نطاق المرسِل** في لوحة Resend (SPF/DKIM) واضبط `EMAIL_FROM=MenuLink <no-reply@نطاقك>` في `functions/.env`. (نطاق wbs `webringcn.com` — استخدم نطاقك أو نطاقاً منفصلاً.)
2. أعِد نشر الدوال بعد ضبط المفتاح/النطاق (v2 تخبز env عند النشر).

### توسّعات مقترحة (سهلة على نفس الأساس)
إيصالات الطلبات/الفواتير الضريبية (ZATCA QR كما في wbs)، تقارير مجدولة بالبريد، تذكيرات التجديد، دعوات الموظفين، ملخّص أسبوعي للمنشأة.

---

## الجزء الثالث: إشعارات واتساب للعملاء (Meta Cloud API)

### القرار
المزوّد الأوضح هو **واتساب Business Cloud API من Meta** (نفس ما هُيّئ له wbs عبر `WA_PHONE_NUMBER_ID`/`WA_ACCESS_TOKEN`، لكنه لم يُملأ). رسمي، الأرخص عند التوسّع، ودعم عربي كامل. (بدائل: Twilio أسهل وأغلى، أو مزوّد محلي كـ Unifonic.)

### قيد مهم يجب فهمه
واتساب **يمنع** إرسال رسالة حرة لعميل لم يراسلك خلال 24 ساعة — يجب استخدام **قالب مُعتمَد مسبقاً** (Utility Template). لأن العميل يطلب عبر الويب (لا يبدأ محادثة واتساب)، فكل تحديثات الطلب **يجب أن تُرسَل عبر قالب معتمد**. (الموافقة تستغرق دقائق–ساعات من Meta.)

### ✅ ما بُني الآن ([functions/messaging.js](functions/messaging.js))
- `sendWhatsAppTemplate(to, template, lang, [params])` + `sendWhatsAppText` (للنافذة 24 ساعة/التجربة) + تطبيع الأرقام السعودية (`05x`/`5x` → `9665x`).
- **تريجر `onOrderCustomerNotify`:** عند تغيّر حالة الطلب (مقبول/تحضير/جاهز/مقدَّم/ملغى/مسترجع) يرسل للعميل على واتساب رسالة قالب (المتغيرات: اسم المتجر، رقم الطلب، الحالة)، مع بريد إن توفّر. يحترم إعداد المنشأة `customerNotify` (تعطيل القناة).
- fail-soft: بدون توكن/قالب لا يتعطّل شيء — تُتخطّى الإرسالة.

### يتبقى عليك
1. أنشئ **Meta Business + WhatsApp Business Account** ورقم مرسِل، واحصل على `WA_PHONE_NUMBER_ID` و`WA_ACCESS_TOKEN` (توكن دائم)، وضعهما في `functions/.env`.
2. أنشئ قالب **Utility** باسم `order_update` بثلاثة متغيرات `{{1}} {{2}} {{3}}` (المتجر، رقم الطلب، الحالة) بالعربية واعتمده، واضبط `WA_TEMPLATE_ORDER_UPDATE=order_update`.
3. أعِد نشر `onOrderCustomerNotify`.
4. الموافقة/الخصوصية: العميل يعطي رقمه عند الطلب (موافقة ضمنية لتحديثات الطلب — تتوافق مع PDPL وسياسة واتساب). يُفضّل إضافة خيار إلغاء الاشتراك.

### توسّعات
تأكيد الحجز، جاهزية الطلب مع رابط التتبّع، عروض للأعضاء (قوالب تسويقية مختلفة تتطلب موافقة العميل الصريحة)، ردود آلية عبر webhook واتساب.

---

## الملفات التي أُضيفت/عُدّلت
```
جديد:  functions/messaging.js            (Resend + Meta WhatsApp + تريجرا الإشعار والترحيب)
عُدّل:  functions/index.js               (تسجيل التريجرين)
عُدّل:  functions/.env / .env.example     (RESEND_API_KEY, WA_*, EMAIL_FROM, CLOUDFLARE_*)
جديد:  src/lib/domains.js                (حلّ النطاق → منشأة)
جديد:  src/lib/platformDomains.js        (إدارة مجموعة domains)
جديد:  src/routes/platform/Domains.jsx   (شاشة النطاقات) + مسار + تنقّل
عُدّل:  src/App.jsx                       (RootRoute للنطاقات المخصّصة)
عُدّل:  src/routes/menu/PublicMenu.jsx    (دعم slug عند الجذر)
عُدّل:  firestore.rules                   (مجموعة domains)
```

## خطوات النشر
```
firebase deploy --only functions,firestore:rules
npm run deploy:hosting
```
ثم اضبط: مزوّد الإيميل (Resend domain)، توكنات واتساب + القالب، وCloudflare/DNS للنطاقات — كلٌّ يستلزم إعادة نشر الدوال المعنية لالتقاط env.

---

## ملحق (2026-07-07): Cloudflare for SaaS — خطوة بخطوة

> الاسم التجاري أصبح **rbt360** والنطاق **`rbt360.sa`** (قيد الموافقة). استبدل `rbt360.sa` أدناه بنطاقك عند الجاهزية.
> الأساس البرمجي جاهز: `PLATFORM_APEX`/`DOMAIN_CNAME_TARGET` (env)، مجموعة `domains`، بطاقة الطلب في الإعدادات، حلّ النطاق في `RootRoute`.

**الفكرة:** المصدر واحد (Firebase Hosting `menu-88996.web.app`). Cloudflare أمامه يتولّى SSL لنطاقات العملاء ويوجّه إلى Firebase. المتصفح يبقى على نطاق العميل، والتطبيق يقرأ `location.hostname` → `domains/{host}` → منيو المنشأة.

### الجزء أ — إعداد المنصة (مرة واحدة)
1. **أضِف `rbt360.sa` إلى Cloudflare** وغيّر Nameservers عند المسجّل حتى تصبح الحالة Active.
2. **SSL/TLS → Custom Hostnames**: فعّل SSL for SaaS (حصة مجانية ثم رسم رمزي/نطاق). واجعل وضع SSL/TLS = **Full**.
3. **Fallback Origin:** أنشئ `origin.rbt360.sa` → CNAME → `menu-88996.web.app` (DNS only/رمادي)، وعيّنه Fallback origin.
4. **تصحيح Host إلى Firebase (أهم خطوة):** Firebase يخدم حسب Host. الحل:
   - **Worker (الأفضل):** يعيد الجلب من `menu-88996.web.app` بترويسة Host ثابتة:
     ```js
     export default { async fetch(request) {
       const url = new URL(request.url); url.hostname = 'menu-88996.web.app'
       const req = new Request(url, request); req.headers.set('Host', 'menu-88996.web.app')
       return fetch(req)
     }}
     ```
   - **أو Origin Rules (بلا كود):** Override → Host header = `menu-88996.web.app`.
5. **النطاقات الفرعية `*.rbt360.sa`:** DNS `*` → CNAME → `menu-88996.web.app` (proxied) + Advanced Certificate Manager لشهادة `*.rbt360.sa`. فيعمل `اسم-المنشأة.rbt360.sa` بلا إعداد من العميل.
6. **نطاق المنصة:** `rbt360.sa` و`app.rbt360.sa` → Firebase (في `PLATFORM_HOSTS`، يعرضان الصفحة التعريفية).
7. **API Token + Zone ID:** Token بصلاحيات *SSL and Certificates: Edit* و*DNS: Edit* لنطاق rbt360.sa فقط + Zone ID → `functions/.env` (`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`). واضبط `VITE_PLATFORM_APEX=rbt360.sa` و`VITE_DOMAIN_CNAME_TARGET=connect.rbt360.sa`.

### الجزء ب — نطاق منشأة خاص (لكل منشأة)
1. المنشأة تطلبه من الإعدادات ← التكاملات ← الربط الفني → `domains/{host}` بحالة pending.
2. تضيف عند مسجّلها: `menu.مقهاها.com` → CNAME → `connect.rbt360.sa` (توجيه + إثبات ملكية).
3. تنشئ المنصة Custom Hostname عبر API:
   ```
   POST https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/custom_hostnames
   Authorization: Bearer {CLOUDFLARE_API_TOKEN}
   { "hostname": "menu.مقهاها.com", "ssl": { "method": "http", "type": "dv" } }
   ```
4. متابعة `GET /custom_hostnames/{id}` حتى `status:active` + `ssl.status:active` → علّم `domains/{host}.status='active'` (زر التفعيل في /platform/domains). زر «فحص DNS» في بطاقة المنشأة يؤكّد قبلها.
5. جاهز: `https://menu.مقهاها.com` → Cloudflare(SSL) → Host مصحّح → Firebase → التطبيق → منيو المنشأة.

### الجزء ج — الأتمتة (اختياري)
دالة `provisionCustomDomain` في functions/ تنفّذ خطوتَي 3–4 آلياً وتحدّث `domains` عند جاهزية SSL. تحتاج فقط ضبط توكن/Zone.

### ملاحظات
- الوضع **Full** إلزامي (لا Flexible). التكلفة: حصة مجانية ثم رسم رمزي لكل نطاق — تحقّق من التسعير.
- بديل مبسّط بلا Cloudflare: نطاقات Firebase المخصّصة يدوياً (تحقّق TXT لكل نطاق) — لعدد قليل فقط.
