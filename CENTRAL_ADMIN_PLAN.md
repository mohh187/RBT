# 🏛️ لوحة التحكم المركزية للمنصّة — Central Platform Console

**الإصدار:** 1.2 · **التاريخ:** 2026-07-03
**الحالة:** المراحل 1–3 **كاملة** + معظم المرحلة 4 (الدخول كمالك + البث العام) **منفّذة في الكود** — تحتاج خطوات نشر وتفعيل (§9)

---

## 1. الرؤية

صفحة مستقلة **خاصة بنا** (أصحاب المنصة) على المسار `/platform` تراقب وتتحكم في **كل منشأة مسجّلة**:

- كل بياناتها: المبيعات، الطلبات، الموظفون، العملاء، الشكاوى، المخزون.
- متابعة لحظية: سجل نشاط مركزي لكل إجراء وتحديث وخطوة تقوم بها أي منشأة.
- نظام إشعارات قوي (3 طبقات): سجل حي + تنبيه صوتي/نظامي داخل الوحدة + Push للجوال حتى والتطبيق مغلق.
- نافذة دردشة مباشرة مع كل منشأة (الطرفان يستلمان إشعارات).
- مراقبة كود النظام: أي خطأ يقع على جهاز أي مستخدم (موظف أو زبون) يُلتقط تلقائياً ويصل للمنصة.
- تذاكر مشاكل لكل منشأة مع حالات معالجة.
- **تحكم كامل في الحسابات**: إيقاف/تفعيل أي منشأة، تعديل أي بياناتها، والتحكم الكامل في **الباقات والاشتراكات** (الباقة، الحالة، تاريخ الانتهاء).

---

## 2. خلاصة فحص البنية الحالية

| الجانب | الواقع |
|---|---|
| العزل | كل بيانات المنشأة تحت `tenants/{tid}/...` (26+ مجموعة فرعية)، لا يوجد `tenantId` كحقل |
| الجذور | 4 مجموعات فقط: `users`, `tenantSlugs`, `staffInvites`, `tenants` |
| الأدوار | حقل `role` في `users/{uid}` (وليس custom claims) + مصفوفة صلاحيات `permissions.js` |
| القواعد | `firestore.rules` تعزل المستأجرين بصرامة (`isMember/isManager`) — **لم يكن** فيها أي مسار سوبر أدمن |
| الباقات | `lib/plans.js` جاهز (menu/ops/pro/enterprise + `planAllows`) لكن **غير مُنفَذ** — الافتراضي enterprise |
| المستمعات | كل الـ 36 `onSnapshot` مركزية في `lib/db.js` وكلها أحادية المستأجر |
| الدوال | 6 دوال (تحقق الطلب، FCM للموظفين، ملخص يومي، نقص مخزون، بروكسي Gemini، تحقق الحضور) — الدوال المجدولة تمر أصلاً على كل `tenants` (سابقة جاهزة للتجميع العابر) |
| المراقبة | **لا يوجد** أي error logging / analytics |
| ثغرة | `purchaseOrders` و`supplierPayments` كانتا بلا قواعد (fail-closed) — **أُصلحت الآن** |

**القرار المعماري:** صلاحية المنصة عبر وجود وثيقة `platformAdmins/{uid}` (تُنشأ يدوياً من Firebase Console فقط — الكتابة من العميل مرفوضة كلياً)، مع قاعدة wildcard تمنح مدير المنصة قراءة/كتابة كاملة على `tenants/**`. هذا يعيد استخدام كل طبقة `db.js` الحالية في وحدة التحكم بلا تكرار (نمرر أي `tid`).

---

## 3. نموذج البيانات الجديد (Top-level)

