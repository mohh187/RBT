# مصادر مؤكدة — تسعير Meta/Google والنشر الاجتماعي

> بحث موثّق ضد مصادر أوّلية بتاريخ 2026-07-28، ثم تحقّق خصومي مستقل لكل تقرير.
> الخلاصات والقرارات في SPEND_SOCIAL_PLAN.md — هذا الملف هو الأدلة.


---

# instagram

# التحقق العدائي — تقرير Instagram Publishing API لمنصة SaaS متعددة المستأجرين (RBT360)
تاريخ التحقق: 2026-07-28. كل بند أدناه فُحص مقابل وثائق Meta الأصلية مباشرة.

---

## الحقائق المؤكدة

**1. تكوينان للـ Instagram Platform، وكلاهما يدعم النشر**
- "Instagram API with Business Login for Instagram" → المضيف `graph.instagram.com`، **لا يتطلب صفحة فيسبوك**، ينقصه: hashtag search، product tagging، Partnership Ads.
- "Instagram API with Facebook Login for Business" → المضيف `graph.facebook.com`، **صفحة فيسبوك مطلوبة (Required)**، ينقصه: المراسلة المباشرة.
- "To use the APIs, your app users must have an Instagram professional account."
- المصدر: https://developers.facebook.com/docs/instagram-platform/overview/

**2. المسارات (Endpoints) — مؤكدة حرفياً**
```
POST /<IG_ID>/media                      # إنشاء الحاوية
GET  /<IG_CONTAINER_ID>?fields=status_code
POST /<IG_ID>/media_publish
GET  /<IG_ID>/content_publishing_limit
```
`status_code` ∈ `EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED`. الحاوية تنتهي بعد **24 ساعة** إن لم تُنشر.
المصدر: https://developers.facebook.com/docs/instagram-platform/content-publishing/

**3. رفع الفيديو القابل للاستئناف (تصحيح: يتضمن رقم الإصدار)**
```
POST https://rupload.facebook.com/ig-api-upload/<API_VERSION>/<IG_MEDIA_CONTAINER_ID>
Headers: Authorization: OAuth <ACCESS_TOKEN> | offset: 0 | file_size: <bytes>
```
المصدر: نفس صفحة content-publishing.

**4. صلاحيات Instagram Login — حرفياً من دليل التنفيذ**
`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `instagram_business_manage_comments`
رابط التفويض: `https://www.instagram.com/oauth/authorize` مع `client_id, redirect_uri, response_type=code, scope`، و`state` اختياري، و`enable_fb_login` (افتراضي true) و`force_reauth`.
المصدر: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login

**5. دورة حياة التوكن (Instagram Login) — مؤكدة**
- كود التفويض: صالح **ساعة واحدة**، استخدام واحد.
- Short-lived: **ساعة واحدة** (overview: "valid for one hour").
- Long-lived: **60 يوماً** — `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`.
- التجديد: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`، بشرط أن يكون التوكن **عمره 24 ساعة على الأقل**، غير منتهٍ، والمستخدم ما زال مانحاً `instagram_business_basic`. التوكن غير المجدَّد لمدة 60 يوماً ينتهي نهائياً.
- التبادل قصير الأجل: `POST https://api.instagram.com/oauth/access_token`.

**6. توكن الصفحة في مسار Facebook Login لا ينتهي — مؤكد حرفياً**
"A long-lived token generally lasts about 60 days" (توكن المستخدم)، و "Long-lived Page access token do not have an expiration date and only expire or are invalidated under certain conditions". يُجلب عبر `GET {app-scoped-user-id}?accounts`.
المصدر: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived

**7. تناقض حد النشر — مؤكد أنه تناقض حقيقي في وثائق Meta نفسها**
- الدليل: "100 API-published posts within a 24-hour moving period" (الكاروسيل = منشور واحد).
- المرجع: `"quota_total": 50` و`"quota_duration": 86400`، مع نص: "currently 50" و"currently 86400 seconds".
المصدر: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/

**8. حد المكالمات على مستوى المنصة**
"Calls within 24 hours = 4800 * Number of Impressions" — الانطباعات = ظهور محتوى الحساب على شاشة أحدهم في آخر 24 ساعة. رمز الخطأ عند التجاوز: **80002**. الترويسة: `X-Business-Use-Case-Usage`.
المصدر: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

**9. مواصفات الوسائط — مؤكدة حرفياً**
- صورة: JPEG فقط (MPO/JPS غير مدعومين)، **8 MB** كحد أقصى، نسبة **4:5 إلى 1.91:1**، عرض **320 كحد أدنى و1440 كحد أقصى**، فضاء لوني **sRGB**.
- Reels: HEVC/H264، progressive scan، closed GOP، 4:2:0؛ **23-60 FPS**؛ أقصى عرض **1920**؛ VBR **25 Mbps**؛ صوت AAC **128 kbps**؛ نسبة **0.01:1 إلى 10:1** (الموصى به 9:16)؛ المدة **3 ثوانٍ إلى 15 دقيقة**؛ الحجم **300 MB**.
- Stories فيديو: **3 إلى 60 ثانية**، **100 MB**.
- التعليق: **2200 حرفاً، 30 هاشتاغ، 20 منشن**.
- كاروسيل: **حتى 10** عناصر. `product_tags`: **5**. `collaborators`: **3** (غير مدعوم في Stories). `alt_text`: **1000 حرف**، للصور فقط — "Reels and stories are not supported".
المصدر: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/

**10. غير مدعوم — مؤكد حرفياً**
"Shopping tags are not supported"، "Filters are not supported"، ولا يوجد أي ذكر لـ`published_at` أو للجدولة في دليل النشر.

**11. Stories للحسابات التجارية فقط — مؤكد حرفياً**
"Content Publishing is available to all Instagram Professional accounts, except Stories, which are only available to business accounts."
المصدر: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login

**12. Advanced Access + App Review + Business Verification — مؤكد**
"Advanced Access is the access level required if your app serves Instagram professional accounts that you don't own or manage... This access level requires App Review and Business Verification." (overview)
"As of February 1, 2023, if your app requires advanced level access to permissions, you might need to complete Business Verification."
المصدر: https://developers.facebook.com/docs/development/release/business-verification

**13. متطلبات المراجعة — مؤكدة حرفياً**
- "To request Advanced Access to certain permissions, you need to make at least 1 successful API call".
- "your app can be loaded and tested externally" + تعليمات تسجيل دخول تفصيلية للمراجعين.
- الفيديو التوضيحي: "Use English as the app UI language" حيثما أمكن، و"Provide captions and tool-tips" إن لم تكن الواجهة بالإنجليزية أو واضحة.
- إعدادات التطبيق: أيقونة **1024x1024**، رابط سياسة خصوصية، تصنيف، بريد عمل.
المصدر: https://developers.facebook.com/docs/instagram-platform/app-review

**14. تضارب تسمية الصلاحية — مؤكد**
صفحة App Review تكتب `instagram_business_content_publishing` (بـ -ing)، بينما دليل Business Login والمراجع تكتب `instagram_business_content_publish`. الشكل الصحيح للـ OAuth هو **بدون -ing**.

**15. تضارب مضيف التفويض — مؤكد**
مرجع OAuth Authorize يوثّق `GET https://api.instagram.com/oauth/authorize` ويسرد `instagram_basic` و`instagram_business_basic`، بينما دليل Business Login يستخدم `https://www.instagram.com/oauth/authorize`. اعتمد **www.instagram.com** (دليل التنفيذ الحالي).
المصدر: https://developers.facebook.com/docs/instagram-platform/reference/oauth-authorize/

---

## غير مؤكد / تغيّر

**أ. رقم إصدار API قديم في التقرير — تصحيح مطلوب**
التقرير يستخدم `v23.0` في كل الأمثلة. الأحدث اليوم هو **v25.0** (صدر 2026-02-18)، وأمثلة صفحة content-publishing نفسها صارت تستخدم `https://graph.instagram.com/v25.0/...`. تواريخ الإصدار: v23.0 = 2025-05-29، v24.0 = 2025-10-08، v25.0 = 2026-02-18. لا تثبّت v23.0 في كود جديد.
المصدر: https://developers.facebook.com/docs/graph-api/changelog/versions/

**ب. رمز الخطأ الفرعي 2446079 مقترن بالرمز الخاطئ**
التقرير يقول "code 80002, subcode 2446079". المؤكد: **80002** هو رمز تجاوز حد Instagram Platform في صفحة rate-limiting. أما **2446079** فمقترن بالرمز **17** ("User request limit reached")، ولا يظهر إطلاقاً في مرجع أخطاء Instagram Platform. **الاقتران المذكور غير مؤكد.** عالج 80002 و17 كحالتين منفصلتين.

**ج. رابط رفع الفيديو ناقص في التقرير**
التقرير كتب `rupload.facebook.com/ig-api-upload/<IG_MEDIA_CONTAINER_ID>`. الصحيح يتضمن الإصدار: `rupload.facebook.com/ig-api-upload/<API_VERSION>/<IG_MEDIA_CONTAINER_ID>`.

**د. `pages_show_list` ليست صلاحية نشر**
التقرير يدرجها ضمن صلاحيات النشر في مسار Facebook Login. المرجع يقول: إنشاء الوسائط يتطلب `instagram_basic` + `instagram_content_publish` + `pages_read_engagement` (و`ads_management` أو `ads_read` شرطياً). `pages_show_list` مذكورة لـ**قراءة** الوسائط لا لإنشائها.

