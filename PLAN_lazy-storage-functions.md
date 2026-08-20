# خطة: إخراج مكتبتَي Storage و Functions من حزمة الدخول

> **لمن ينفّذ:** هذا الملف خريطة تنفيذ كاملة. اقرأه كلّه قبل أن تكتب سطراً.
> كل رقم فيه مقيس من البناء الفعلي بتاريخ 2026-08-20، لا مقدَّر.

---

## 1. المشكلة، بالأرقام

أول مسح باركود من ضيف يُحمّل هذه الملفات **قبل أن يرى شيئاً**:

| الملف | ما يصل مضغوطاً |
|---|---|
| `firebase-*.js` | **171 KB** |
| `index-*.js` | 172 KB |
| `index-*.css` | 91 KB |
| `react-*.js` | 44 KB |
| **المجموع** | **~478 KB** |

الثلاثة الأولى مُعلَنة `modulepreload` في `dist/index.html`، أي أن المتصفح يجلبها فوراً.

**داخل حزمة `firebase`** تجلس مكتبتان لا يستخدمهما الضيف عند فتح المنيو:

- **Storage** — للرفع من الموظفين فقط. الضيف لا يرفع شيئاً. (قراءة صور الأصناف تتم عبر `<img src>` مباشرةً من رابط Storage، ولا تمرّ بالمكتبة إطلاقاً.)
- **Functions** — لا يمسّها الضيف إلا خلف نقرة (دفع، مساعد الطلب الصوتي)، لا عند الفتح.

السبب في `src/lib/firebase.js`:

```js
// السطور 4-5
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
// السطور 53-54  ← تُنشآن وقت تحميل الملف، فتدخلان الحزمة إجبارياً
storage = getStorage(app)
functions = getFunctions(app)
```

وفي `vite.config.js:36` كل ما تحت `node_modules/firebase|@firebase` يذهب لحزمة `firebase` واحدة.

---

## 2. السابقة الموجودة — اتبعها، لا تخترع

`vite.config.js:28-35` يُخرج `messaging` و`installations` من الحزمة بنفس المنطق تماماً، ومعه تعليق يشرح السبب. **قلّده حرفياً.** التعليق هناك يحذّر من فخّ حقيقي: إن أخرجتَ التنفيذ وتركتَ الواجهة (`firebase/messaging`) في الحزمة الأصلية، يشتكي rollup من حزمة دائرية. نفس الفخّ ينطبق على `firebase/storage` و`firebase/functions`.

---

## 3. لماذا لا تكفي الاستيرادات الديناميكية وحدها

`export { storage, functions }` رابط حيّ (live binding). **لا يمكن لاستيراد ديناميكي أن يُعيد نسخة متزامنة عبره.** أي محاولة لإبقاء نفس التصدير مع تحميل كسول ستفشل. لذا كل موضع استدعاء **يجب** أن يتحول إلى `await`.

هذا هو ثمن العملية، وهو سبب وجود هذه الخطة أصلاً.

---

## 4. خريطة المواضع — 22 موضعاً في 22 ملفاً

### أ. `functions` (19 موضعاً)

| # | الملف | السطر |
|---|---|---|
| 1 | `src/components/ModelStudio.jsx` | 3 |
| 2 | `src/components/SlideDesigner.jsx` | 10 |
| 3 | `src/lib/aiBridge.js` | 4 |
| 4 | `src/lib/branches.js` | 9 |
| 5 | `src/lib/dinerAi.js` | 12 |
| 6 | `src/lib/payments.js` | 5 |
| 7 | `src/lib/pin.js` | 11 |
| 8 | `src/lib/platform.js` | 24 |
| 9 | `src/lib/platformAI.js` | 10 |
| 10 | `src/lib/platformCompliance.js` | 22 |
| 11 | `src/lib/platformDocs.js` | 8 |
| 12 | `src/lib/postGen.js` | 7 |
| 13 | `src/routes/admin/Items.jsx` | 9 |
| 14 | `src/routes/admin/StaffProfile.jsx` | 11 |
| 15 | `src/routes/ChoosePlan.jsx` | 4 |
| 16 | `src/routes/platform/Health.jsx` | 19 |
| 17 | `src/routes/platform/Roles.jsx` | 7 |
| 18 | `src/routes/platform/VenueDetail.jsx` | 13 |
| 19 | `src/routes/PublicQuote.jsx` | 13 |

### ب. `storage` (3 مواضع)