```
platformAdmins/{uid}        → { name, email }              // العضوية = وجود الوثيقة
platformActivity/{id}       → { tenantId, tenantName, kind, severity, title, body,
                                amount?, orderStatus?, ref?, at }   // تكتبها الدوال فقط
platformErrors/{id}         → { message, stack, kind(error|promise), url, ua,
                                tenantId?, tenantName?, uid?, status(open|resolved), at }
platformIssues/{id}         → { tenantId, tenantName, title, body, priority(low|normal|high|urgent),
                                status(open|inProgress|resolved), createdBy, createdByName, createdAt }
platformChats/{tid}         → { tenantId, tenantName, lastText, lastFrom, lastAt,
                                unreadByPlatform, unreadByVenue }
platformChats/{tid}/messages/{id} → { from(platform|venue), uid, name, text, at }
platformPushTokens/{token}  → { token, uid, ua, at }
platformStats/{YYYY-MM-DD}  → { date, tenants, activeTenants, orders, revenue, byTenant{tid:{name,orders,revenue,currency}} }
```

**حقول جديدة على `tenants/{tid}` (ملكية المنصة حصرياً):**
`plan`, `planStatus (active|trial|expired)`, `planExpiresAt`, `active` (كان موجوداً), `suspendReason`, `platformNote` — القواعد **تمنع** مدراء المنشأة من لمسها (`diff().affectedKeys().hasAny(...)`) وتمنع تمرير بعضها عند الإنشاء، ولا يمكن تغيير `ownerUid`.

**أنواع النشاط (`kind`):** `tenant` تسجيل منشأة · `order` طلب/تحول حالة · `complaint` شكوى · `staff` تعيين/تعديل/حذف موظف · `settings` تعديل إعدادات (مع أسماء الحقول) · `subscription` تغيير باقة/إيقاف · `chat` رسالة · `error` خطأ نظام · `issue` تذكرة.

---

## 4. الأمان (`firestore.rules`) — ما نُفّذ

1. `isPlatformAdmin()` = وجود `platformAdmins/{uid}`.
2. `match /tenants/{tid}/{document=**} { allow read, write: if isPlatformAdmin(); }` — وصول كامل للمنصة لكل المجموعات الفرعية (القواعد المتداخلة تعمل بمنطق OR).
3. جذر المنشأة: تحديث المدراء مسموح **إلا** حقول الاشتراك/الإيقاف؛ منح المنصة update/delete.
4. `users`: قراءة/تحديث/حذف للمنصة (دعم فني: إصلاح ربط دور/منشأة).
5. مجموعات المنصة أعلاه بقواعدها (feed كتابة دوال فقط، أخطاء create عام مقيّد الحجم، تذاكر ودردشة مشروطة بـ`isManager(tid)`).
6. إصلاح `purchaseOrders` + `supplierPayments`.

**ملاحظة تكلفة:** `exists()` تُقيَّم فقط عند الحاجة وتُخزَّن مؤقتاً لكل طلب — لا أثر يُذكر على مستخدمي المنشآت العاديين.

---

## 5. الدوال السحابية — ما نُفّذ (functions/index.js)