**هـ. اسم التكوين تغيّر**
التقرير يسميه "Instagram API with Instagram Login". التسمية الحالية في صفحة Overview هي **"Instagram API with Business Login for Instagram"**. الاسم القديم ما زال في بعض مسارات الروابط.

**و. تاريخ إضافة `alt_text` (2025-03-24) — غير مؤكد**
الحد (1000 حرف) وقصره على الصور مؤكدان؛ تاريخ الإضافة لم أجده في مصدر أولي.

**ز. مستوى الوصول لكل صلاحية من صفحة Permissions Reference — غير مؤكد**
صفحة https://developers.facebook.com/docs/permissions/ لم تُرجع جدول Standard/Advanced قابلاً للقراءة آلياً (تُقدَّم مترجمة/JS). ادعاء التقرير بأن `instagram_business_basic` و`instagram_business_content_publish` كلاهما "Advanced" **غير مؤكد من مصدر أولي مباشر** — لكن نتيجته العملية مؤكدة من صفحة Overview: أي تطبيق يخدم حسابات لا تملكها يحتاج Advanced Access + App Review + Business Verification.

**ح. التكلفة — غير مؤكدة (كما ذكر التقرير، وهذا صحيح)**
لا توجد صفحة تسعير ولا أي عبارة "free" في أي وثيقة أولية راجعتها. غياب السعر ليس ضماناً تعاقدياً بالمجانية.

**ط. مدة App Review — غير موثقة إطلاقاً**
لا SLA منشور. صحيح كما ورد.

**ي. وثائق التحقق من النشاط التجاري للسعودية — غير مؤكدة**
صفحة developers الخاصة بـ Business Verification تحيل إلى Business Manager Help Center ولا تدرج الوثائق. صفحات `facebook.com/business/help/*` لا تُرجع محتوى للـ fetcher (JS-rendered). ادعاءات التقرير عن قبول السجل التجاري وشهادة ضريبة القيمة المضافة، ونافذة "أسبوع واحد" للرد، و"لا تُقبل الوثائق ذاتية الإصدار" — **كلها غير مؤكدة من مصدر أولي**. عاملها كتوقع معقول لا كحقيقة.

**ك. تناقض تسويقي حول الجدولة**
بعض صفحات Meta التسويقية تقول إن الـ API يتيح "schedule and publish posts". **لا يوجد أي معامل جدولة موثق** في `POST /media`. الجدولة مسؤوليتك بالكامل. الادعاء الأصلي صحيح، لكن انتبه للصياغة المضللة في صفحات Meta التعريفية.

**ل. تقديرات الجهد (17-23 يوم عمل)**
اجتهاد المؤلف، لا مصدر أولي. لا تعتمدها كالتزام.

---

## الخلاصة العملية

- **ثبّت `v25.0` لا `v23.0`**، واستخدم `https://www.instagram.com/oauth/authorize` مع `scope=instagram_business_basic,instagram_business_content_publish` (بدون -ing). رابط رفع الفيديو يجب أن يحوي مقطع الإصدار.
- **هندس على 50 لا 100** منشوراً/24 ساعة، واقرأ `content_publishing_limit` قبل كل نشر. الحد الحقيقي القاتل هو `4800 × الانطباعات` — حساب مقهى جديد ميزانيته شبه صفرية، فاستخدم backoff أسّياً في استطلاع `status_code` ولا تعمل حلقة ضيقة.
- **دورة التجديد كل 60 يوماً هي الخطر التشغيلي الأول** في مسار Instagram Login: كرون يومي يجدّد ما بقي له أقل من 10 أيام، يتخطى ما عمره أقل من 24 ساعة، ويحوّل الفشل إلى حالة `needs_reconnect` ظاهرة في لوحة المنشأة. البديل المعماري الجاد: مسار Facebook Login يمنح **توكن صفحة لا ينتهي** — مقابل اشتراط صفحة فيسبوك في الإعداد.
- **طبّق تطبيعاً إجبارياً للوسائط قبل أي نشر**: JPEG + sRGB + قص النسبة إلى 4:5–1.91:1 + عرض ≤ 1440 + حجم ≤ 8 MB، على رابط HTTPS عام غير محمي (خوادم Meta هي التي تجلبه). أي PNG/WebP/HEIC من صاحب المقهى سيفشل بلا هذا.
- **لا تعِد أحداً بـ Stories قبل التحقق العملي**: الوثائق تحصرها في حسابات **Business** لا Creator، والنص وارد في صفحة واحدة فقط. الجدولة أيضاً ليست ميزة من Meta — أنت من يبنيها، مع إنشاء الحاوية قرب وقت النشر لأنها تموت بعد 24 ساعة.
- **ابدأ Business Verification فوراً بالتوازي مع البناء**، وابنِ نداء API ناجحاً واحداً على الأقل قبل التقديم (شرط صريح من Meta)، وأضف تسميات إنجليزية على تسجيل الشاشة لواجهة عربية. لا تلتزم بتاريخ إطلاق أمام أي منشأة — مدة المراجعة غير منشورة، ولا يمكن تفعيل أي عميل حقيقي قبل الموافقة.

---

# x-twitter

# X (Twitter) API — نسخة مُدقّقة بعد التحقق المستقل (يوليو 2026)

تم التحقق من كل رقم أدناه بجلب مباشر من `docs.x.com` في هذه الجلسة. ما لم يُجلب من مصدر أساسي نُقل إلى قسم «غير مؤكد».

**الخلاصة الأهم صمدت للتحقق:** لم تعد هناك اشتراكات Free/Basic/Pro للمطورين الجدد. النموذج الحالي هو **الدفع حسب الاستخدام (Pay-Per-Usage)** برصيد credits.

---

## الحقائق المؤكدة

### 1. نموذج التسعير
- نص الصفحة حرفياً: *"The X API uses pay-per-usage pricing. No subscriptions—pay only for what you use."* — لا يوجد جدول Free/Basic/Pro على صفحة التسعير الأساسية.
  المصدر: https://docs.x.com/x-api/getting-started/pricing
- شراء الرصيد وإدارة التطبيقات عبر `console.x.com`.
  المصدر: https://docs.x.com/x-api/getting-started/getting-access

### 2. أسعار عمليات الكتابة (لكل طلب) — مؤكدة كاملة

| العملية | السعر |
|---|---|
| Post: Create | 0.015 $ |
| **Post: Create (with URL)** | **0.200 $** |
| Post: Create (summoned) | 0.010 $ |
| DM Interaction: Create | 0.015 $ |
| User Interaction: Create | 0.015 $ |
| Interaction: Delete | 0.010 $ |
| Content: Manage | 0.005 $ |
| List: Create | 0.010 $ |
| List: Manage | 0.005 $ |
| Bookmark | 0.005 $ |
| Media Metadata | 0.005 $ |
| Privacy: Update | 0.010 $ |
| Counts: Recent / All | 0.005 $ / 0.010 $ |
| Trends | 0.010 $ |

المصدر: https://docs.x.com/x-api/getting-started/pricing

**النسبة الحاسمة مؤكدة: منشور يحتوي رابطاً يكلّف 13.3 ضعف منشور بلا رابط** (0.200 ÷ 0.015).

### 3. القراءات والسقوف
- Posts 0.005 $، Users 0.010 $، Likes 0.001 $ لكل مورد.
- **Owned Reads** (بيانات حسابك نفسه): 0.001 $ لكل مورد (1,000 مورد بدولار).
- **إزالة التكرار خلال نافذة 24 ساعة UTC** — الطلب المكرر داخلها لا يُحتسب.
- **سقف 2,000,000 قراءة منشور شهرياً** على PPU؛ ما فوقه يتطلب Enterprise.
- إعادة الشحن التلقائي: مرة واحدة كحد أقصى كل 5 دقائق.
  المصدر: https://docs.x.com/x-api/getting-started/pricing

### 4. حدود المعدّل (وهي القيد الحقيقي على الكتابة، لا الباقة)

| النقطة | لكل تطبيق | لكل مستخدم |
|---|---|---|
| `POST /2/tweets` | 10,000 / 24 ساعة | 100 / 15 دقيقة |
| `POST /2/media/upload` | 50,000 / 24 ساعة | 500 / 15 دقيقة |

الوثيقة تذكر فقط أن *"Enterprise customers have custom rate limits"* دون جداول لباقات أخرى.
المصدر: https://docs.x.com/x-api/fundamentals/rate-limits

### 5. OAuth 2.0 PKCE — كل الادعاءات مؤكدة حرفياً
- **مدة صلاحية access token:** *"By default, the access token you create through the Authorization Code Flow with PKCE will only stay valid for two hours unless you've used the `offline.access` scope."*
- **`offline.access` إجباري للحصول على refresh token** — بدونه لا يُصدر refresh token إطلاقاً.
- **طرق PKCE challenge:** `S256` و `plain` كلاهما مدعوم. استخدم S256.
- **نقطة التجديد:** `POST https://api.x.com/2/oauth2/token` بـ `grant_type=refresh_token`.
- **الصلاحيات (scopes):** `tweet.write` = "Tweet and Retweet for you"، `tweet.read`، `users.read`، و`media.write` = "Upload media".
- **نوع العميل:** Web App / Automated App = **confidential client** ويحصل على Client Secret؛ Native App و Single Page App = public clients.
  المصدر: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code

