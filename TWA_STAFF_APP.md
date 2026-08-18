# تطبيق أندرويد للموظفين (TWA) — «RBT360 Staff»

قرار معتمد (تدقيق التصميم 2026-07-17): **TWA يغلّف الـ PWA — لا إعادة كتابة Flutter.**
تطبيق Play واحد باسم «RBT360 Staff» يغلّف `https://app.rbt360sa.com/app`؛ هوية المنشأة
(الشعار والاسم) تظهر بعد الدخول، والتثبيت المباشر من المتصفح عبر `/app/:slug`
يعطي أيقونة المنشأة نفسها بدون متجر.

## المتطلبات المسبقة (منفَّذة في الكود)
- `/app` و`/app/:slug` — مدخل الموظفين المنفصل كلياً عن صفحة الهبوط (src/routes/StaffEntry.jsx).
- manifest خادمي لكل منشأة: `/app/:slug/manifest.webmanifest` + أيقونة `/app/:slug/icon.svg`
  (الشعار مُضمَّن data-URI على لوحة بلون البراند، any + maskable) — functions/venueMeta.js.
- `start_url` يفتح مباشرة: جلسة حيّة → `/admin` خلف قفل PIN؛ جهاز معروف → `/lock`.
- `public/staff.webmanifest` — manifest التغليف للمتجر (أيقونات المنصة).
- `public/.well-known/assetlinks.json` — يحوي حزمة `sa.rbt360.staff` (بصمة placeholder).

## خطوات التغليف (يدوية — مرة واحدة)
1. `npm i -g @bubblewrap/cli`
2. `bubblewrap init --manifest=https://app.rbt360sa.com/staff.webmanifest`
   - Package id: `sa.rbt360.staff`
   - Orientation: `any` · Fallback: `customtabs` · Display: `standalone`
3. `bubblewrap build` → ارفع الـ AAB إلى Play Console (مسار Internal testing).
4. من Play Console → Setup → App signing: انسخ بصمة SHA-256 لمفتاح التوقيع،
   وضعها مكان `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` في
   `public/.well-known/assetlinks.json` ثم انشر الاستضافة.
5. تحقّق: `curl https://app.rbt360sa.com/.well-known/assetlinks.json`
   (Hosting يقدّم الملفات الحقيقية قبل الـ rewrites — لن يبتلعه الـ catch-all).
6. اختبار على جهاز: تشغيل بارد → لا يظهر شريط Custom Tab (تحقق الروابط ناجح)،
   ويهبط مباشرة على شاشة قفل PIN.

## ملاحظات
- تثبيت PWA مباشرة من كروم عبر `https://app.rbt360sa.com/app/<slug>` يعطي
  أيقونة المنشأة واسمها فوراً — هذا يغني معظم المنشآت عن المتجر.
- قوائم Play منفصلة لكل منشأة = ترقية مستقبلية: نفس البنية تعمل بجعل
  start_url للحزمة `/app/<slug>`.