| الدالة | المشغّل | الوظيفة |
|---|---|---|
| `pushToPlatform` (helper) | — | FCM لكل أجهزة `platformPushTokens` + تنظيف التوكنات الميتة |
| `logActivity` (helper) | — | إلحاق حدث في `platformActivity` مع اسم المنشأة |
| `onTenantCreated` | create `tenants/{tid}` | 🏪 منشأة جديدة → feed (high) + push |
| `onTenantUpdated` | update `tenants/{tid}` | تغييرات الحقول → feed؛ باقة/إيقاف → (high) |
| `onOrderActivity` | create `orders` | 🧾 كل طلب → feed **مع مبلغه** (`amount`) — أساس نبض «اليوم» المباشر |
| `onOrderStatusActivity` | update `orders` | 💰/✅/🚫/↩️ تحولات paid/served/cancelled/refunded |
| `onComplaintActivity` | create `complaints` | 📣 شكوى → feed (high) + push |
| `onStaffActivity` | write `staff/{uid}` | 👤 تعيين/حذف/تغيير دور |
| `onErrorReported` | create `platformErrors` | 🐞 → feed (high) + push فوري |
| `onIssueCreated` | create `platformIssues` | 🛠️ → feed (high) + push |
| `onPlatformChatMessage` | create `messages` | تحديث meta الخيط + عدادات غير المقروء + push للطرف الآخر (منشأة→منصة أو منصة→موظفي المنشأة على `/admin/support`) |
| `platformDailyRollup` | جدولة 23:55 | تجميع يومي عابر للمنشآت → `platformStats/{date}` |
| `subscriptionSweep` | جدولة 03:00 | `planExpiresAt` منقضٍ → `planStatus='expired'` + إشعار الطرفين |
| `platformImpersonate` | onCall | يتحقق أن المستدعي مدير منصة → يصدر Custom Token لمالك المنشأة (دخول دعم فني، مسجَّل في السجل) |
| `onPlatformBroadcast` | create `platformBroadcasts` | يوزّع الإعلان على لوحة إعلانات كل منشأة (مع فلترة بالباقة) + Push اختياري + يسجل عدد الواصلين |
| `weeklyPlatformReport` | جدولة الأحد 09:00 | ملخص 7 أيام (مبيعات/طلبات/منشآت/خاملة) → Push للمنصة |
| `activityCleanup` | جدولة شهرية | حذف `platformActivity` الأقدم من 60 يوماً + الأخطاء المحلولة الأقدم من 30 يوماً |

---

## 6. نظام الإشعارات القوي — 3 طبقات

1. **السجل الحي (feed):** كل حدث في `platformActivity` يظهر لحظياً في الوحدة (onSnapshot) — شاشة «النشاط» بفلاتر (منشأة/نوع/أهمية).
2. **داخل الوحدة:** `PlatformLayout` يراقب آخر الأحداث؛ أي حدث `severity: high` جديد → صوت + اهتزاز + Web Notification (`alertParty`). شارة عدّاد رسائل غير مقروءة على أيقونة الدردشة.
3. **Push (FCM):** زر «تفعيل إشعارات الجهاز» يسجّل التوكن في `platformPushTokens` — تصل الإشعارات حتى والتطبيق مغلق: منشأة جديدة، شكوى، خطأ نظام، تذكرة، رسالة دردشة، اشتراك منتهٍ.

---

## 7. مراقبة الكود (`src/lib/monitor.js`) — ما نُفّذ

- يُثبَّت عالمياً في `main.jsx`: يلتقط `window.onerror` + `unhandledrejection` من **كل** أجهزة كل المنشآت (موظفين وزبائن).
- Dedup لكل رسالة + سقف 15 تقريراً للجلسة (حماية من إغراق Firestore بحلقة أخطاء).
- يوسم التقرير بـ `tenantId/tenantName/uid` عند توفرها (يضبطها `auth.jsx` عبر `setMonitorContext`).
- يصل التقرير → `platformErrors` → إشعار فوري → شاشة «المشاكل» (stack قابل للطي، تم الحل/حذف).

---

## 8. الباقات والاشتراكات — التقسيم والتحكم

**المصفوفة** (تطابق `lib/plans.js` — `FEATURE_MIN`):

| الباقة | تشمل |
|---|---|
| **منيو** (menu) | منيو QR رقمي، هوية وألوان، طلبات أساسية |
| **منيو + تشغيل** (ops) | + كاشير/POS، إدارة طلبات وطاولات، KDS، حجوزات، نداء نادل |
| **احترافي** (pro) | + مكتبة الثيمات والسكنات، خلفيات/فيديو/علامة مائية |
| **متكامل** (enterprise) | + إدارة الموظفين الكاملة: حضور بالسيلفي، أداء، رواتب، ورديات، تقارير، إعلانات |