### 6. رفع الوسائط v2
- المسار والطريقة: **`POST /2/media/upload/initialize`** ثم `/append` ثم `/finalize`.
- الصلاحية: `media.write` = "Upload media, such as photos and videos, on your behalf."
- المصادقة: OAuth2UserToken أو UserToken (HTTP OAuth).
- **`total_bytes` الحد الأقصى المقبول: 17,179,869,184**.
  المصدر: https://docs.x.com/x-api/media/media-upload-initialize
- القيود: *"You may attach up to 4 photos, 1 animated GIF or 1 video in a Post."* — الصور JPG/PNG/GIF/WEBP بحد 5 MB؛ GIF متحرك ≤ 15 MB و ≤ 1280x1080 و ≤ 350 إطاراً و ≤ 300 مليون بكسل؛ الفيديو ≤ 512 MB، بين 32x32 و 1280x1024، مدة بين 0.5 و 140 ثانية، ≤ 60 FPS، نسبة بين 1:3 و 3:1.
  المصدر: https://docs.x.com/x-api/media/quickstart/best-practices

### 7. اتفاقية المطورين — النصوص الحرجة مؤكدة
- **§III.L:** *"The Pay-Per-Use, Basic, and Pro plans are designed for hobbyists, commercial prototyping, initial development, early-stage X product integrations, and supporting applications with a limited number of end-users."* وتنتهي حرفياً بـ: *"If you use the X API beyond this scope, then you must apply (or already subscribe to) an Enterprise plan (as described at developer.x.com)."*
- **§III.A:** يُمنع *"sell, rent, lease, sublicense, distribute, redistribute, syndicate, create derivative works of"* المادة المرخّصة، ويُمنع *"provide use of the X API on a service bureau, rental or managed services basis"*، ويُمنع مشاركة *"any token, key, password, or other login credentials to the X API"* مع طرف ثالث.
- **§III.B:** الاستخدام التجاري = *"(a) by or for a business whose primary purpose is to earn revenue through a product or service, or (b) as part of a product or service that is monetized."*
- **§VII.F:** *"Each purchase of a Paid Service applies to a single X account"* ولا ينطبق على حسابات أخرى تتحكم بها.
- **سقف المسؤولية:** *"aggregate liability for any and all claims under this Agreement will not exceed fifty dollars ($50.00)."*
  المصدر: https://docs.x.com/developer-terms/agreement

### 8. سياسة المطورين — مؤكدة حرفياً
- **حظر المحتوى المكرر:** *"Never post identical or substantially similar content across multiple accounts"*
- **الموافقة:** *"Get express and informed consent from people before doing any of the following: Taking any actions on their behalf. This includes (but is not limited to): Posting content to X"*
- **العرض قبل النشر:** *"Show exactly what will be published"*
- **الإفصاح عن البوت:** *"A good way to do this is by including a statement that the account is a bot in the profile bio."*
  المصدر: https://docs.x.com/developer-terms/policy

### 9. مسار Web Intent — مؤكد الآن (الفجوة التي تركها التقرير الأصلي مفتوحة)
- الرابط: **`https://x.com/intent/tweet`** — المعاملات المدعومة: `text`، `url`، `hashtags`، `via`، `related`، `in_reply_to`.
- **لا يتطلب تطبيقاً ولا مفاتيح ولا OAuth، ولا تكلفة.**
  المصدر: https://docs.x.com/x-for-websites/post-button/guides/web-intent

### 10. الحصول على الوصول
- ثلاث خطوات ذاتية الخدمة: إنشاء حساب مطور على `console.x.com`، إنشاء تطبيق (بـ name/description/use case)، حفظ المفاتيح. **لا توجد عملية مراجعة أو موافقة موصوفة** في هذه الصفحة.
  المصدر: https://docs.x.com/x-api/getting-started/getting-access

---

## غير مؤكد / تغيّر

| الادعاء في التقرير | الوضع بعد التحقق |
|---|---|
| «أُعيد التسعير في **20 أبريل 2026**» | **تصحيح جزئي.** إدخال سجل التغييرات مؤرَّخ **16 أبريل 2026** بعنوان *"X API pricing update: Owned Reads now $0.001"*، وسريان التغيير **20 أبريل 2026**. التاريخان مختلفان — الإعلان 16، النفاذ 20. المصدر: https://docs.x.com/changelog |
| «إطلاق PPU في **6 فبراير 2026**» | **مؤكد** من سجل التغييرات (Feb 6, 2026)، ويسبقه Oct 20, 2025 كإطلاق تجريبي مغلق. المصدر: https://docs.x.com/changelog |
| «ترحيل مشتركي Basic القدامى بعد **1 يونيو 2026**» | **غير مؤكد من وثيقة أساسية.** لا يوجد إدخال في `docs.x.com/changelog` بهذا الشأن. مصدره حساب @XDevelopers الرسمي ومنتدى devcommunity — وكلاهما لم يُجلب مباشرة (403). اعتبره صحيحاً بترجيح عالٍ لا يقيناً. |
| «Basic القديمة 200 $/شهر مقابل **10K منشور**» | **خطأ على الأرجح / غير مؤكد.** المصادر الثانوية تذكر أرقاماً مختلفة تماماً (نحو 50,000 إنشاء منشور و 15,000 قراءة). لا يمكن التحقق: `developer.x.com` يعيد **HTTP 402**. الرقم غير حامل لأي قرار. |
| «Pro القديمة 5,000 $/شهر مقابل **1M منشور**» | **خطأ على الأرجح.** 1M كان تاريخياً سقف **القراءة** لا الكتابة (الكتابة كانت في حدود 300,000/شهر). غير قابل للتحقق حالياً. |
| «Enterprise يبدأ من ~42,000 $/شهر» | **غير مؤكد — سماع من طرف ثالث.** لا صفحة أساسية تذكر رقماً. X توجّه Enterprise عبر نموذج تواصل. لا تبنِ عليه ميزانية. |
| «صفحة التسعير تذكر Enterprise كخيار» | **مؤكد جزئياً:** تُذكر Enterprise فقط كمسار لتجاوز سقف 2M قراءة، **بدون سعر**. |
| موضع العبارة «(as described at developer.x.com)» داخل §III.L | **تصحيح نصّي.** التقرير الأصلي وضعها بعد "plans"؛ النص الفعلي يضعها بعد **"an Enterprise plan"** في الجملة الأخيرة. فرق دلالي بسيط لكنه يغيّر معنى الاقتباس. |
| «نقاط v1.1 للوسائط غير مُلغاة رسمياً ولا يوجد تاريخ إيقاف منشور» | **مؤكد بالسلب:** لا يوجد إشعار إيقاف في https://docs.x.com/x-api/media/introduction. هذا غياب دليل لا دليل غياب — لا تبنِ على v1.1 رغم ذلك. |
| «لا توجد باقة مجانية» | **مؤكد بالسلب من الوثيقة الأساسية** (صفحة التسعير خالية من أي حصة مجانية)، ومدعوم بمصادر ثانوية. لا يوجد حد أدنى إلزامي للشراء مذكور في الوثيقة. |
| جداول التكلفة الشهرية (300 $ / 1,200 $ / 3,000 $ ... و 3,450 $ ≈ 12,900 ريال) | **الحساب صحيح رياضياً** بناءً على الأسعار المؤكدة أعلاه. لكن بند «تحليلات القراءات» (+45/180/450 $) قائم على **افتراض** إعادة قراءة كل منشور مرة يومياً — افتراض التقرير لا حقيقة موثّقة، وهو تقدير سقفي. |
| «سقف 20 منشوراً لكل منشأة يومياً عند 500 منشأة» | **صحيح حسابياً**: 10,000 ÷ 500 = 20، بناءً على حد 10,000/24 ساعة لكل تطبيق المؤكد. |
| دلالات دوران وانتهاء refresh token | **مؤكد أنها غير موثّقة.** تعامل دفاعياً: خزّن refresh_token الجديد بعد كل تجديد، وافترض إمكانية الإلغاء في أي وقت. |

**فجوتان بقيتا مفتوحتين:** `developer.x.com` يعيد HTTP 402 و`devcommunity.x.com` يعيد 403 — كل ما يخص أسعار Enterprise وتفاصيل الباقات القديمة يستند إلى ملخصات بحث لا إلى نص أساسي. لا شيء من ذلك يغيّر التوصية.

---

## الخلاصة العملية

- **لا تبنِ النشر عبر API. ابنِ «تأليف + مشاركة بنقرة واحدة».** رابط `https://x.com/intent/tweet?text=...&url=...` مؤكد من وثيقة X الرسمية: **بلا تطبيق، بلا مفاتيح، بلا OAuth، بتكلفة صفر**. RBT360 يحتفظ بالقيمة الحقيقية (توليد المحتوى والصورة) ويسقط 100% من المسؤولية القانونية وتكلفة الـ API. هذه هي المعمارية الصحيحة لا خطة الطوارئ.

