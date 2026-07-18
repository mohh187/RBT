# RBT360 — منصة منيو رقمي وطلب عبر QR متعددة المنشآت

نظام تشغيل متكامل للمقاهي والمطاعم: منيو رقمي، طلب عبر QR لكل طاولة، لوحة كاشير ومطبخ لحظية، لوحة تحكم إدارية، عروض، قاعدة عملاء، وتقارير مبيعات — **مبني على React + Vite + Firebase**، عربي أولاً (RTL)، ومصمَّم للجوال أولاً.

> منصّة **عامة متعددة المنشآت**: أي صاحب عمل يسجّل حساباً، ينشئ بروفايل منشأته، وتُعزل بياناته تلقائياً عن بقية المنشآت.

---

## ✨ المزايا

- **تسجيل ذاتي + منشآت معزولة** (multi-tenant) مع أدوار: مالك/مدير/كاشير/نادل/مطبخ.
- **منيو رقمي حي** يُحدَّث لحظياً من قاعدة البيانات (Firestore realtime) — أي تعديل يظهر فوراً.
- **طلب عبر QR لكل طاولة**: مسح رمز الطاولة → الطلب يُوسَم بالطاولة تلقائياً + عدد الأشخاص + زر نداء النادل.
- **لوحة كاشير ومطبخ (KDS) لحظية** مع دورة حياة الطلب وتنبيه صوتي للطلبات الجديدة.
- **لوحة تحكم كاملة**: أصناف، تصنيفات، طاولات وQR، عروض، عملاء، تقارير، موظفون، إعدادات.
- **رفع صور** عبر Firebase Storage، **هوية بصرية لكل منشأة** (لون + اسم)، ثيم داكن/فاتح، عربي/إنجليزي.
- **تقارير مبيعات** برسوم بيانية + تصدير CSV.

---

## 🧱 التقنيات

| الطبقة | الأداة |
|---|---|
| الواجهة | React 18 + Vite + React Router |
| قاعدة البيانات + اللحظي | Cloud Firestore |
| المصادقة | Firebase Authentication (Email/Password) |
| الصور | Firebase Storage |
| الاستضافة | Firebase Hosting |
| الخطوط | Tajawal (المتن) + Cairo (العناوين) |

---

## 🚀 التشغيل محلياً

### 1) المتطلبات
- Node.js 18+ (مثبّت هنا على `C:\Program Files\nodejs`).

### 2) إعداد مشروع Firebase
1. افتح [console.firebase.google.com](https://console.firebase.google.com) وأنشئ مشروعاً (الخطة المجانية Spark تكفي للبدء).
2. **Authentication** → فعّل مزوّد **Email/Password**.
3. **Firestore Database** → أنشئ قاعدة بيانات (Production mode).
4. **Storage** → فعّله (لرفع صور الأصناف — اختياري؛ المنيو يعمل بدون صور).
5. **Project settings → Your apps → Web (`</>`)** → سجّل تطبيق ويب وانسخ قيم الإعداد.

### 3) متغيرات البيئة
انسخ `.env.example` إلى `.env.local` واملأ القيم:

```bash
cp .env.example .env.local
```

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

> بدون هذه القيم سيعرض التطبيق شاشة إرشادية للإعداد بدل المنيو.

### 4) التثبيت والتشغيل
```bash
npm install
npm run dev      # http://localhost:5173
```

---

## 🔒 نشر قواعد الأمان (مهم)

قواعد Firestore و Storage موجودة في المستودع وتفرض عزل المنشآت والصلاحيات. انشرها عبر Firebase CLI:

```bash
npm i -g firebase-tools
firebase login
# اضبط معرّف المشروع في .firebaserc ضمن "default"
firebase deploy --only firestore:rules,firestore:indexes,storage
```

- `firestore.rules` — عزل متعدد المنشآت + RBAC + قراءة عامة للمنيو + إنشاء الطلبات للضيوف.
- `firestore.indexes.json` — فهارس الاستعلامات اللحظية (الطلبات النشطة، نداءات النادل).
- `storage.rules` — قراءة عامة للصور ورفع للموظفين فقط (≤5MB، صور فقط).

> **تلميح:** عند أول تشغيل لاستعلام يحتاج فهرساً، يطبع Firestore رابطاً في الـ console لإنشائه بنقرة — أو انشر `firestore:indexes` مسبقاً.

---

## 📦 النشر إلى الإنتاج

```bash
npm run build
firebase deploy            # ينشر hosting + rules + storage
# أو فقط الموقع:
firebase deploy --only hosting
```

---

## 🗺️ المسارات (Routes)

| المسار | الوصف | الوصول |
|---|---|---|
| `/` | صفحة الهبوط + تسجيل/دخول | عام |
| `/signup` · `/login` | المصادقة | عام |
| `/onboarding` | إنشاء بروفايل المنشأة | مستخدم بلا منشأة |
| `/admin` | لوحة التحكم (رئيسية، أصناف، تصنيفات، طاولات، عروض، عملاء، تقارير، موظفون، إعدادات) | موظف |
| `/cashier` | لوحة الكاشير/الاستقبال اللحظية | موظف |
| `/kds` | شاشة المطبخ | موظف |
| `/m/:slug` | المنيو العام للمنشأة | عام |
| `/t/:slug/:token` | منيو طاولة عبر QR (طلب + نداء النادل) | عام |
| `/order/:slug/:orderId` | تتبّع حالة الطلب | عام (برابط القدرة) |

---

## 🧭 تدفّق الاستخدام

1. صاحب المنشأة **يسجّل** → ينشئ **بروفايل المنشأة** (اسم، نوع، رابط، عملة، لون).
2. يضيف **الأصناف والتصنيفات** من لوحة التحكم (مع رفع صور وأحجام/خيارات).
3. ينشئ **الطاولات** ويطبع **رموز QR** الخاصة بكل طاولة.
4. الضيف **يمسح QR الطاولة** → يختار عدد الأشخاص → يطلب → يصل الطلب **لحظياً** للكاشير والمطبخ.
5. الموظف ينقل الطلب عبر مراحله، والضيف **يتابع الحالة** على جواله.
6. يدعو المالك **الموظفين** بالبريد؛ ينضمون تلقائياً عند تسجيل الدخول.

---

## 📁 بنية المشروع

```
src/
  lib/         firebase.js, db.js, auth.jsx, i18n.jsx, qr.js, storage.js, format.js, seed.js
  components/  AdminLayout, DinerBar, MenuView, Sheet, Toast, ui, FirebaseSetup
  routes/      Landing, Login, Signup, Onboarding
    admin/     Dashboard, Items, Categories, Tables, Offers, Customers, Reports, Staff, Settings
    staff/     Cashier, Kds
    menu/      PublicMenu, TableMenu, OrderStatus
firestore.rules · firestore.indexes.json · storage.rules · firebase.json
legacy/        نسخة الكافيه القديمة (مرجع + بيانات أولية)
PLAN.md        المخطط المعماري الكامل
```

---

## ⚠️ ملاحظات

- النسخة القديمة (كافيه نيمة الثابت) محفوظة في `legacy/` للمرجع وبيانات المنيو الأولية.
- إعادة حساب الأسعار من جهة الخادم وروابط القدرة الموقّعة للطاولات مخطّطة كتحسينات لاحقة (تتطلب Cloud Functions / خطة Blaze) — راجع `PLAN.md`.
- إن لم يتوفّر Storage على خطتك، يعمل المنيو بدون صور (حقل الصورة اختياري).