**التحكم المنفّذ (شاشة «الاشتراكات» + بطاقة داخل ملف كل منشأة):**
- تغيير الباقة لأي منشأة + حالة الاشتراك (فعّال/تجريبي/منتهٍ) + تاريخ الانتهاء.
- إيقاف/تفعيل الحساب مع سبب يظهر للمنشأة (لافتة حمراء في لوحتها + رابط للدعم).
- كل تغيير يُسجَّل تلقائياً في feed ويُشعِر الطرفين.
- `subscriptionSweep` ينهي الاشتراكات المنقضية تلقائياً كل ليلة.

**الإنفاذ داخل تطبيق المنشأة (المرحلة 2 — ✅ منفّذ):**
1. ✅ مكوّن [`PlanGate`](src/components/PlanGate.jsx) + شاشة ترقية `UpgradeNotice` (تعرض الباقة الحالية والمطلوبة + CTA «تواصل معنا» → `/admin/support`).
2. ✅ حراسة المسارات في `App.jsx`: `/cashier` (cashier)، `/kds` (kds)، `/admin/orders` (orders)، `/admin/operations`+`tables` (tables)، `/admin/reservations`، `/admin/reports`+`daily` (reports)، `/admin/hr`+`roles`+`policies`+`staff` (staff)، `performance`، `attendance`.
3. ✅ `AdminLayout` يفلتر التنقل (الشريط الجانبي + السفلي + قائمة «المزيد») بالصلاحية **و**الباقة معاً.
4. ✅ تبويب «تصميم المظهر» في `Settings` مقفول لغير Pro+ (يعرض UpgradeNotice).
5. ✅ انتهاء الاشتراك بمهلة: `planExpired(tenant)` في `plans.js` — بعد `EXPIRED_GRACE_DAYS = 7` أيام من `planExpiresAt` تُقيَّد المنشأة تلقائياً لباقة «منيو»؛ لافتة ذهبية توضح المهلة/التقييد.
6. ✅ **سريان لحظي**: `auth.jsx` يتابع وثيقة المنشأة بـ `onSnapshot` — أي تغيير باقة/إيقاف من المنصة يظهر عند المنشأة فوراً بدون إعادة دخول.
7. لاحقاً (مرحلة 6): إنفاذ في القواعد نفسها (`getPlan(tid)`) للمزايا الحساسة، وتغيير افتراضي `plans.js` من enterprise إلى menu عند إطلاق التسعير.

---

## 9. خطوات التشغيل والنشر (مطلوبة منك — مرة واحدة)

> تسجيل دخول Firebase CLI معطّل في بيئة التطوير هنا؛ نفّذ من جهازك:

1. **القواعد والفهارس:** `firebase deploy --only firestore:rules,firestore:indexes`
   (أو الصق `firestore.rules` في Firebase Console → Firestore → Rules).
2. **تفعيل عضويتك:** Firebase Console → Firestore → أنشئ مجموعة `platformAdmins` → وثيقة بمعرّف = **uid حسابك** (من تبويب Authentication) بحقول `{ name, email }`.
3. **الدوال:** `firebase deploy --only functions` (تتطلب خطة Blaze — مفعّلة أصلاً لدوالك الحالية).
4. **الاستضافة:** `npm run deploy:hosting`.
5. سجّل دخولك ثم افتح **`/platform`** (يظهر لك أيضاً رابط «لوحة المنصّة» أسفل قائمة الإدارة). فعّل إشعارات الجهاز من الزر في الشريط الجانبي.

---

## 10. الشاشات المنفّذة (src/routes/platform/)