- **إن أُصرّ على API: امنع الروابط داخل نص المنشور.** 0.200 $ مقابل 0.015 $ رقم مؤكد من صفحة التسعير — إخراج الرابط من المنشور إلى الـ bio يخفض الفاتورة **13.3 ضعفاً** (3,000 $ إلى 225 $ شهرياً عند 500 منشأة).

- **§III.L مُلزِمة لا اختيارية.** النص المؤكد يقصر PPU/Basic/Pro على *"applications with a limited number of end-users"* ويوجب طلب Enterprise عند التجاوز. حدّ التجربة عند 50 منشأة، وافتح محادثة Enterprise قبل تجاوز ~100.

- **حظر المحتوى المكرر خطر إيقاف لا مسألة ذوق.** *"Never post identical or substantially similar content across multiple accounts"* — إن نشرتَ عبر API فافرض تفرّد النص خادمياً (hash-check عبر المستأجرين) وامنع المتشابهات.

- **واجهة الموافقة إلزامية نصياً:** اعرض المنشور المُصاغ بالضبط قبل النشر (*"Show exactly what will be published"*)، وسجّل الموافقة، وأضف تصريح البوت في الـ bio.

- **العبء التشغيلي حقيقي:** access token صالح **ساعتان فقط**، و`offline.access` شرط لإصدار refresh token، ودوران/انتهاء refresh token **غير موثّق**. 500 توكن مشفّرة + تجديد كل ساعتين + معالجة الإلغاء — كلها بنية تحتية يجب بناؤها قبل أول منشور. `client_secret` يبقى في Cloud Function ولا يقترب من حزمة React (التطبيق confidential client بنص الوثيقة).

---

# tiktok-snap

All claims checked against primary docs. Below is the corrected report.

---

# TikTok + Snapchat Publishing APIs — نسخة مُدقّقة (تحقّق عدائي)

الحكم النهائي لم يتغيّر: **TikTok صالح للبناء، Snapchat مغلق عملياً.** لكن رقماً واحداً في التقرير الأصلي كان خاطئاً، واقتباساً واحداً لم يعد مطابقاً لنص الصفحة.

---

## الحقائق المؤكدة

### TikTok — نقاط النهاية والصلاحيات