| # | الملف | السطر | ملاحظة |
|---|---|---|---|
| 20 | `src/lib/storage.js` | 2 | **الأهم** — كل الرفع يمرّ به |
| 21 | `src/components/MediaLibrary.jsx` | 8 | يستورد SDK مباشرةً أيضاً (سطر 3) |
| 22 | `src/routes/admin/Library.jsx` | 11 | يستورد SDK مباشرةً أيضاً (سطر 3) |

> **انتبه:** `MediaLibrary.jsx:3` و`Library.jsx:3` يستوردان `ref/uploadBytesResumable/getDownloadURL` من `firebase/storage` مباشرةً. تحويل `storage` وحده **لا يُخرج المكتبة من الحزمة** ما دام هذان السطران قائمين. يجب تحويلهما أيضاً.

---

## 5. التصميم المطلوب

في `src/lib/firebase.js`، احذف الاستيرادين الساكنين وأضِف:

```js
// كسولة عمداً: الضيف لا يرفع ملفاً ولا يستدعي دالة عند فتح المنيو، وإبقاء
// المكتبتين ساكنتين كان يحشرهما في حزمة تُجلب قبل أول رسم.
let _storage = null
let _functions = null

export async function getStorageLazy() {
  if (_storage) return _storage
  const { getStorage } = await import('firebase/storage')
  _storage = getStorage(app)
  return _storage
}

export async function getFunctionsLazy() {
  if (_functions) return _functions
  const { getFunctions } = await import('firebase/functions')
  _functions = getFunctions(app)
  return _functions
}
```

**لا تُبقِ `storage` و`functions` كتصديرات.** احذفهما من سطر 60. إبقاؤهما يعني أن موضعاً منسياً سيمرّ بالبناء صامتاً ثم ينفجر في يد مستخدم.

في `vite.config.js`، أضف قبل سطر 36:

```js
if (/[\\/]node_modules[\\/]@firebase[\\/](storage|functions)[\\/]/.test(id)) return 'fb-lazy'
if (/[\\/]node_modules[\\/]firebase[\\/](storage|functions)[\\/]/.test(id)) return 'fb-lazy'
```

السطران معاً ضروريان (الواجهة + التنفيذ) للسبب المشروح في القسم 2.

---

## 6. نمط التحويل

**قبل:**
```js
import { functions } from './firebase.js'
const res = await httpsCallable(functions, 'pinSignIn')(payload)
```

**بعد:**
```js
import { getFunctionsLazy } from './firebase.js'
const res = await httpsCallable(await getFunctionsLazy(), 'pinSignIn')(payload)
```

`httpsCallable` نفسها تُستورد من `firebase/functions` في كل هذه الملفات — **حوّلها للاستيراد الديناميكي أيضاً**، وإلا بقيت المكتبة في الحزمة:

```js
const { httpsCallable } = await import('firebase/functions')
const fns = await getFunctionsLazy()
const res = await httpsCallable(fns, 'pinSignIn')(payload)
```

---

## 7. ثلاثة مواضع لها حساسية خاصة

### 7.1 `src/lib/pin.js` — مسار دخول الموظف

فيه `warmPinSignIn()` تُستدعى عند **أول رقم** يضغطه الموظف لتسخين الخادم. بعد التحويل ستصبح غير متزامنة. **تأكد أن التسخين ما زال يسبق كتابة الأرقام الثلاثة الباقية**، وإلا فقدنا الغرض منه.

`tryQuickUnlock` و`rememberQuickUnlock` لا تمسّان Functions — لا تلمسهما.

**اختبر يدوياً:** أدخل رمز موظف حقيقي وتأكد أن الدخول يعمل وأن السرعة لم تسوء.

### 7.2 `src/lib/storage.js` — كل رفع في النظام

كل دوال الرفع تمرّ به. بعد التحويل ستصبح كل واحدة `await getStorageLazy()` أولاً.

**احذر:** الملف يحتوي حدود أحجام تُطابق `storage.rules` حرفياً (`UPLOAD_LIMITS_MB`, `BIG_LIMITS_MB`, `BIG_FOLDERS`). **لا تلمس أي رقم منها.** التعليق فوقها يشرح حادثة حقيقية: رقم 100 بدل 40 جعل رفع 60 ميجابايت يمرّ من حارس العميل ثم يموت برفض صلاحية عند 100% من النقل.

### 7.3 `src/lib/dinerAi.js` و `payments.js` — مسار الضيف

هذان الوحيدان في قائمة Functions اللذان يمسّهما ضيف. تأخير التحميل هنا **مقصود ومطلوب** (خلف نقرة). لكن **اختبر الدفع فعلياً** بعد التحويل.

---

## 8. الفحص — إلزامي، وترتيبه مقصود

### 8.1 لا موضع منسي