| الشاشة | المسار | المحتوى |
|---|---|---|
| `PlatformLayout` | `/platform` (غلاف) | شريط جانبي + سفلي، شارة رسائل غير مقروءة، تنبيهات لحظية، تفعيل Push |
| `Overview` | `/platform` | 6 KPI (منشآت/نشطة/طلبات اليوم/مبيعات اليوم/أخطاء/رسائل) + محادثات بانتظار الرد + أحدث المنشآت + آخر النشاط + أخطاء تحتاج مراجعة |
| `Venues` | `/platform/venues` | بحث + فلاتر (نشطة/موقوفة/منتهية) + بطاقة لكل منشأة (باقة/حالة/إجراءات سريعة: تفاصيل، دردشة، إيقاف) |
| `VenueDetail` | `/platform/venues/:tid` | **عرض 360°**: 8 KPI (مبيعات وطلبات اليوم/الأسبوع، عملاء، أصناف، موظفون، شكاوى) + بطاقة التحكم بالاشتراك + إيقاف/تفعيل + ملاحظة داخلية + قائمة الموظفين + أحدث الطلبات + سجل نشاط المنشأة |
| `Chat` | `/platform/chat/:tid?` | قائمة خيوط + محادثة (فقاعات) + بدء محادثة مع أي منشأة |
| `Issues` | `/platform/issues` | تبويبان: تذاكر المنشآت (حالات معالجة) + أخطاء النظام (stack، تم الحل، حذف) |
| `Subscriptions` | `/platform/subscriptions` | مصفوفة الباقات (مع عدد المشتركين) + صف تحكم لكل منشأة (باقة/حالة/انتهاء/حفظ) |
| `Activity` | `/platform/activity` | السجل الكامل (250 حدثاً حياً) بفلاتر منشأة/نوع/أهمية |
| `Analytics` | `/platform/analytics` | رسوم بيانية (مبيعات/طلبات يومية من `platformStats` + منحنى نمو التسجيلات) + أعلى المنشآت مبيعات + لوحة المنشآت الخاملة (7+ أيام بلا طلبات) مع زر تواصل |
| `Broadcast` | `/platform/broadcast` | بث إعلان عام لكل المنشآت (أو باقة محددة) مع Push اختياري + سجل الإعلانات وعدد الواصلين |

**وفي لوحة المنشأة:** `admin/Support.jsx` (`/admin/support`) — دردشة مع المنصة + فتح تذاكر + متابعة حالتها؛ ولافتة الإيقاف في `AdminLayout`.

---

## 11. المراحل القادمة

### ~~المرحلة 2 — إنفاذ الباقات في تطبيق المنشأة~~ ✅ منفّذة (§8)

### ~~المرحلة 3 — تعميق المراقبة والتحليلات~~ ✅ منفّذة
- ✅ رسوم بيانية: إيراد وطلبات المنصة اليومية + منحنى نمو التسجيلات + أعلى المنشآت (`/platform/analytics`).
- ✅ «صحة المنشآت»: قائمة الخاملة (7+ أيام بلا طلبات) + إحصاؤها في التقرير الأسبوعي.
- ✅ تقرير أسبوعي مجدول (`weeklyPlatformReport` — الأحد 09:00) يصل للمنصة Push.
- ✅ تنظيف شهري (`activityCleanup`): سجل النشاط > 60 يوماً + الأخطاء المحلولة > 30 يوماً.

### المرحلة 4 — تحكم متقدم (منفّذة جزئياً)
- ✅ **انتحال هوية (Impersonation):** `platformImpersonate` onCall تصدر Custom Token لمالك المنشأة (موثَّق في السجل بصفة high) — زر «الدخول كمالك» في ملف المنشأة؛ العودة بإعادة تسجيل الدخول بحساب المنصة.
- ✅ **إعلانات عامة:** `platformBroadcasts` + fan-out لكل منشأة (أو باقة محددة) في لوحة إعلاناتها + Push اختياري — شاشة `/platform/broadcast`.
- ⬜ إجراءات جماعية: تغيير باقة/تمديد لمجموعة منشآت دفعة واحدة.
- ⬜ تصدير بيانات منشأة (Excel — xlsx موجودة) وأرشفة/حذف نهائي آمن.