| العنصر | القيمة المؤكدة | المصدر |
|---|---|---|
| نشر مباشر (فيديو) | `POST /v2/post/publish/video/init/` | [direct-post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post) |
| نشر مباشر (صور) | `POST /v2/post/publish/content/init/` | [get-started](https://developers.tiktok.com/doc/content-posting-api-get-started) |
| معلومات المنشئ (خطوة إلزامية) | `POST /v2/post/publish/creator_info/query/` | [get-started](https://developers.tiktok.com/doc/content-posting-api-get-started) |
| حالة النشر | `POST /v2/post/publish/status/fetch/` | [get-started](https://developers.tiktok.com/doc/content-posting-api-get-started) |
| مسودة الوارد (Inbox) | `POST /v2/post/publish/inbox/video/init/` | [upload-content](https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content) |
| `video.publish` | "Directly post content to a user's TikTok profile." | [scopes](https://developers.tiktok.com/doc/tiktok-api-scopes) |
| `video.upload` | "Share content to creator's account as a draft to further edit and post in TikTok." | [scopes](https://developers.tiktok.com/doc/tiktok-api-scopes) |

### TikTok — قيد التدقيق (البوابة الحرجة)

مؤكد حرفياً في [content-sharing-guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines):
- **"Unaudited API Clients can allow up to 5 users to post in a 24 hour window."** — الرقم 5 صحيح.
- جميع الحسابات يجب أن تكون **private** وقت النشر؛ المشاهدة محصورة بـ `SELF_ONLY`.
- في [get-started](https://developers.tiktok.com/doc/content-posting-api-get-started): "All content posted by unaudited clients will be restricted to private viewing mode."
- رمز الخطأ `unaudited_client_can_only_post_to_private_accounts` مؤكد في مرجع direct-post.

### TikTok — واجهة الامتثال المطلوبة (مؤكدة بالكامل)

من [content-sharing-guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines):
- عرض **nickname** المنشئ حتى يعرف المستخدم أي حساب سيستقبل المنشور.
- قائمة خصوصية منسدلة **بلا قيمة افتراضية**، مبنية على استجابة `creator_info`.
- مفاتيح التفاعل: Allow Comments / Allow Duet / Allow Stitch — **جميعها معطّلة افتراضياً**، ورمادية إن كانت معطّلة في إعدادات الحساب.
- مفتاح المحتوى التجاري (off افتراضياً) مع خياري "Your brand" و"Branded content".
- نص الإقرار: **"By posting, you agree to TikTok's Music Usage Confirmation."** (تتغيّر الصيغة عند اختيار Branded content.)

### TikTok — الحدود والوسائط

- **6 requests per minute** لكل `access_token` — مؤكد حرفياً.
- العنوان (title/caption): **2200 UTF-16 runes** — مؤكد.
- **`upload_url` صالح ساعة واحدة فقط** بعد إصداره — تفصيلة لم ترد في التقرير الأصلي وهي مهمة تشغيلياً.
- فيديو: **4GB** حداً أقصى، **10 دقائق** حداً أقصى عبر الـ API، MP4/WebM/MOV، H.264/H.265/VP8/VP9، **23-60 FPS**، دقة **360px** حداً أدنى و**4096px** حداً أقصى.
- صور: **20MB** لكل صورة، **1080p** حداً أقصى، WebP و JPEG فقط.
- الرفع المجزّأ: كل جزء **5MB** حداً أدنى و**64MB** حداً أقصى (الأخير حتى **128MB**)، من **1 إلى 1000** جزء، **تسلسلياً**.
- المصدر: [media-transfer-guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)

### TikTok — المراجعة

- **"App review may take several days to two weeks after submission."** — مؤكد حرفياً في [FAQ](https://developers.tiktok.com/doc/getting-started-faq).
- فيديو تجريبي واحد على الأقل، بحد أقصى **5 فيديوهات × 50MB**.
- المراجعة الأولى **تُلزمك باستخدام sandbox** في Developer Portal.
- روابط Privacy Policy و Terms of Service يجب أن تكون **ظاهرة دون فتح قائمة** وفعّالة.
- **"Apps that are still in development or testing will not be approved"** — مؤكد حرفياً.
- المصدر: [app-review-guidelines](https://developers.tiktok.com/doc/app-review-guidelines)

### Snapchat — البوابة المغلقة

- نقاط النهاية موجودة فعلاً: `POST https://businessapi.snapchat.com/v1/public_profiles/{profile_id}/media` ثم `/stories` أو `/saved_stories` أو `/spotlights` — [ProfileAssetManagement](https://developers.snap.com/api/marketing-api/Public-Profile-API/ProfileAssetManagement).
- **allowlist فقط**: النص الحالي "currently allowlist only" و"send just the client ID to your Snap contact, and they will coordinate allowlisting your app" — [GetStarted](https://developers.snap.com/marketing-api/Public-Profile-API/GetStarted). لا يوجد نموذج تقديم ولا طابور مراجعة عام.
- الصلاحية: `snapchat-profile-api`.
- تطبيق OAuth يُنشأ في **Ads Manager → Business Dashboard**، مع تحذير صريح: "Do not use the Developer Portal to generate the OAuth App. The Client ID will not work with the Public Profile API."
- حساب أعمال (Organization) مع Snap إلزامي.
- Stories: mp4، **5-60 ثانية**، **540x960** حداً أدنى. Spotlights: mp4، **6-60 ثانية**، **540x960** حداً أدنى.
- Creative Kit ليس API نشر: يسلّم المحتوى لكاميرا سناب ثم "users can apply any of Snapchat's creative tools to edit the shared content before sending it" — [creative-kit](https://developers.snap.com/snap-kit/creative-kit/overview). والـ SDK "will continue to work, however it will no longer be updated".
- Login Kit SDKs قيد الإهمال لصالح OAuth2 المباشر، والخدمة الأساسية "remains fully available"، **بلا تاريخ إيقاف منشور** — [login-kit](https://developers.snap.com/snap-kit/login-kit/overview).

---

## غير مؤكد / تغيّر

**1. خطأ رقمي: Spotlight ليس "1GB حداً أقصى".**
التقرير الأصلي كتب "Spotlights … max 1 GB". النص الفعلي يفصل بين أمرين: **الملف الواحد 32MB حداً أقصى**، و**1GB هي السعة الكلية عبر الرفع المجزّأ (multipart)**. هذا فرق جوهري لمن يصمّم خط الرفع. تصحيح: 32MB لكل جزء، 1GB إجمالاً.

**2. اقتباس Snapchat لم يعد مطابقاً.**
التقرير نسب لصفحة GetStarted جملتين: "This API requires allow listing to access." و"send an email to your Snap point of contact with your OAuth client id and a description of your intended use. Please do not send your client secret." الصفحة اليوم تقول "currently allowlist only" و"send just the client ID to your Snap contact". **الجوهر صحيح تماماً** (allowlist عبر جهة اتصال في Snap)، لكن الاقتباسات الحرفية قديمة — لا تنسخها في مستند تعاقدي.

**3. "Snap public profile APIs are read only" — لم أتحقّق منه.**
لم أفتح صفحة Profiles. يبقى ادعاءً غير مؤكد؛ لا تبنِ عليه استنتاجاً.

**4. اسما `action="ADD"` و`FINALIZE` — غير مؤكدين حرفياً.**
التوثيق يعرض `{add_path}` و`{finalize_path}` كمسارات تعود من استجابة إنشاء الوسائط. التسلسل صحيح، لكن أسماء المعاملات الحرفية لم تُثبت.

**5. سقف النشر اليومي لكل حساب — غير مرقّم (تأكيد لتحفّظ التقرير).**
لا رقم في أي مصدر أوّلي. لكن وجود السقف **مؤكد** عبر رمزي خطأ: `spam_risk_too_many_posts` ("The daily post cap from the API is reached for the current user") و`reached_active_user_cap`. رقم "15/يوم" المتداول يبقى **غير مؤكد** — عالجه بالتقاط رمز الخطأ لا بعدّاد محلي.

**6. أهلية الكيان السعودي — صامتة في المصادر الأولية (تأكيد لتحفّظ التقرير).**
راجعت FAQ وApp Review Guidelines: **لا ذكر لأي قيد جغرافي، ولا تأكيد إيجابي**. التحفّظ في التقرير الأصلي كان في محله. لا سبيل للحسم سوى التسجيل الفعلي.

**7. التكلفة — "لا رسوم موثّقة" ادعاء سلبي.**
لم أعثر على رسوم في أي من الصفحتين لدى الطرفين، وهذا يدعم الادعاء، لكن غياب الذكر ليس إثباتاً للمجانية. صياغة أدق: لا رسوم منشورة.

**8. مدد صلاحية التوكن (token TTLs) — لم يدّعِ التقرير أرقاماً، ولم أتحقّق منها.**
الرقم الزمني الوحيد المؤكد هو **صلاحية `upload_url` لساعة واحدة**. إن احتجت TTL لـ access/refresh token فهو بحث منفصل لم يُجرَ.

**9. "التدقيق خطوة منفصلة بعد موافقة التطبيق" — مؤكد جزئياً.**
يدعمه وجود رابط تقديم مستقل (`developers.tiktok.com/application/content-posting-api`) داخل صفحة get-started. تسلسل المراجعتين معقول لكنه غير منصوص عليه صراحة كترتيب إلزامي.

---

## الخلاصة العملية

- **ابنِ TikTok فقط. لا تصمّم بنية لنشر Snapchat.** بوابة سناب علاقة تجارية مع مندوب، لا تسجيل مطوّر — ولا يوجد نموذج تقديم أصلاً. البديل لسناب: ولّد الأصل بالمقاس الصحيح (mp4، 5-60 ثانية، 540x960 فأعلى) ودع الموظف ينشره يدوياً.
- **التدقيق ليس اختيارياً.** قبله: كل منشور `SELF_ONLY`، و5 مستخدمين فقط كل 24 ساعة، وكل الحسابات يجب أن تكون private. لا تعِد أي منشأة بنشر عام قبل اجتياز التدقيق. خطّط لمراجعتين متتاليتين: مراجعة التطبيق (عدة أيام إلى أسبوعين) ثم تدقيق النشر.
- **شاشة النشر عمل حقيقي لا زر.** nickname حيّ من `creator_info`، قائمة خصوصية بلا افتراضي، ثلاثة مفاتيح تفاعل معطّلة افتراضياً، مفتاح محتوى تجاري، ونص Music Usage Confirmation حرفياً. إسقاط أي عنصر يعني رسوب التدقيق.
- **احترس من `upload_url` الصالح ساعة واحدة فقط** — لا تُصدره ثم تصفّه في طابور معالجة طويل. وقيّد الطلبات بـ 6/دقيقة لكل توكن مستخدم.
- **لا تحسب السقف اليومي محلياً.** التقط `spam_risk_too_many_posts` و`reached_active_user_cap` من الاستجابة وتعامل معهما، لأن الرقم غير منشور وقد يتغيّر.
- **ابدأ بـ `video.upload` (مسودة الوارد) كإصدار أول** إن أردت الشحن قبل التدقيق: المنشئ يكمل النشر داخل تطبيق TikTok، فتتجنّب ألم قيود الرؤية بينما تلاحق التدقيق للانتقال إلى `video.publish`.

---

# meta-whatsapp-cost

# تقرير مُصحَّح: تكلفة WhatsApp من Meta (تحقّق خصومي)

جميع الأرقام أدناه أُعيد استخراجها بشكل مستقل من مصادر Meta الأولية أثناء هذا التحقّق، لا من الذاكرة.

## الحقائق المؤكدة

### 1. نموذج التسعير: لكل رسالة، منذ 1 يوليو 2025
- التحوّل من conversation-based إلى per-message تم في 1 يوليو 2025.
- الفئات: Marketing / Utility / Authentication / Authentication-International / Service.
- التحديثات تحدث فقط في أول يوم من كل ربع (1 يناير، 1 أبريل، 1 يوليو، 1 أكتوبر)، بإشعار مسبق: شهر واحد لتحديث الأسعار، 3 أشهر لإضافات النموذج، 6 أشهر للتغييرات الهيكلية.
- المصدر: https://developers.facebook.com/docs/whatsapp/pricing/

### 2. أسعار السعودية (market=SA) — مؤكدة من نقطة Meta الحيّة
تم استدعاء نقطة النهاية الرسمية التي تُغذّي حاسبة الأسعار والحصول على استجابة فعلية (وليس من مدونة طرف ثالث):

| الفئة | USD (الأساس) | USD (أعلى شريحة) | SAR (الأساس) | SAR (أعلى شريحة) |
|---|---|---|---|---|
| Marketing | 0.0501 | لا توجد شرائح | 0.1877 | لا توجد شرائح |
| Utility | 0.0107 | 0.0080 | 0.0401 | 0.0301 |
| Authentication | 0.0107 | 0.0080 | 0.0401 | 0.0301 |
| Authentication International | 0.0598 | 0.0449 | 0.2240 | 0.1680 |
| Service | 0.0000 | — | 0 | — |

شرائح الحجم (USD، السعودية) — مؤكدة حرفياً من الاستجابة:
- Utility: 0–100,000 = 0.0107 | 100,001–1,000,000 = 0.0102 | 1,000,001–4,500,000 = 0.0096 | 4,500,001–40,000,000 = 0.0091 | 40,000,001–80,000,000 = 0.0086 | 80,000,001+ = 0.0080
- Authentication و Authentication International: 0–300,000 | 300,001–2,000,000 | 2,000,001–10,000,000 | 10,000,001–20,000,000 | 20,000,001–40,000,000 | 40,000,001+
- المصدر: https://whatsappbusiness.com/products/platform-pricing/ (رسمي، تُحوِّل إليه business.whatsapp.com) و https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

### 3. السعودية ضمن قائمة Authentication-International
القائمة الرسمية الكاملة: مصر، الهند، إندونيسيا، ماليزيا، نيجيريا، باكستان، **السعودية**، جنوب أفريقيا، الإمارات.
- المصدر: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/authentication-international-rates/

### 4. نافذة خدمة العميل (CSW) والمجاني
- تبدأ نافذة 24 ساعة عندما يراسلك المستخدم **أو يتصل بك**؛ وتُعاد لـ 24 ساعة كاملة مع كل رسالة/مكالمة جديدة منه.
- داخل النافذة: أي رسالة غير قالب مجانية. خارجها: قوالب معتمدة فقط.
- **قوالب Utility داخل CSW مفتوحة = مجانية** (سارية منذ 1 يوليو 2025). Webhook يُظهر `"billable": false, "pricing_model": "PMP", "type": "free_customer_service", "category": "utility"`.
- الرسائل غير القوالب مجانية منذ 1 نوفمبر 2024، بـ `"category": "service"`.
- **Service conversations مجانية للجميع** منذ 1 نوفمبر 2024 — لا سقف شهري.
- Free Entry Point: عبر Click-to-WhatsApp Ads أو زر CTA في صفحة فيسبوك؛ الرد خلال 24 ساعة يفتح نافذة **72 ساعة** يكون فيها أي نوع رسالة (بما فيه Marketing) مجانياً.
- Marketing لا يكون مجانياً أبداً داخل CSW عادية.
- المصادر: https://developers.facebook.com/docs/whatsapp/pricing/ • https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages • https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status

### 5. حدود المراسلة — لا توجد شريحة 1,000
- الشرائح: **250 → 2,000 → 10,000 → 100,000 → Unlimited**.
- تُحسب: أرقام مستخدمين فريدة تُسلَّم لها رسائل **خارج** CSW خلال نافذة متحركة 24 ساعة.
- **على مستوى business portfolio وليس لكل رقم**: نصّ Meta — "If a business portfolio has multiple business phone numbers, it's possible for one number to consume all of the portfolio's messaging capability."
- 250 → 2,000: توثيق الأعمال، أو توثيق عبر شريك، أو 2,000 رسالة مُسلَّمة خارج النافذة لمستخدمين فريدين خلال 30 يوماً بجودة قوالب عالية.
- الترقية التلقائية فوق 2,000: جودة عالية عبر كل الأرقام والقوالب **و** استهلاك ≥ نصف الحد الحالي خلال آخر 7 أيام؛ الترقية تتم خلال 6 ساعات.
- المصدر: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits

### 6. الفوترة: Solution Partner مقابل Tech Provider
- Embedded Signup: "Business customers onboarded via Embedded Signup own all of their WhatsApp assets" — الملكية دائماً للمنشأة، ولا يمكن حجب وصولها إلى WhatsApp Manager.
- **Solution Partner**: لديه خط ائتمان ويشاركه؛ نصّ Meta الحرفي — "You are the 'Bill To Party' for all businesses sharing your credit line. You are liable for and will pay Meta for all WhatsApp Business Platform spend made by these businesses." ويفوتر عملاءه مباشرة بدل أن تفوترهم Meta.
- **Tech Provider / Tech Partner**: لا خط ائتمان؛ Meta تفوتر العميل مباشرة، والعميل يجب أن يضيف وسيلة دفع لحسابه **بعد اكتمال التسجيل** (خارج تدفق Embedded Signup نفسه).
- فخ حرفي: "Credit lines cannot be changed after being attached to a WABA. If the WABA needs a different credit line, a new WABA must be created." والسحب ممكن في أي وقت عبر Meta Business Suite أو API، ويطال كل WABAs التابعة لمحفظة ذلك العميل.
- المصادر: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview • https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview • https://developers.facebook.com/docs/whatsapp/embedded-signup/manage-accounts/share-and-revoke-credit-lines/

### 7. لماذا لا يصلح رقم واحد مشترك لكل المنشآت
- "The On-Behalf-Of WABA ownership model is deprecated and is no longer possible."
- "A WABA must belong to only one business portfolio. You cannot have two or more portfolios owning one WABA."
- حد أولي **2 أرقام** لكل حساب أعمال، قابل للرفع حتى **20** فقط.
- وبما أن حدود المراسلة وتقييم الجودة على مستوى المحفظة، منشأة واحدة تُسيء الإرسال تخنق الجميع.
- المصدر: https://developers.facebook.com/docs/whatsapp/overview/business-accounts/

### 8. تصنيف القوالب (طلبات وإيصالات)
- Utility يتطلب **الشرطين معاً**: غير ترويجي وخالٍ من أي نية إقناع، **و** إما مخصّص للمستخدم/مطلوب منه أو أساسي/حرج له.
- أمثلة Meta الحرفية لتأكيد الطلب، الشحن، والاسترداد مؤكدة كما وردت في التقرير.
- يتحول القالب إلى Marketing عند: محتوى مختلط (تحديث طلب + عرض ترويجي)، أو محتوى غير واضح.
- الرفض يأتي بحالة `REJECTED` وسبب `INCORRECT_CATEGORY` عند اختلاف Meta مع الفئة التي اخترتها.
- المصدر: https://developers.facebook.com/docs/whatsapp/updates-to-pricing/new-template-guidelines

## غير مؤكد / تغيّر

1. **«نقطة النهاية عامة ومفتوحة» — غير دقيق.** الاستدعاء كما ورد في التقرير الأصلي يعيد HTTP 400: `{"code":"rest_missing_callback_param","message":"Missing parameter(s): _wab_nonce"}`. تعمل فقط مع `_wab_nonce` مستخرج من `restNonce` في صفحة التسعير. الاستدعاء الصحيح:
   `GET https://whatsappbusiness.com/wp-json/wab/v1/pricing?market=SA&currency=USD&category=Marketing&_wab_nonce=<restNonce>`
   الأرقام نفسها صحيحة بعد التصحيح.

2. **قيمة `category` لفئة الترجمة الدولية خاطئة.** `Authentication-International` تُعيد `{"code":"invalid_category"}`. القيمة الصحيحة بمسافة وبدون شرطة: `Authentication International`.

3. **«الأسعار سارية اعتباراً من 1 يوليو 2026» — غير مؤكد.** لم أجد في مصدر أولي ما يُثبت هذا التاريخ لبطاقة الأسعار الحالية. الصياغة الآمنة: هذه هي القيم التي تعيدها نقطة Meta الحيّة اليوم (2026-07-28).

4. **تاريخ تغيّرات أسعار السعودية — متضارب وغير مؤكد.** استخلاصان متتاليان من صفحة Updates to Pricing أعطيا نتائج متناقضة (مرة «1 أكتوبر 2025: رفع Marketing»، ومرة «1 أكتوبر 2025: رفع Utility و Authentication»؛ ومرة «1 أبريل 2025» ومرة «1 أبريل 2026» لرفع Marketing)، والصفحة تُبنى بـ JS ولا يمكن تثبيت نصّها. لذلك ادعاء التقرير الأصلي بأن «الأسعار انخفضت في 1 أكتوبر 2025» **مشكوك فيه ويُرجَّح أنه معكوس**. لا تبنِ قراراً على تاريخ محدد؛ استعلم من النقطة الحيّة قبل كل ربع.

5. **«إعادة التصنيف تحدث بصمت» — خطأ.** التوثيق يذكر **إشعاراً مسبقاً بيوم واحد** قبل تغيير الفئة، ما لم تُرصد إساءة استخدام متعمدة (عندها بلا إشعار).

6. **«Meta تنصّ على أن الشركات مسؤولة عن مراجعة الفئات وتقبل الرسوم» — غير مؤكد.** لم أعثر على هذه الجملة في المصدر الأولي. الصحيح: القالب المُعاد تصنيفه يُسعَّر بسعر فئته الجديدة، وهذا استنتاج من نموذج التسعير لا اقتباس.

7. **«FEP على Android/iOS فقط» — غير مؤكد.** لم يظهر هذا القيد في التوثيق الحالي. النافذة 72 ساعة ومصادر الدخول (إعلانات Click-to-WhatsApp وزر CTA) مؤكدة، أما قيد المنصة فلا.

8. **«العميل يُدخل بطاقة أثناء Embedded Signup في نموذج Tech Provider» — تصحيح طفيف.** التوثيق يقول: يضيف وسيلة الدفع **بعد** اكتمال التسجيل، خارج تدفق التسجيل نفسه.

9. **«الأرقام المتداولة 0.0118 و 0.0375 قديمة» — لم أتحقق منها.** المؤكد فقط أن القيمة الحيّة اليوم هي 0.0501. ما زالت مدونات كثيرة تنشر 0.0375، وبعضها يكرر خرافة «1,000 محادثة خدمة مجانية شهرياً» الملغاة منذ 1 نوفمبر 2024.

## الخلاصة العملية

- **صمّم على أن Utility داخل CSW = صفر.** كل تحديث طلب/جاهزية/إيصال يُرسَل لمستخدم راسلك خلال آخر 24 ساعة لا يُكلّف شيئاً. اجعل مسار QR/الطلب يبدأ بمراسلة الديّن للمنشأة، وخزّن `lastInboundAt` لكل عميل واحسب النافذة قبل الإرسال — الفرق بين 0.0000 و 0.0107 للرسالة الواحدة.
- **افصل قوالب الطلب عن أي ترويج فصلاً تاماً.** جملة تسويقية واحدة داخل قالب حالة الطلب تنقله إلى Marketing، أي من 0.0107 إلى **0.0501** للرسالة (زيادة 4.7x)، وتُفقده المجانية داخل النافذة.
- **ميزانية الحملات: 0.0501 دولار / 0.1877 ﷼ للمستلم، بلا أي خصم حجم في السعودية.** حملة لـ 5,000 مستلم = 250.50 دولار / 938.50 ﷼. اعرض هذا الرقم في واجهة الحملات قبل الإرسال.
- **لا تبنِ على رقم WhatsApp واحد مشترك.** OBO ملغى، الـ WABA لمحفظة واحدة فقط، الحد 2 أرقام (حتى 20)، وحدود المراسلة والجودة على مستوى المحفظة — منشأة واحدة تُسقط الجميع. الحل: WABA لكل منشأة عبر Embedded Signup.
- **اختر نموذج الفوترة بوعي بالمسؤولية.** Solution Partner = تحصّل أنت وتسوّق سعراً شاملاً، لكنك «Bill To Party» ومسؤول أمام Meta عن إنفاق كل منشأة. Tech Provider = صفر مسؤولية مالية مقابل احتكاك تسجيل (بطاقة لكل منشأة). وإن اخترت الائتمان: خط الائتمان **لا يُغيَّر بعد ربطه بـ WABA** — الاختيار نهائي عملياً.
- **لا تُثبّت الأسعار في الكود.** ضع جدول أسعار قابلاً للتحديث + مهمة ربع سنوية (1 يناير/أبريل/يوليو/أكتوبر) تعيد الاستعلام من نقطة Meta مع `_wab_nonce` وتُحدّث عدّادات الإنفاق لدى المنصة.

---

# gemini-firebase-cost

All primary sources checked. Several load-bearing numbers are wrong — chiefly the Gemini 3.1 image models and two arithmetic slips.

---

# نموذج التكلفة — نسخة مصحّحة بعد التحقق العدائي (2026-07-28)

## الحقائق المؤكدة

### 1. أسعار Gemini (لكل 1M توكن، دولار) — https://ai.google.dev/gemini-api/docs/pricing.md.txt

| الموديل | Input | Output | Batch in/out | Cache | Free tier |
|---|---|---|---|---|---|
| `gemini-2.5-flash` | 0.30 (نص/صورة/فيديو)، 1.00 (صوت) | 2.50 | 0.15 / 1.25 | 0.03 + 1.00/1M/hr | نعم |
| `gemini-2.5-flash-lite` | 0.10 / 0.30 (صوت) | 0.40 | 0.05 / 0.20 | 0.01 | نعم |
| `gemini-2.5-pro` | 1.25 (≤200k) / 2.50 | 10.00 / 15.00 | 0.625–1.25 / 5.00–7.50 | 0.125 / 0.25 + 4.50/1M/hr | نعم |
| `gemini-2.5-flash-image` | 0.30 | **0.039 للصورة** (1290 توكن لصورة 1024×1024) | 0.15 / **0.0195** | — | **لا** |
| `gemini-3.1-pro-preview` | 2.00 (≤200k) / 4.00 | 12.00 / 18.00 | 1.00–2.00 / 6.00–9.00 | 0.20 / 0.40 + 4.50/1M/hr | **لا** |
| `gemini-3.6-flash` | 1.50 | 7.50 | 0.75 / 3.75 | 0.15 | نعم |
| `gemini-3.5-flash` | 1.50 | 9.00 | 0.75 / 4.50 | 0.15 | نعم |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | 0.15 / 1.25 | 0.03 | نعم |
| **`gemini-3.1-flash-lite`** | **0.25** / 0.50 (صوت) | **1.50** | 0.125 / 0.75 | 0.025 | **نعم** |
| `gemini-3-flash-preview` | 0.50 / 1.00 (صوت) | 3.00 | 0.25 / 1.50 | 0.05 | نعم |

- عنوان عمود الإخراج حرفياً: **"Output price (including thinking tokens)"** — توكنات التفكير تُحاسب بسعر الإخراج العادي، لا SKU منفصل. مؤكد.
- Priority tier لـ `gemini-2.5-flash-image`: **0.54 إدخال / 0.0702 للصورة**. مؤكد.
- **لا يوجد صف باسم `gemini-3-pro`** (بدون image/preview) على الصفحة. صفوف Pro الموجودة: `gemini-3.1-pro-preview` و `gemini-2.5-pro` فقط. مؤكد.
- `gemini-2.5-flash` أرخص 5× في الإدخال و3× في الإخراج من `gemini-3.6-flash`. مؤكد حسابياً من الجدول.

### 2. الطبقة المجانية وحدود المعدل — https://ai.google.dev/gemini-api/docs/rate-limits

- الصفحة **لم تعد تنشر جداول RPM/TPM/RPD لكل موديل**. النص: *"Rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio"* مع رابط https://aistudio.google.com/rate-limit. **مؤكد** — أي رقم RPM/RPD منقول من مدونة غير قابل للتحقق.
- حدود الإنفاق (نافذة 10 دقائق): Free = N/A، **Tier 1 = $10**، **Tier 2 = $200**، **Tier 3 = $200**. سقوف الفوترة: Tier 1 = $250، Tier 2 = $2,000، Tier 3 = $20,000–$100,000+. مؤكد.
- التأهيل: Tier 1 = ربط حساب فوترة نشط؛ Tier 2 = دفع $100 + 3 أيام؛ Tier 3 = دفع $1,000 + 30 يوماً. مؤكد.
- **Free tier: "Content used to improve our products" / Paid tier: "Content not used to improve our products"**. مؤكد حرفياً — هذا وحده يمنع استخدام الطبقة المجانية لبيانات عملاء المطاعم.

### 3. Firestore — https://cloud.google.com/firestore/pricing و https://firebase.google.com/docs/firestore/pricing

- **قراءة: $0.03 لكل 100,000** — مؤكد. **كتابة: $0.09 لكل 100,000** — مؤكد.
- الحصص المجانية اليومية: **50,000 قراءة / 20,000 كتابة / 20,000 حذف / 1 GiB تخزين / 10 GiB نقل خارجي شهرياً**. مؤكد من firebase.google.com/pricing و docs/firestore/pricing.
- **التحذير الحقيقي (بصيغة مصحّحة):** *"Cloud Firestore allows exactly one free database per project"* — قاعدة بيانات واحدة فقط لكل مشروع تحصل على الحصة المجانية، وهي **أول قاعدة تُنشأ**، لا بالضرورة `(default)`. أي قاعدة إضافية تدفع من المستند الأول.
- TTL deletes و PITR و backups و restore **لا تستفيد من الحصة المجانية إطلاقاً**. مؤكد.

### 4. Cloud Functions / Cloud Run

- **Firebase Blaze (مؤكد من https://firebase.google.com/pricing):** استدعاءات 2M مجاناً ثم **$0.40/مليون**؛ **400,000 GB-second** مجاناً؛ **200,000 CPU-second** مجاناً؛ نقل خارجي 5 GB مجاناً ثم **$0.12/GB**؛ Cloud Build 120 دقيقة/يوم ثم $0.003/دقيقة.
- **Cloud Functions 1st gen (مؤكد من https://cloud.google.com/functions/pricing-1stgen):** GB-second $0.0000025 (Tier 1) / $0.0000035 (Tier 2)؛ GHz-second $0.0000100 (Tier 1) / $0.0000140 (Tier 2)؛ خامل $0.000001042 / $0.00000146؛ استدعاء $0.0000004؛ مجاني: 2M استدعاء + 400,000 GB-s + 200,000 GHz-s + 5 GB نقل؛ **1 vCPU = 2.4 GHz**؛ الفوترة **بزيادات 100ms مقرَّبة للأعلى**.
- Hosting: تخزين 10 GB مجاناً ثم **$0.026/GB**؛ نقل 360 MB/يوم ثم **$0.15/GB**. مؤكد.
- Cloud Storage for Firebase: `*.firebasestorage.app` = 5 GB-months + 100 GB تنزيل/شهر مجاناً؛ `*.appspot.com` = 5 GB ثم $0.026/GB، تنزيل 1 GB/يوم ثم $0.12/GB، عمليات رفع 20K/يوم ثم $0.05/10K، تنزيل 50K/يوم ثم $0.004/10K. مؤكد.

### 5. Cloud Scheduler — https://cloud.google.com/scheduler/pricing

- **3 وظائف مجانية شهرياً لكل حساب فوترة** (لا لكل مشروع). مؤكد.
- **$0.10 لكل وظيفة شهرياً**، محسوبة $0.003/يوم تناسبياً. مؤكد.
- الفوترة **لكل وظيفة لا لكل تنفيذ** — وظيفة كل 15 دقيقة تكلف كوظيفة شهرية. مؤكد.
- **الوظائف الموقوفة (paused) تُفوتر**. مؤكد.

### 6. Resend — https://resend.com/pricing

| الخطة | $/شهر | رسائل/شهر | حد يومي | نطاقات | تجاوز/1K |
|---|---|---|---|---|---|
| Free | 0 | 3,000 | **100/يوم** | 1 | — |
| Pro | 20 | 50,000 | لا يوجد | 10 | 0.90 |
| Pro | 35 | 100,000 | لا يوجد | 10 | 0.90 |
| Scale | 90 | 100,000 | لا يوجد | 1,000 | 0.90 |
| Scale | 160 | 200,000 | لا يوجد | 1,000 | 0.80 |
| Scale | 350 | 500,000 | لا يوجد | 1,000 | 0.70 |
| Scale | 650 | 1,000,000 | لا يوجد | 1,000 | 0.65 |
| Scale | 825 | 1,500,000 | لا يوجد | 1,000 | 0.52 |
| Scale | 1,150 | 2,500,000 | لا يوجد | 1,000 | 0.46 |

الاحتفاظ 30 يوماً على كل الخطط غير المؤسسية. مؤكد.

### 7. WhatsApp — https://developers.facebook.com/docs/whatsapp/pricing

- الفوترة **لكل رسالة** منذ **2025-07-01**، وتُحتسب عند **تسليم** قالب فقط. مؤكد.
- **مجاني:** رسائل الخدمة كلها؛ الرسائل غير القالبية داخل نافذة 24 ساعة؛ **قوالب utility المرسلة داخل نافذة خدمة عملاء مفتوحة**؛ نوافذ 72 ساعة من إعلانات Click-to-WhatsApp.
- السعودية سوق مستقل على بطاقة الأسعار. مؤكد حرفياً: *"Effective April 1, 2026 … Saudi Arabia – Higher marketing message rate"* و *"Effective October 1, 2025 … Saudi Arabia – Lower utility and authentication rates"*.
- خصومات حجم (volume tiers) تنطبق على Utility و Authentication فقط. مؤكد.

---

## غير مؤكد / تغيّر

**أخطاء مؤكدة في التقرير الأصلي:**

1. **`gemini-3.1-flash-image` — أرقام خاطئة بالكامل.** التقرير قال: إدخال $2.00، إخراج $1.50 نص / $30.00 صور، $0.034 للصورة 1K. **الصحيح: إدخال $0.50، إخراج $3.00 نص / $60.00 صور**؛ توكنات الصورة 747 (0.5K) / **1120 (1K)** / 1680 (2K) / 2520 (4K) ⇒ **$0.0672 للصورة 1K**، $0.1008 (2K)، $0.1512 (4K). التقرير خلطه مع `gemini-3.1-flash-lite-image` ($0.25 إدخال، $30/1M صور ⇒ $0.0336 للصورة 1K).
   - **النتيجة تنقلب:** "التحويل إلى Nano Banana 2 = $102" **خطأ**. الحقيقة: 3,000 × $0.0672 = **$201.60 — أغلى بـ 1.7× من 2.5-flash-image**. البديل الأرخص فعلاً هو `gemini-3.1-flash-lite-image` = 3,000 × $0.0336 = **$100.80**.

2. **حساب كادنس 60 دقيقة خاطئ.** التقرير قال $6.39. الصحيح: 24 × 30,100 = 722,400 قراءة/يوم − 50,000 = 672,400 × 30 = 20,172,000 ÷ 100,000 × $0.03 = **$6.05**.

3. **"هامش 166 رسالة/منشأة" — تسمية خاطئة.** 50,000 − 30,000 = 20,000 ÷ 100 = **200 رسالة إضافية لكل منشأة**. الرقم 166 هو *عدد المنشآت* الأقصى (50,000 ÷ 300 = 166) أي **+66 منشأة**، لا رسائل.

4. **صياغة فخ Firestore غير دقيقة.** الصياغة الرسمية ليست "no free quota for named databases" بل *"exactly one free database per project"* — والحصة تذهب **لأول قاعدة تُنشأ**. الأثر العملي واحد لكن الشرط مختلف.

5. **حذف نموذجين أرخص من موديل العمل.** `gemini-3.1-flash-lite` ($0.25 in / $1.50 out) و `gemini-2.5-flash-lite` ($0.10 / $0.40) كلاهما أرخص من `gemini-2.5-flash` ($0.30 / $2.50) وكلاهما على الطبقة المجانية. التقرير حذفهما تماماً من التوصية.

**لم أستطع التحقق منه من مصدر أوّلي (اعتبره غير مؤكد):**

6. **أسعار Cloud Run gen-2** ($0.000024/vCPU-s، $0.0000025/GiB-s، $0.40/مليون طلب) و**الطبقة المجانية 180,000 vCPU-s / 360,000 GiB-s**. صفحة https://cloud.google.com/run/pricing تُقتطع آلياً ولم تُعطِ الأرقام. بحث على النطاق الرسمي أعاد **240,000 vCPU-second و450,000 GiB-second** — رقم مختلف. **الرقم الوحيد المؤكد هو رقم Firebase: 200,000 CPU-second + 400,000 GB-second + 2M استدعاء.** خلاصة القسم D لا تتأثر (صفر تحت أي من الثلاثة)، لكن جملة "بالكاد داخل 180,000" مبنية على رقم غير مؤكد — احذفها.

7. **أرقام Firestore التالية لم أستخرجها من الصفحة الأوّلية:** الحذف $0.01/100k، TTL $0.01/100k، التخزين $0.000205479/GiB-hour (≈$0.15/GiB-month)، النسخ الاحتياطي $0.000041096/GiB-hour، النقل الخارجي $0.12/$0.11/$0.08، عبر المناطق $0.01/GB، وخصومات الالتزام (1yr: $0.024/$0.072؛ 3yr: $0.018/$0.054). متسقة داخلياً ($0.000205479 × 730 = $0.15) لكن **غير محقَّقة**. المؤكد فقط: **القراءة $0.03 والكتابة $0.09 لكل 100,000**.

8. **أسعار me-central1 (الدوحة) / me-central2 (الدمام)** — لم تُستخرج. ادعاء "أعلى من us-central1" غير محقَّق. اسحبها من محدد المنطقة في الكونسول قبل أي قرار إقامة بيانات في السعودية.

9. **"قراءة واحدة لكل دفعة 1,000 مدخل فهرس"** — لم أجده في مصدر أوّلي.

10. **Resend: "10,000 automation runs/mo ثم $0.0015/run"** — لم يظهر في الجلب. غير مؤكد.

11. **أسعار واتساب للسعودية — لا تزال غير قابلة للاسترجاع آلياً.** الأرقام على شكل CSV/آلة حاسبة JS خلف نطاق يرفض الطلبات غير المصادقة. **لكن أرقام التقرير التوضيحية ($0.0157 utility / $0.0455 marketing) متناقضة مع اتجاه التغيير المؤكد من Meta نفسها:** utility انخفض في 2025-10-01، وmarketing ارتفع في 2026-04-01. مصادر ثانوية (BSPs، 2026) تذكر **SAR 0.0401 utility و SAR 0.1877 marketing** ≈ $0.0107 و $0.0501 عند 3.75. **كلا المجموعتين غير أوّلية — اسحب U و M من فاتورة الـ BSP قبل أي تسعير.**

---

## النموذج المصحّح — 100 منشأة

| البند | المنصة/شهر | المنشأة/شهر | الحالة |
|---|---:|---:|---|
| A. نص Gemini (`2.5-flash`): 40M in × $0.30 + 20M out × $2.50 | **$62.00** | $0.6200 | مؤكد |
| B. صور (`2.5-flash-image`): 3,000 × $0.039 + 0.6M × $0.30 | **$117.18** | $1.1718 | مؤكد |
| C. Firestore (سكيدولر 15د): 85,188,000 قراءة مفوترة ÷ 100k × $0.03 | **$25.56** | $0.2556 | مؤكد (سعر القراءة) |
| D. Cloud Functions: 2,880 استدعاء / 57,600 CPU-s / 28,800 GB-s | **$0.00** | $0.0000 | مؤكد |
| E. Cloud Scheduler: وظيفة واحدة ضمن الـ 3 المجانية | **$0.00** | $0.0000 | مؤكد |
| F. Resend Pro | **$20.00** | $0.2000 | مؤكد |
| **الإجمالي (بدون واتساب)** | **$224.74** | **$2.2474** | ≈ **8.43 ﷼/منشأة** |

**واتساب (متغير):** `WA = (60,000 × U) + (20,000 × M)`
- بأرقام التقرير الأصلية (مشكوك فيها): $942.00 + $910.00 = $1,852.00 ⇒ إجمالي $2,076.74 = **$20.77/منشأة**
- بأرقام BSP الثانوية 2026 (SAR 0.0401 / 0.1877): $641.60 + $1,000.83 = **$1,642.43** ⇒ إجمالي $1,867.17 = **$18.67/منشأة**
- كلاهما غير أوّلي. لا تبنِ تسعيراً عليهما.

**البدائل المصححة لسطر الصور (3,000 صورة):**

| الخيار | التكلفة |
|---|---:|
| `2.5-flash-image` batch ($0.0195) | **$58.50** |
| `3.1-flash-lite-image` 1K ($0.0336) | **$100.80** |
| `2.5-flash-image` standard ($0.039) | $117.00 |
| `3.1-flash-image` 1K ($0.0672) | $201.60 |
| `3-pro-image` 1K/2K ($0.1344) | $403.20 |

**البدائل لسطر النص (40M in / 20M out):**

| الموديل | التكلفة |
|---|---:|
| `2.5-flash-lite` | **$12.00** |
| `3.1-flash-lite` | **$40.00** |
| `2.5-flash` (الحالي) | $62.00 |
| `3.6-flash` | $210.00 |

---

## الخلاصة العملية

- **لا تحوّل الصور إلى `gemini-3.1-flash-image` ظناً أنه أرخص — هو أغلى 1.7×.** إن أردت تخفيض سطر الصور: `Batch` على `2.5-flash-image` يهبط بها من $117.00 إلى **$58.50** (نصف السعر، بلا تغيير موديل)، أو `gemini-3.1-flash-lite-image` إلى **$100.80**.
- **جرّب `gemini-3.1-flash-lite` أو `2.5-flash-lite` لمكالمات النص الروتينية.** الأول يخفض السطر من $62.00 إلى $40.00 والثاني إلى $12.00، وكلاهما على الطبقة المجانية للتجربة. اترك `2.5-flash` للمهام التي تحتاجه فعلاً.
- **السكيدولر هو نقطة Firestore الساخنة الوحيدة: $25.56/شهر لإعادة قراءة 86.7M مستند لم يتغيّر أكثرها.** إمّا فلترة `updatedAt > lastRun` (خفض ~95%)، أو الهبوط إلى كادنس 60 دقيقة ⇒ **$6.05/شهر** (لا $6.39).
- **وظيفة سكيدولر واحدة تتفرّع على المنشآت، لا وظيفة لكل منشأة.** المسار الثاني = (100 − 3) × $0.10 = **$9.70/شهر** مقابل $0.00 — والوظائف الموقوفة تُفوتر أيضاً.
- **الطبقة المجانية لـ Gemini ممنوعة في الإنتاج لسبب قانوني قبل أي سبب فني:** الصفحة تنص حرفياً على أن محتوى الطبقة المجانية **يُستخدم لتحسين منتجات Google**، والمدفوعة **لا**. بيانات طلبات العملاء تخرج من النقاش عند هذا الحد.
- **اسحب رقمي U و M للسعودية من فاتورة الـ BSP، لا من أي تقرير.** واتساب يمثّل ~89% من التكلفة المتغيرة، وأرقام السوق تغيّرت مرتين مؤكدتين (utility أدنى منذ 2025-10-01، marketing أعلى منذ 2026-04-01)، وتحديث آخر في 2026-10-01. أكبر رافعة توفير على الإطلاق: **قوالب utility داخل نافذة الـ 24 ساعة مجانية** — لو تأهّل 70% من الـ 600 رسالة utility، يهبط السطر بمقدار يفوق كل بنود Google مجتمعة.