```bash
grep -rn "from.*firebase\.js" src/ | grep -E "\b(storage|functions)\b"
```
**يجب أن يعود فارغاً.** أي نتيجة = موضع لم يُحوَّل.

```bash
grep -rn "from 'firebase/\(storage\|functions\)'" src/
```
**يجب ألا يبقى استيراد ساكن.** كلها `await import(...)`.

### 8.2 المكتبتان خرجتا فعلاً

```bash
npm run build
grep -c "uploadBytesResumable" dist/assets/firebase-*.js   # يجب 0
grep -c "httpsCallable"        dist/assets/firebase-*.js   # يجب 0
ls -la dist/assets/fb-lazy-*.js                            # يجب أن توجد
```

قِس المكسب:
```bash
gzip -c dist/assets/firebase-*.js | wc -c   # قارنه بـ 171 KB
```

### 8.3 البناء واللنت

```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run build   # يجب أن ينجح
npx eslint src --ext .js,.jsx                          # 0 errors
```

> إن انهار البناء بنفاد ذاكرة: أغلق خوادم المعاينة المتروكة أولاً (`pkill -f "vite preview"`)، ثم أعد بذاكرة أكبر. حدث هذا مرتين سابقاً وليس عطلاً في الكود.

### 8.4 الفحص الحي — **لا تتخطَّه**

هذا العطل من نوع **يمرّ بالبناء واللنت ويظهر في يد المستخدم**. اختبر كل مسار رفع واستدعاء يدوياً:

| المسار | ماذا تختبر |
|---|---|
| رفع صورة صنف | الإدارة ← المنيو ← صنف ← صورة |
| مكتبة الوسائط | الإدارة ← المكتبة ← رفع |
| شعار المنشأة | الإعدادات ← المظهر |
| توليد صورة بالذكاء | استوديو الشرائح / الأصناف |
| **دخول الموظف بالرمز** | شاشة القفل ← رمز حقيقي |
| الدفع الإلكتروني | طلب من المنيو ← دفع |
| اختيار الباقة | `/choose-plan` |
| ملف الموظف | تغيير بيانات دخول موظف |
| لوحة المنصة | `/platform/health`, `/platform/roles` |

### 8.5 قواعد الأمان

```bash
npm run test:rules      # يحتاج JAVA_HOME على JDK 17
```
**35 من 35 يجب أن تمرّ.** هذه العملية لا تمسّ القواعد، فأي فشل هنا معناه أنك كسرت شيئاً آخر.

---

## 9. النشر

```bash
npm run build
firebase deploy --only hosting
```

**فخّ نشر موثّق:** أمر `firebase deploy` قد **يخرج برمز 0 وهو لم ينشر شيئاً**. لا تثق برمز الخروج، ابحث عن `Deploy complete` في المخرجات.

تحقّق أن الإنتاج يشغّل بناءك:
```bash
curl -s https://rbt360sa.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1
# يجب أن يتطابقا
```

---

## 10. التراجع

التغيير كله في الكود، لا في البيانات ولا في القواعد. **التراجع = `git revert` للكوميت.** لا يوجد ترحيل ولا حالة خارجية.

اجعله **كوميتاً واحداً** لهذا السبب بالذات.

---

## 11. حدود العمل

**لا تفعل** في نفس الجلسة:
- تقسيم `index.css` (488 قاعدة لشاشات الموظفين داخل حزمة الضيف). مكسب حقيقي أيضاً، **لكنه عمل منفصل** بمخاطر مختلفة. خلطهما يعني أن أي عطل غداً لن نعرف مصدره.
- ترقية `firebase` من 11 إلى 12.
- أي تغيير في قواعد الأمان.

**نطاق هذه الجلسة:** `src/lib/firebase.js` + `vite.config.js` + الـ22 موضعاً، ومعها سطرا استيراد SDK المباشر في `MediaLibrary.jsx:3` و`Library.jsx:3`. لا شيء غيرها.

---

## 12. معيار القبول

- [ ] `grep` القسم 8.1 يعود فارغاً (كلا الأمرين)
- [ ] `httpsCallable` و`uploadBytesResumable` = 0 داخل `dist/assets/firebase-*.js`
- [ ] حزمة `fb-lazy-*.js` موجودة
- [ ] حزمة `firebase` نقصت قياساً بـ171 KB مضغوطة (اذكر الرقم الجديد)
- [ ] البناء ينجح، اللنت 0 errors
- [ ] `npm run test:rules` = 35/35
- [ ] **كل صفوف جدول 8.4 مختبَرة يدوياً** ومذكورة في التقرير
- [ ] كوميت واحد
- [ ] الإنتاج يطابق البناء المحلي بالبصمة