### المرحلة 5 — الفوترة (أسبوع)
- `platformInvoices/{id}` لكل منشأة (شهري/سنوي، حالة سداد) + توليد تلقائي من `subscriptionSweep`.
- تكامل بوابة دفع (مثل Moyasar/Tap للسعودية) عبر دالة webhook → تجديد تلقائي للاشتراك.
- شاشة فواتير داخل `Support` للمنشأة.

### المرحلة 6 — تحصين (مستمر)
- نقل دور المنصة إلى **Custom Claims** (يقلل قراءات `exists()` ويقوّي الأمان) — دالة إدارية لمنحه.
- إنفاذ الباقة في القواعد للمزايا الحساسة.
- App Check لصد إساءة استخدام `platformErrors` create العام.
- تقارير أخطاء أدق: source maps + إصدار البناء (`import.meta.env` build id) في التقرير.

---

## 12. الملفات التي أُنشئت/عُدّلت

**المرحلة 1:**
```
عُدّل:  firestore.rules            (isPlatformAdmin + wildcard + حماية حقول الاشتراك + مجموعات المنصة + إصلاح purchaseOrders/supplierPayments)
عُدّل:  firestore.indexes.json     (platformActivity ×2 + platformIssues)
عُدّل:  functions/index.js         (+13 دالة/مساعد للمنصة)
جديد:  src/lib/platform.js         (طبقة بيانات الوحدة كاملة)
جديد:  src/lib/monitor.js          (التقاط الأخطاء العالمي)
عُدّل:  src/lib/auth.jsx            (isPlatformAdmin + سياق المراقب)
عُدّل:  src/main.jsx                (initMonitor)
عُدّل:  src/App.jsx                 (مسارات /platform + /admin/support + RequirePlatform)
عُدّل:  src/components/AdminLayout.jsx (رابط لوحة المنصة + لافتة الإيقاف + رابط الدعم)
جديد:  src/routes/platform/{PlatformLayout,Overview,Venues,VenueDetail,Chat,Issues,Subscriptions,Activity,shared}.jsx
جديد:  src/routes/admin/Support.jsx
```

**المرحلة 2 + تحليلات المرحلة 3:**
```
عُدّل:  src/lib/plans.js            (planExpired + مهلة 7 أيام + إسقاط لباقة منيو)
جديد:  src/components/PlanGate.jsx  (بوابة الباقة + UpgradeNotice)
عُدّل:  src/App.jsx                 (حراسة 15 مساراً بالباقة + مسار /platform/analytics)
عُدّل:  src/components/AdminLayout.jsx (فلترة التنقل بالباقة + لافتة انتهاء الاشتراك)
عُدّل:  src/lib/auth.jsx            (متابعة حيّة لوثيقة المنشأة onSnapshot — سريان فوري)
عُدّل:  src/routes/admin/Settings.jsx (قفل تبويب المظهر لغير Pro+)
جديد:  src/routes/platform/Analytics.jsx (رسوم + أعلى المنشآت + الخاملة)
عُدّل:  src/routes/platform/PlatformLayout.jsx (رابط التحليلات)
```

**بقية المرحلة 3 + المرحلة 4:**
```
عُدّل:  functions/index.js          (+4: platformImpersonate, onPlatformBroadcast, weeklyPlatformReport, activityCleanup)
عُدّل:  firestore.rules             (platformBroadcasts)
عُدّل:  firestore.indexes.json      (platformErrors status+at للتنظيف)
عُدّل:  src/lib/platform.js         (impersonateTenantOwner + createBroadcast + watchBroadcasts)
عُدّل:  src/routes/platform/VenueDetail.jsx (زر «الدخول كمالك»)
جديد:  src/routes/platform/Broadcast.jsx   (شاشة البث العام)
عُدّل:  src/routes/platform/Analytics.jsx  (منحنى نمو التسجيلات)
عُدّل:  src/App.jsx + PlatformLayout.jsx   (مسار ورابط البث)
```
