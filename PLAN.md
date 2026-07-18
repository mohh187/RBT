# الخطة الرئيسية لإعادة بناء نظام نيمة كافيه (Neema Café)
## نظام طلب احترافي متكامل للمطاعم والمقاهي — Master Rebuild Blueprint

> **مذاق ينبت من الجذور — A taste that grows from the roots**
> الإصدار: 1.0 · التاريخ: 2026-06-24 · المؤلف: الهندسة الرئيسية

---

## 1. ملخص تنفيذي (Executive Summary)

### الرؤية
تحويل نيمة كافيه من **منيو ثابت بصفحة واحدة** (ملف `index.html` بطول 2352 سطراً يرسل الطلبات مباشرة إلى Telegram عبر توكن مكشوف) إلى **نظام تشغيل مطاعم احترافي كامل** (Restaurant OS) مبني على قاعدة بيانات واحدة كمصدر للحقيقة، مع طلب عبر QR لكل طاولة، ولوحة استقبال/مطبخ لحظية (KDS)، ولوحة تحكم إدارية كاملة بصلاحيات، ومحرك عروض، و CRM، وتقارير مبيعات حقيقية، وهوية بصرية فاخرة بخط Tajawal.

### ما الذي نبنيه (What we build)
| المكوّن | الوصف | الحالة اليوم |
|---|---|---|
| **منيو العميل** | عربي أولاً (RTL)، مدفوع كاملاً من DB، تحديث لحظي | ثابت + تصنيف بالـ regex |
| **طلب QR لكل طاولة** | مسح طاولة 10 ← الطلب يُوسَم تلقائياً بطاولة 10 + حجم المجموعة + نداء النادل | **غير موجود إطلاقاً** |
| **لوحة KDS لحظية** | استقبال/كاشير/مطبخ مع دورة حياة طلب كاملة | **غير موجودة** (Telegram فقط) |
| **لوحة إدارية** | تسجيل دخول بأدوار، CRUD، عروض، CRM، تقارير | موجودة لكن كلمة المرور = التوكن |
| **محرك العروض والولاء** | خصومات/كوبونات/ولاء محسوبة على الخادم | كلها على العميل (قابلة للتلاعب) |
| **الأمان** | جلسات حقيقية، صلاحيات، إعادة حساب الأسعار على الخادم | توكن مكشوف + أموال موثوقة من العميل |

### المبادئ الحاكمة (Guiding Principles)
1. **قاعدة البيانات هي مصدر الحقيقة الوحيد** — نحذف شجرة `MENU_DATA` الثابتة وتصنيف الأسماء العربية بالـ regex.
2. **الخادم يُعيد حساب كل ريال** — لا نثق أبداً بـ `total`/`subtotal`/الولاء القادم من المتصفح.
3. **عكس مسار الطلب** — المتصفح يُرسل إلى `/api/orders` أولاً (DB)، ثم الخادم يوزّع على Telegram/KDS.
4. **مضيف واحد فقط: Netlify** — نحذف `vercel.json` و `deploy:cf`.
5. **توكن واحد مكشوف = ثغرة حرجة** — يُلغى فوراً وينتقل إلى الخادم.

---

## 2. تقييم الوضع الحالي (Honest Audit Summary)

### ✅ ما يُبقى (Keep & Reuse)
| العنصر | السبب |
|---|---|
| **محتوى `menu-data.js`** | الكتالوج الحقيقي (أسماء ar/en، أسعار، سعرات، variants/mixins) — يُرحَّل حرفياً إلى DB |
| **قاموس `STRINGS` (i18n)** | ثنائي اللغة شامل مع قوالب تحية/ولاء — يُرفع كما هو |
| **نموذج variants/mixins** | `getDefaultVariant`، تجاوز السعر/السعرات، صورة لكل variant — منطق سليم |
| **رياضيات الولاء** | `calculateLoyaltyRewards` (اشترِ 4 واحصل على الخامس مجاناً) — ينتقل للخادم |
| **نهج RTL بالخصائص المنطقية** | `margin-inline`, `text-align:start` — ممتاز، نوسّعه |
| **رمز الريال SVG** | مع `@supports` fallback — نُبقيه لكن نستضيفه ذاتياً |
| **schema الحالي (idempotent)** | نمط `CREATE/ALTER IF NOT EXISTS` — أساس جيد للهجرة |
| **مساعدات `_util.js` و `db.js`** | بنية serverless نظيفة — نُبقي الشكل ونستبدل `authOk` |
| **منطق upsert للعملاء** | `ON CONFLICT ... COALESCE/NULLIF` — منطق CRM سليم |

### 🔁 ما يُعاد بناؤه (Rebuild)
- **المونوليث 2352 سطراً** ← تطبيق SvelteKit مكوّن (componentized).
- **النسخة المكررة `menu`** + `order-status.html` ← تُحذف نهائياً.
- **`fetchItems()` بتصنيف الـ regex** ← قراءة `category`/`variants` من DB مباشرة.
- **التصنيفات الثابتة في 3 أماكن** ← جدول `categories` حقيقي مع CRUD.
- **`ADMIN_PASSWORD` ككلمة مرور-توكن** ← جلسات opaque مع أدوار (RBAC).
- **مسار الطلب المعكوس Telegram-first** ← DB-first ثم توزيع.

### 🔴 الثغرات الأمنية (Critical Security Gaps)
| # | الثغرة | الموقع | الخطورة |
|---|---|---|---|
| 1 | **توكن Telegram مكشوف** في كود العميل | `index.html:444`, `order-status.html:74`, `menu:290` | 🔴 حرجة — اختطاف كامل للبوت |
| 2 | **POST /api/orders بلا مصادقة** (`authOk` بعد `return`) | `orders.js:82` vs `161` | 🔴 حرجة — رسائل/CRM مزيفة |
| 3 | **الأموال موثوقة من العميل** بلا إعادة حساب | `orders.js:85-86` | 🔴 حرجة — أسعار عشوائية |
| 4 | **الولاء 100% على العميل** في localStorage | `nima.loyaltyTracker` | 🔴 عالية — مشروبات مجانية مزيفة |
| 5 | **كلمة المرور = التوكن** في localStorage بنص صريح | `admin/index.html:321` | 🔴 عالية — تسريب الاعتماد الرئيسي |
| 6 | **CORS = '\*'** افتراضياً | `_util.js:2` | 🟠 متوسطة |
| 7 | **XSS مخزّن** عبر `innerHTML` لأسماء الأصناف | `makeItemEl:1182`, `renderCart:2042` | 🟠 متوسطة (عند تدفق DB) |
| 8 | **`schema.sql` منشور على CDN** عبر `build.mjs` | `build.mjs:14` | 🟡 إفشاء معلومات |
| 9 | **مقارنة كلمة مرور غير ثابتة الزمن** | `_util.js:21` | 🟡 منخفضة |

---

## 3. المعمارية المقترحة + الحزمة التقنية (Architecture & Stack)

### القرار الجوهري: حزمة واحدة، مضيف واحد، قاعدة بيانات واحدة

```
┌─────────────────────────────────────────────────────────────┐
│                     SvelteKit (adapter-netlify)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  /(menu)     │  │   /admin     │  │   /kds           │   │
│  │  منيو العميل  │  │  لوحة التحكم  │  │  لوحة المطبخ     │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     +server.ts endpoints  (يستبدل netlify/functions) │    │
│  │     auth · menu · orders · kds · admin · reports     │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────┬─────────────────────────┬───────────────────┘
                │ Drizzle ORM (typed)      │ Realtime
                ▼                          ▼
       ┌─────────────────┐       ┌──────────────────────┐
       │  Postgres (DB)  │──CDC─▶│ Realtime (Supabase /  │
       │ مصدر الحقيقة     │       │ SSE+poll fallback)   │
       └─────────────────┘       └──────────────────────┘
                │
                ▼  (server-side only)
       ┌─────────────────┐  ┌──────────────┐  ┌─────────────┐
       │ Cloudinary صور  │  │ Telegram     │  │ Upstash     │
       │                 │  │ (إشعار فقط)   │  │ rate-limit  │
       └─────────────────┘  └──────────────┘  └─────────────┘
```

### التوصية بالحزمة (Stack Recommendation) ولماذا

| الطبقة | الاختيار | البديل المرفوض | السبب |
|---|---|---|---|
| **الإطار** | **SvelteKit** + `adapter-netlify` | Next.js (ثقيل/React) · HTML ثابت (الدَّيْن الحالي) | تطبيق واحد لـ 4 واجهات متباعدة اليوم؛ حزم RTL صغيرة؛ `+server.ts` يشارك الأنواع مع الواجهة |
| **الوصول للبيانات** | **Drizzle ORM** فوق `@neondatabase/serverless` | Prisma (محرك ثقيل، بارد على serverless) · `sql` خام | schema مُكتوب = مصدر الهجرات؛ يحافظ على parameterization الآمن |
| **قاعدة البيانات** | **Postgres** (Neon أو Supabase) | — | علائقية، JSON عند الحاجة، LISTEN/NOTIFY أو CDC للّحظي |
| **المصادقة** | **جلسات opaque** (256-bit، SHA-256 مخزّنة) + `argon2id` | JWT (إبطال بطيء) · password-as-bearer | إبطال/تدوير فوري — مقهى يحتاج طرد نادل مفصول حالاً |
| **اللحظي** | **Supabase Realtime (CDC)** أو **SSE + polling fallback** | LISTEN/NOTIFY مباشر (HTTP driver لا يدعمه) · SSE-from-Netlify كأساس (دوال قصيرة العمر) | بوابة WS مُدارة؛ تراجع رشيق للـ polling |
| **الصور** | **Cloudinary** (موجود) + `sharp` WebP | postimg.cc hotlinks | استضافة مملوكة، responsive، مدمج بالفعل |
| **المضيف** | **Netlify فقط** | Vercel · Cloudflare | الدوال بصيغة Netlify بالفعل؛ نحذف الالتباس الثلاثي |
| **التحقق** | **Zod** على كل كتابة | — | تحقق على حدود الـ API |
| **الهاش** | **`@node-rs/argon2`** | bcrypt (fallback) | serverless-friendly |

> **قرار اللحظي الموسّع:** إن تمت الهجرة إلى **Supabase Postgres** فإن قاعدة واحدة تُغذّي البيانات واللحظي معاً (أبسط نموذج، RLS مضمّن، نسخ احتياطي يومي مجاني). إن بقينا على **Neon**، فإن SSE + polling هو الأساس مع outbox table. التوصية: **Supabase** لتوحيد الطبقتين.

---

## 4. نموذج قاعدة البيانات الكامل (Complete Data Model)

> تصميم مُطبَّع بالكامل: معرّفات surrogate ثابتة (`bigint identity`) + slugs، ثنائي اللغة في كل مكان، لقطة سعر (price snapshot) وقت الطلب، ولاء وعروض ذات سلطة خادمية، وسجل تدقيق append-only. كل الأموال `numeric(10,2)` وكل الأوقات `timestamptz`.

### 4.1 المستخدمون والصلاحيات (Users / Roles / Auth)

```sql
CREATE TABLE staff_users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,                 -- argon2id
  role          text NOT NULL CHECK (role IN ('owner','manager','cashier','waiter','kitchen')),
  is_active     boolean DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE user_sessions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_user_id bigint NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,           -- SHA-256 of opaque session id
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz,
  user_agent    text,
  ip_address    text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);
```

**ترتيب الأدوار:** `owner > manager > cashier > waiter > kitchen`. يُفرض عبر حارس واحد في `hooks.server.ts` يربط (route + method) ← أدنى دور مطلوب. **العملاء يبقون مجهولين** (cookie-keyed، بلا كلمة مرور) لطلب QR بلا احتكاك.

### 4.2 التصنيفات والأصناف (Categories / Items)

```sql
CREATE TABLE categories (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  parent_id   bigint REFERENCES categories(id),   -- شجرة ذاتية المرجع: hot/cold/dessert آباء
  sort_order  int DEFAULT 0,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug               text UNIQUE NOT NULL,
  category_id        bigint NOT NULL REFERENCES categories(id),
  name_ar            text NOT NULL,
  name_en            text NOT NULL,
  description_ar     text DEFAULT '',
  description_en     text DEFAULT '',
  base_price         numeric(10,2) NOT NULL,
  calories           int DEFAULT 0,
  image_url          text DEFAULT '',
  image_public_id    text DEFAULT '',           -- Cloudinary
  is_active          boolean DEFAULT true,
  is_available       boolean DEFAULT true,       -- تبديل "نفد" (86)
  counts_for_loyalty boolean DEFAULT true,       -- FALSE للماء
  station            text DEFAULT 'bar' CHECK (station IN ('bar','cold','pastry','kitchen')),
  prep_seconds       int DEFAULT 180,            -- متوسط زمن التحضير
  sort_order         int DEFAULT 0,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_items_category ON items(category_id);
```

### 4.3 الـ Variants والـ Modifiers

```sql
CREATE TABLE item_variants (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id     bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_key text NOT NULL,                     -- small/large/7up/code-red
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  price       numeric(10,2) NOT NULL,
  calories    int DEFAULT 0,
  image_url   text DEFAULT '',
  is_default  boolean DEFAULT false,
  sort_order  int DEFAULT 0,
  UNIQUE (item_id, variant_key)
);

CREATE TABLE modifier_groups (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text UNIQUE NOT NULL,              -- ginger-lemon-addons, sugar, ice
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  min_select  int DEFAULT 0,
  max_select  int,                               -- NULL = غير محدود
  is_required boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE modifiers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  price_delta numeric(10,2) DEFAULT 0,           -- العسل = 1 (لا "+1" في النص)
  sort_order  int DEFAULT 0,
  is_active   boolean DEFAULT true,
  UNIQUE (group_id, slug)
);

CREATE TABLE item_modifier_groups (
  item_id    bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  group_id   bigint NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order int DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);
```

### 4.4 الطاولات + توكنات QR + الجلسات (Tables / QR / Sessions)

```sql
CREATE TABLE cafe_tables (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label_ar        text NOT NULL,                 -- 'طاولة 10'
  label_en        text NOT NULL,                 -- 'Table 10'
  table_number    int UNIQUE,
  zone            text DEFAULT '',
  qr_token        text NOT NULL UNIQUE,          -- opaque base62 (~71-bit)
  token_rotated_at timestamptz DEFAULT now(),
  seats           int DEFAULT 4,
  status          text DEFAULT 'free' CHECK (status IN ('free','occupied','needs_service')),
  merged_into     bigint REFERENCES cafe_tables(id),
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_tables_qr ON cafe_tables(qr_token);

CREATE TABLE table_sessions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_id       bigint NOT NULL REFERENCES cafe_tables(id),
  customer_id    bigint REFERENCES customers(id),
  session_token  text NOT NULL UNIQUE,
  party_size     int DEFAULT 1,
  order_type     text DEFAULT 'dine_in' CHECK (order_type IN ('dine_in','takeaway')),
  status         text DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at      timestamptz DEFAULT now(),
  closed_at      timestamptz
);

CREATE TABLE waiter_calls (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_id    bigint NOT NULL REFERENCES cafe_tables(id),
  session_id  bigint REFERENCES table_sessions(id),
  reason      text DEFAULT 'call' CHECK (reason IN ('call','bill','water','help')),
  status      text DEFAULT 'open' CHECK (status IN ('open','ack','done')),
  acked_by    bigint REFERENCES staff_users(id),
  created_at  timestamptz DEFAULT now(),
  acked_at    timestamptz
);
CREATE INDEX idx_calls_status ON waiter_calls(status, table_id);
```

### 4.5 الطلبات وبنودها (Orders / Order Items) — مع لقطة السعر

```sql
CREATE TABLE orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number     text UNIQUE NOT NULL,         -- مولّد خادمياً: T07-014
  order_token      text UNIQUE NOT NULL,         -- capability لتتبّع العميل
  table_id         bigint REFERENCES cafe_tables(id),
  table_session_id bigint REFERENCES table_sessions(id),
  customer_id      bigint REFERENCES customers(id),
  order_type       text DEFAULT 'dine_in' CHECK (order_type IN ('dine_in','takeaway')),
  party_size       int,
  status           text DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','preparing','ready','served','paid','cancelled')),
  subtotal         numeric(10,2) NOT NULL,        -- محسوب خادمياً
  discount_total   numeric(10,2) DEFAULT 0,
  loyalty_discount numeric(10,2) DEFAULT 0,
  total            numeric(10,2) NOT NULL,        -- محسوب خادمياً
  offer_id         bigint REFERENCES offers(id),
  drink_units      int DEFAULT 0,
  notes            text,
  accepted_by      bigint REFERENCES staff_users(id),
  served_by        bigint REFERENCES staff_users(id),
  accepted_at      timestamptz,
  ready_at         timestamptz,
  served_at        timestamptz,
  device_info      jsonb DEFAULT '{}',
  user_agent       text,
  ip_address       text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_orders_status   ON orders(status);
CREATE INDEX idx_orders_created  ON orders(created_at);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_token    ON orders(order_token);

CREATE TABLE order_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id            bigint REFERENCES items(id),
  variant_id         bigint REFERENCES item_variants(id),
  item_name_ar       text NOT NULL,               -- لقطة
  item_name_en       text NOT NULL,               -- لقطة
  variant_label      text,                        -- لقطة
  unit_price         numeric(10,2) NOT NULL,       -- لقطة وقت الطلب
  quantity           int NOT NULL CHECK (quantity > 0),
  line_total         numeric(10,2) NOT NULL,
  counts_for_loyalty boolean,                      -- لقطة
  line_status        text DEFAULT 'pending' CHECK (line_status IN ('pending','ready')),
  notes              text,
  created_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_item_modifiers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_item_id bigint NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id   bigint REFERENCES modifiers(id),
  group_slug    text,                             -- لقطة
  name_ar       text NOT NULL,                    -- لقطة
  name_en       text NOT NULL,                    -- لقطة
  price_delta   numeric(10,2) DEFAULT 0           -- لقطة
);

CREATE TABLE order_events (                        -- سجل دورة الحياة
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status   text,
  to_status     text NOT NULL,
  actor_user_id bigint REFERENCES staff_users(id),
  note          text,
  created_at    timestamptz DEFAULT now()
);
```

### 4.6 العملاء و CRM والولاء (Customers / Loyalty)

```sql
CREATE TABLE customers (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_key    text UNIQUE NOT NULL,           -- مستقر لكل جهاز/هاتف (لا 'guest' مشترك)
  name            text,
  phone           text,
  total_orders    int DEFAULT 0,
  total_spent     numeric(10,2) DEFAULT 0,
  total_drinks    int DEFAULT 0,
  first_order_at  timestamptz,
  last_order_at   timestamptz,
  last_device     text,
  last_user_agent text,
  last_ip         text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_customers_key ON customers(customer_key);

CREATE TABLE loyalty_accounts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id      bigint UNIQUE NOT NULL REFERENCES customers(id),
  drink_count      int DEFAULT 0,                 -- تقدّم نحو المشروب المجاني التالي
  rewards_earned   int DEFAULT 0,
  rewards_redeemed int DEFAULT 0,
  tier             text DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold')),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE loyalty_ledger (                      -- append-only
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id     bigint NOT NULL REFERENCES customers(id),
  order_id        bigint REFERENCES orders(id),
  event_type      text NOT NULL CHECK (event_type IN ('earn','redeem','adjust')),
  drink_units     int DEFAULT 0,
  reward_units    int DEFAULT 0,
  discount_amount numeric(10,2) DEFAULT 0,
  note            text,
  created_at      timestamptz DEFAULT now()
);
```

### 4.7 محرك العروض (Offers Engine)

```sql
CREATE TABLE offers (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                 text UNIQUE,               -- NULL = تطبيق تلقائي
  name_ar              text,
  name_en              text,
  type                 text NOT NULL CHECK (type IN ('percent','fixed','item_free','bogo','happy_hour','combo')),
  scope                text DEFAULT 'cart' CHECK (scope IN ('item','category','cart')),
  value                numeric(10,2),
  min_subtotal         numeric(10,2) DEFAULT 0,
  applies_to_category_id bigint REFERENCES categories(id),
  applies_to_item_id   bigint REFERENCES items(id),
  days_of_week         int[],                     -- 0..6
  start_time           time,
  end_time             time,
  starts_at            timestamptz,
  ends_at              timestamptz,
  max_redemptions      int,
  max_per_customer     int,
  redemption_count     int DEFAULT 0,
  stackable            boolean DEFAULT false,
  priority             int DEFAULT 0,
  is_active            boolean DEFAULT true,
  created_at           timestamptz DEFAULT now()
);

CREATE TABLE offer_redemptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id        bigint NOT NULL REFERENCES offers(id),
  order_id        bigint NOT NULL REFERENCES orders(id),
  customer_id     bigint REFERENCES customers(id),
  discount_amount numeric(10,2),
  created_at      timestamptz DEFAULT now()
);
```

### 4.8 سجل التدقيق واللحظي (Audit / Realtime Outbox)

```sql
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id bigint REFERENCES staff_users(id),
  action        text NOT NULL,                    -- item.update, qr.rotate, offer.create...
  entity_type   text NOT NULL,
  entity_id     bigint,
  before        jsonb,
  after         jsonb,
  ip_address    text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE realtime_events (                     -- transactional outbox
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,   -- order.new|order.status|waiter.call|menu.version|menu.availability
  scope      text NOT NULL,   -- kds|waiter|table|menu
  scope_id   text,            -- table token | item id
  payload    jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE meta (                                -- menu_version لتحديث لحظي
  key        text PRIMARY KEY,
  value      jsonb,
  updated_at timestamptz DEFAULT now()
);
-- INSERT INTO meta(key,value) VALUES ('menu_version','1');
```

---

## 5. تصميم الثيم والهوية البصرية (Design System)

### الفلسفة
القصة: **"مذاق ينبت من الجذور"** ← لوحة دافئة ترابية من فخامة القهوة المحمّصة (إسبريسو، كراميل، رمل، لمسة زيتون)، **لا** SaaS عام. نظام **CSS custom properties** في `design-tokens.css` (وليس Tailwind — نحافظ على ethos الـ zero-build) يُستهلك من المنيو والإدارة والـ KDS.

### الخطوط (Typography Pairing)
- **Tajawal** للجسم/الواجهة (400/500/700/800) — تغطية عربية + لاتينية كاملة.
- **Cairo** لعناوين العرض (هيرو، عناوين الأقسام، الأسعار الكبيرة) (700/800/900) — يتناغم مع هيكل Tajawal الإنساني لكن بصوت عناوين أكثر ثقة وفخامة.
- أرقام جدولية للأسعار: `font-feature-settings: 'tnum' 1`.

### الزجاجية (Glassmorphism): انتقائية لا شاملة
- زجاج مصنفر (`backdrop-filter: blur+saturate`) **فقط** على chrome العائم: الهيدر اللاصق، شريط التصنيفات، زر السلة العائم (FAB)، شريط الطلب، خلفيات المودال.
- أسطح **المحتوى** (بطاقات الأصناف، جسم الـ sheet) صلبة عالية التباين مع ظل ناعم — للقراءة والأداء.
- دائماً مع `@supports` fallback لون صلب.

### مثال `design-tokens.css` (concrete)

```css
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@400;500;700;800&display=swap');
/* الإنتاج: استضافة ذاتية woff2 + preload للوزنين الحرجين */

:root {
  /* ===== Color (Light) ===== */
  --bg: #F7F2EC;          /* رمل دافئ */
  --surface: #FFFFFF;
  --surface-2: #FCF7F1;
  --text: #211913;        /* إسبريسو شبه أسود */
  --text-muted: #6E5F52;
  --border: #E7DCD0;
  --brand: #8B5E3C;       /* قهوة محمّصة */
  --brand-strong: #5C3A23;
  --brand-soft: #F0E5D8;
  --accent: #6B8E5A;      /* زيتون "الجذور" */
  --gold: #C8A15A;        /* كراميل/ذهبي للولاء/VIP */
  --success: #2E7D52;
  --warning: #B26A12;
  --danger: #B23B3B;
  --price: var(--brand);
  --ring: rgba(139,94,60,.35);

  /* ===== Type scale ===== */
  --font-body: 'Tajawal', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-display: 'Cairo', 'Tajawal', system-ui, sans-serif;
  --fs-xs: .75rem;   --fs-sm: .8125rem; --fs-base: .9375rem;
  --fs-md: 1.0625rem;--fs-lg: 1.375rem; --fs-xl: 1.75rem;
  --fs-display: clamp(2rem, 6vw, 3.25rem);
  --lh-tight: 1.2; --lh-base: 1.6;

  /* ===== Spacing / radius / shadow / motion ===== */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px;
  --sp-6:24px; --sp-8:32px; --sp-10:40px; --sp-12:56px;
  --r-sm:8px; --r-md:14px; --r-lg:20px; --r-xl:28px; --r-pill:999px;
  --sh-1: 0 1px 2px rgba(33,25,19,.06), 0 2px 8px rgba(33,25,19,.05);
  --sh-2: 0 8px 24px rgba(33,25,19,.10);
  --sh-3: 0 16px 48px rgba(33,25,19,.16);
  --blur-glass: saturate(160%) blur(14px);
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
  --ease-out: cubic-bezier(.22,.61,.36,1);
  --ease-in-out: cubic-bezier(.4,0,.2,1);

  /* ===== z-index ladder ===== */
  --z-header:100; --z-catnav:90; --z-orderbar:110; --z-fab:120;
  --z-backdrop:300; --z-sheet:310; --z-toast:400;

  /* ===== a11y ===== */
  --tap: 44px;
}

[data-theme="dark"] {
  --bg: #14100C;          /* بنيّ-أسود محمّص دافئ */
  --surface: #1E1813;
  --surface-2: #261E18;
  --text: #F4ECE3;
  --text-muted: #B9A693;
  --border: #342B23;
  --brand: #D4A373;       /* كراميل أساسي على الداكن */
  --brand-strong: #E3BC92;
  --brand-soft: rgba(212,163,115,.14);
  --accent: #8FB07A;
  --gold: #D8B26A;
  --success:#5FB98A; --warning:#E0A050; --danger:#E57373;
  --ring: rgba(212,163,115,.45);
}

html { font-family: var(--font-body); }
h1, h2, .hero-title, .price-lg { font-family: var(--font-display); }
.price { font-feature-settings: 'tnum' 1; font-variant-numeric: tabular-nums; }

/* زجاج مع fallback */
.glass {
  background: rgba(255,255,255,.72);
}
@supports (backdrop-filter: blur(1px)) {
  .glass { background: rgba(255,255,255,.55); backdrop-filter: var(--blur-glass); }
}

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
```

### قرارات إضافية
- **الثيم على `<html data-theme>`** (لا `body.dark`) + سكربت رأس inline قبل الرسم لمنع FOUC.
- **الاستجابة:** عمود واحد < 520px، عمودان 520–900px، 3 أعمدة ≥ 900px. أقصى عرض 1040px.
- **الصور:** صندوق `aspect-ratio` ثابت مع `width/height` + `loading=lazy` + `srcset` (Cloudinary) لقتل CLS.
- **الوصولية:** WCAG AA على الثيمين، أهداف لمس 44px، مودالات focus-trapped مع Escape و استرجاع التركيز، roles دلالية بدل الـ div القابلة للنقر.

---

## 6. نظام الطلب عبر QR لكل طاولة (Per-Table QR Ordering)

### التدفق الكامل (Full Flow)

```
مسح QR → /t/<token>
   │
   ▼  GET /api/table/resolve?token=  (يتحقق ويُرجع طاولة 10، لا يكشف التوكن)
   ▼  اختيار: تناول في المقهى (افتراضي) / سفري
   ▼  حجم المجموعة (عدد الأشخاص) → POST /api/table/session
   ▼  تصفّح المنيو (DB-driven، الطاولة مقفلة في الهيدر)
   ▼  بناء السلة (كل بند يحمل item_id + variant_id)
   ▼  POST /api/orders  ← الخادم يُعيد حساب كل سعر/ولاء، يولّد order_number، status=pending
   ▼  شاشة تتبّع حية (stepper) ← GET /api/orders/status?order_token=  (polling 5s)
   └─ زر "نداء النادل" → POST /api/table/call (rate-limited)
```

### أمان التوكن (Token Security)
| القرار | التفصيل |
|---|---|
| **توكن opaque لا رقم الطاولة** | QR يُرمّز `/t/<token>` حيث `token` = base62 عشوائي 12 خانة (~71-bit). رقم الطاولة لا يسافر في الـ URL أبداً ← لا يمكن تعديل `?table=10` إلى `?table=3` |
| **HMAC signature (اختياري)** | لاحقة `HMAC-SHA256(token, QR_SIGNING_SECRET)` لرفض التوكنات المزوّرة بلا ضربة DB |
| **قابل للتدوير** | `token_rotated_at` — تسريب QR يُبطَل بتدوير صف واحد دون إعادة طباعة كل الطاولات |
| **مقارنة ثابتة الزمن** | عند البحث عن التوكن |
| **روابط القدرة (capability URLs)** | `session_token`، `order_token` صلاحياتها منخفضة (قراءة الحالة، نداء النادل) — لا تعدّل أموالاً |

### حجم المجموعة ونداء النادل
- **dine-in** يتطلب توكن طاولة محلولاً، `party_size ≥ 1`، يتحقق ضد `seats` أو 20.
- **takeaway** يُسمح به بلا طاولة، `party_size = NULL`، لا نداء نادل.
- **نداء النادل** حدث خادمي أول-درجة (`waiter_calls`)، rate-limited (نداء نشط واحد، تهدئة 60s)، يظهر على الـ KDS، **ليس** Telegram GET مجهول.

### الجلسة المشتركة (Shared Session)
جلسة `table_session` تجمع طلبات عدة ضيوف خلال زيارة واحدة. أي جهاز يمسح نفس الطاولة ضمن TTL ينضم لنفس الجلسة المفتوحة (عدة هواتف تطلب "معاً"). الموظفون يغلقون الجلسة من الـ KDS ("clear table"). كل طلب تحت `order_token` خاص لخصوصية التتبّع.

---

## 7. لوحة الكاشير/النادل والمطبخ (KDS)

### آلة حالة الطلب (Order Lifecycle State Machine)

```
pending ──accept──▶ accepted ──start──▶ preparing ──done──▶ ready ──serve──▶ served ──pay──▶ paid
   │                    │                    │                   │
   └────────────────────┴──── cancel ────────┴───────────────────┘──▶ cancelled
```

كل انتقال يمرّ عبر `PATCH /api/orders/:id/status` (مصادقة موظف + تحقق انتقال)، يكتب `order_events`، ويبثّ حدثاً لحظياً. **تحكّم تزامن متفائل:** `WHERE status = <expected_from>` ويُرجع 409 عند عدم التطابق (يمنع قبول طلبين لنفس الطلب).

### المكوّنات
| الشاشة | الدور | الوصف |
|---|---|---|
| **لوحة الاستقبال** | cashier/waiter | أعمدة kanban بالحالة، بطاقة طلب (طاولة، حجم، عمر، إجمالي)، أزرار سريعة، فلتر طاولة/حالة، تنبيه صوتي+بصري للطلب الجديد |
| **شاشة المطبخ (KDS)** | kitchen | شبكة تذاكر accepted/preparing فقط، أهداف لمس كبيرة، checkbox لكل بند (line ready)، تلوين بالعمر (أخضر<5د، كهرماني 5-10، أحمر>10) |
| **لوحة نداء النادل** | waiter | قائمة `waiter_calls` المفتوحة مع ack، شارة + صوت |
| **إدارة الطاولات** | manager | إعادة تعيين/دمج/تقسيم، حالة حية، تدوير QR |
| **تفاصيل الطلب** | all | السلة الكاملة، الولاء، timeline من `order_events`، إلغاء بسبب |

### تفاصيل تشغيلية
- **جاهزية لكل بند:** `order_items.line_status` (`pending`/`ready`)؛ حالة `ready` للطلب تُسمح فقط عند جاهزية كل البنود المحضّرة.
- **توجيه المحطات:** `items.station` (`bar`/`cold`/`pastry`/`kitchen`) ← تقسيم تلقائي لمسارات تذاكر منفصلة (الباريستا يرى المشروبات فقط).
- **Wake Lock + إلغاء كتم الصوت** على أجهزة الكاونتر الدائمة (يتطلب نقرة مستخدم لإلغاء حظر autoplay).

---

## 8. لوحة التحكم الإدارية الكاملة (Admin Dashboard)

### المصادقة والأدوار (Login / RBAC)
- `POST /api/auth/login` يتحقق من هاش `argon2id`، يضبط cookie `httpOnly+Secure+SameSite` يحمل session id الخام؛ الخادم يبحث عن الهاش، يتحقق من الانتهاء، يحمّل الدور.
- **حارس واحد** `requireRole()` مدفوع بجدول سياسات (resource+method ← أدنى دور). يجعل ثغرة "POST بلا مصادقة" مستحيلة التكرار.
- **زر تسجيل خروج** + إبطال فوري للجلسة. **لا** كلمة مرور خام في localStorage أبداً.

### CRUD كامل
| المورد | الميزة الجديدة |
|---|---|
| **الأصناف** | محرر drawer كامل + رفع صور Cloudinary مباشر، tabs للـ variants والـ modifiers |
| **التصنيفات** | شجرة data-driven مع سحب لإعادة الترتيب (يستبدل 3 مصفوفات ثابتة) |
| **الـ Variants** | يحفظ cal+img (الإدارة الحالية تُسقطهما) + اختيار default |
| **الـ Modifiers** | **أول محرر mixins/add-ons على الإطلاق** مع min/max/required |
| **الطاولات** | CRUD + توليد/تدوير/طباعة QR |

### محرك العروض (Offers Engine) — خادمي بالكامل
- جدول قواعد `offers` + `offer_redemptions`، **لا يُطبَّق أبداً على العميل**.
- المنيو يعرض العروض فقط؛ الخصم يُحسب وقت الطلب عبر وحدة مشتركة `evaluateOffers()` يستخدمها مسار إنشاء الطلب **و** نقطة معاينة إدارية `POST /api/admin/offers/preview`.
- يدعم: نسبة/ثابت/BOGO/happy_hour/combo، نوافذ زمنية (أيام + ساعات + نطاق تواريخ)، كوبونات، حدود استخدام (لكل عميل/إجمالي)، stackable.

### CRM والتقارير
- **CRM:** قائمة مُصفّحة خادمياً (لا 200/500 في الذاكرة)، بحث بالاسم/الهاتف، شرائح (new/returning/VIP/lapsed)، ملف عميل مع timeline وولاء وLTV.
- **التقارير:** تجميعات Postgres حقيقية (`COUNT/SUM/date_trunc`) — إيرادات، طلبات/يوم، أفضل المبيعات، خريطة حرارة ذروة، new-vs-returning، أداء الموظفين. تصدير CSV/PDF **خادمي** (غير محدود بـ 200/500).
- **تدقيق:** كل تعديل مميّز يكتب `audit_log` (من/ماذا/متى/before/after).

### التحديث اللحظي للمنيو (Instant Live Updates)
صف `meta.menu_version` يُرفَع في **نفس المعاملة** لأي كتابة كتالوج/عرض، ثم يُبثّ `{type:'menu.version', v}` عبر نفس قناة SSE. كل منيو عميل مفتوح يقارن نسخته ويُعيد جلب `/api/menu` (ETagged) خلال ~1 ثانية دون إعادة تحميل. تراجع: poll لـ `/api/menu/version` كل 20s.

---

## 9. طبقة التحديث اللحظي والبنية التحتية (Realtime & DevOps)

### آلية اللحظي المختارة والمبرّر

| الخيار | القرار | السبب |
|---|---|---|
| **Supabase Realtime (CDC)** | ✅ **الأساس الموصى به** | بوابة WS مُدارة + CDC من Postgres (صف ملتزم يُبثّ تلقائياً)؛ RLS لتحديد القنوات؛ نسخ احتياطي يومي مجاني |
| **SSE + polling fallback** | ✅ بديل إن بقينا على Neon | outbox table + SSE endpoint؛ poll كل 3-5s عند الانقطاع |
| Postgres LISTEN/NOTIFY مباشر | ❌ مرفوض | الـ HTTP driver لا يدعم اتصالاً دائماً |
| SSE-from-Netlify كأساس | ❌ مرفوض | الدوال قصيرة العمر (10s/15min) + فوترة لكل استدعاء |
| Ably/Pusher | ⚠️ موثّق كبديل | قوي لكن backend ثانٍ لحالة موجودة في Postgres |

### نموذج الحدث: Transactional Outbox
كل دالة مُعدِّلة تكتب صف العمل **و** صف `realtime_events` في نفس المعاملة ← Supabase CDC يبثّ لقنوات محدّدة النطاق:
- `kds` (كل الموظفين)، `waiter` (الانتقالات)، `table:<token>` (طلب الضيف فقط، RLS)، `menu` (تحديثات حية).

> **ملاحظة معمارية حاسمة:** الـ outbox يتطلب معاملات حقيقية. الـ HTTP driver يلتزم لكل عبارة. لذا إما الانتقال لاتصال Postgres يدعم المعاملات (Supabase pooler) أو لفّ الكتابة+الحدث في دالة plpgsql ذرية، أو CTE واحد `WITH upd AS (...) UPDATE meta...`.

### توليد QR
- سكربت `scripts/qr-generate.mjs` يقرأ `cafe_tables`، يُولّد token opaque + HMAC، يرسم SVG+PNG عبر `qrcode`، ويُخرج PDF جاهز للطباعة (بطاقة لكل طاولة: رقم + label عربي + QR لـ `/t/<token>`).
- `POST /api/admin/tables/:id/rotate-qr` لتدوير طاولة واحدة دون لمس البقية.

### DevOps والبنية التحتية
| البند | القرار |
|---|---|
| **المضيف** | Netlify فقط — حذف `vercel.json` و `deploy:cf` و `menu-admin.html` من `build.mjs` |
| **التخزين المؤقت** | استبدال no-cache الشامل: HTML/`/api` = `no-cache, must-revalidate`؛ الأصول المُهاشّة = `max-age=31536000, immutable`؛ صور Cloudinary CDN |
| **الهجرات** | `drizzle-kit migrate` في CI (يستبدل تطبيق `schema.sql` اليدوي) |
| **تحديد المعدّل** | Upstash Redis (REST) على `POST /api/orders`, `/api/call-waiter`, `/api/login` (fail-open) |
| **الأسرار** | كلها في Netlify env (prod + staging context)؛ `schema.sql` لا يُنشر للـ CDN |
| **المراقبة** | Sentry (server + client) + `/api/health` + UptimeRobot |
| **النسخ الاحتياطي** | Supabase Pro نسخ يومي + PITR، أو GitHub Action cron `pg_dump` ليلي |
| **CI/CD** | push to main ← `npm ci` → lint → migrate (staging) → build → deploy preview → smoke-test `/api/health` → promote. **مسار نشر واحد** (تعطيل native أو الـ Action) |
| **عدم الاتصال** | Service Worker + IndexedDB outbox للطلبات مع Background Sync + idempotency key (لمنع التكرار) |

---

## 10. أكثر من 20 اقتراحاً لجعله أقوى منيو في العالم (Curated)

> الوسوم: **التأثير/الجهد** — مُجمّعة بالثيم. مُنقّاة من 50 اقتراحاً خاماً بعد إزالة التكرار.

### 🎯 التخصيص والاكتشاف (Personalization & Discovery)
1. **رفّ "تذوّقك المفضّل" (For You)** — إعادة ترتيب المنيو حسب التاريخ + وقت اليوم + سياق الطاولة، نموذج تكرار-حداثة بسيط بلا ML. *(عالي/متوسط)*
2. **"اطلب مثل آخر مرة" + المفضّلة** — زر يعيد بناء طلب سابق كامل (variant + mixins) بنقرة، وقلب للمفضّلة لكل بطاقة. *(عالي/منخفض)*
3. **"يناسبه" — اقتراح أزواج وكومبو** — على البطاقة وعند المراجعة، اقتراح مُرتّب بمعدل الإرفاق الحقيقي من `orders`. *(عالي/متوسط)*
4. **"فاجئني" + مجموعات المزاج** — Focus/Cozy/Post-Iftar/Summer، وزر يقترح ما لم يُجرَّب. *(متوسط/منخفض)*
5. **Neema AI Barista (RAG عربي)** — مساعد عربي يجيب "ماذا يناسب الجبنة؟" ويضيف للسلة، مُؤسَّس على `/api/menu` الحي بلا هلوسة (Claude، لهجة سعودية). *(عالي/متوسط)*

### ⭐ الولاء والاحتفاظ (Loyalty & Retention)
6. **ولاء متدرّج خادمي (نقاط نيمة)** — Bronze/Silver/Gold بالهاتف، شريط تقدّم، مكافأة ميلاد، نقاط قابلة للاستبدال. *(عالي/متوسط)*
7. **بطاقة ختم وسلاسل (Streaks) مُلعبَنة** — "اشترِ 9، العاشر مجاناً" + شارات (Early Bird, Ramadan Regular). *(متوسط/متوسط)*
8. **برنامج الإحالة بروابط متتبَّعة** — "أعطِ 15، احصل على 15" يربط أول طلب بالمُحيل. *(عالي/متوسط)*
9. **بطاقات هدايا ومحفظة مدفوعة مسبقاً** — شحن ببونص (ادفع 200، احصل على 220)، تُهدى عبر WhatsApp. *(عالي/عالي)*
10. **اشتراكات القهوة والعضويات** — "مشروب يومياً 299 ر.س/شهر"، VIP بترقيات مجانية. *(عالي/عالي)*

### 💳 المدفوعات والامتثال السعودي (Payments & Compliance)
11. **مدفوعات الطاولة: mada + Apple Pay + STC Pay** — عبر Moyasar/HyperPay، تقسيم الفاتورة، الحالة تقلب إلى PAID تلقائياً. *(عالي/عالي)*
12. **فواتير ZATCA Phase-2 رقمية** — QR e-invoice (TLV)، تفصيل VAT، يُرسَل عبر WhatsApp فوراً. *(عالي/متوسط)*

### 🔥 المطبخ والعمليات (Kitchen & Ops)
13. **86 بنقرة / تبديل التوفّر الحي** — "نفد" لكل صنف/variant يُعطّله فوراً على المنيو الحي. *(عالي/منخفض)*
14. **مخزون خفيف مع 86 تلقائي** — تتبّع الحليب/الشراب/الحبوب، خصم عند القبول، تنبيه انخفاض. *(عالي/عالي)*
15. **ETA لكل صنف + ساعة المطبخ** — `prep_seconds` + عمق الطابور ← "جاهز خلال ~8 دقائق". *(عالي/متوسط)*
16. **تجميع الطلبات الذكي بالنوع** — تجميع المشروبات المتطابقة عبر التذاكر لرفع إنتاجية الباريستا في الذروة. *(متوسط/متوسط)*
17. **تكامل طابعة حرارية (ESC/POS)** — طباعة تذاكر مطبخ عربية تلقائياً + إيصال SAR. *(متوسط/عالي)*
18. **إدارة المناوبات + تسجيل دخول PIN** — نسب كل قبول/86/إلغاء لموظف مُسمّى، أساس للأداء والإكراميات. *(عالي/عالي)*

### 📈 النمو والتحليلات (Growth & Analytics)
19. **محرك العروض الديناميكية (Happy Hour)** — قواعد زمنية، خصم 20% على البارد 2-5م، عداد تنازلي حي. *(عالي/متوسط)*
20. **كومبو وباني الوجبات** — حزم بسعر موفّر مع فرض اختيار من كل مجموعة. *(عالي/متوسط)*
21. **محرك كوبونات/خصم تلقائي** — نسبة/ثابت/BOGO، حدود، انتهاء، أول-طلب، تحقق خادمي + تحليلات لكل كود. *(عالي/متوسط)*
22. **أتمتة تسويق WhatsApp/SMS (Unifonic)** — win-back بعد 30 يوماً، مكافأة ميلاد، تنبيه جاهزية، مُجزّأ بالإنفاق. *(عالي/عالي)*
23. **قمع المراجعات إلى Google** — 4-5 نجوم ← صفحة مراجعة Google، 1-3 ← الإدارة للاسترداد قبل العلانية. *(عالي/منخفض)*
24. **لوحة تحليلات تقود القرار** — RFM، churn، attach-rate، خريطة ذروة، AOV + توصية "أفضل إجراء تالٍ". *(عالي/متوسط)*

### 🌟 التجربة المتميزة (Premium Experience)
25. **مرشّحات الحساسية والتغذية** — وسوم (حليب/مكسرات/جلوتين)، نباتي/خالٍ من السكر، شرائح فلتر بنقرة. *(عالي/متوسط)*
26. **تقييمات وصور الضيوف** — تقييم بعد الانتهاء، متوسط نجوم لكل صنف، إشراف عربي. *(متوسط/عالي)*
27. **شارات الشعبية الحية** — "الأكثر طلباً اليوم"، "Trending"، عداد حي من `orders`. *(متوسط/منخفض)*
28. **PWA قابل للتثبيت + offline** — Service Worker، يحمّل فوراً على Wi-Fi ضعيف، مزامنة خلفية. *(عالي/منخفض)*
29. **طلب صوتي باللهجة السعودية** — "ابغى لاتيه كبير بدون سكر" عبر Web Speech + LLM intent parser. *(عالي/عالي)*
30. **معاينة AR للأطباق** — "شاهد في مساحتك" 3D للحجم الحقيقي للكوب، يقلّل شكاوى عدم تطابق الحجم. *(متوسط/عالي)*
31. **وضع الوصولية أولاً (WCAG AA)** — تباين عالٍ، تكبير، قارئ شاشة عربي، قراءة الإجمالي صوتياً. *(متوسط/منخفض)*
32. **بوت WhatsApp للطلب والحالة** — تصفّح/إعادة طلب/استلام في الدردشة + حالة حية + إيصال. *(عالي/عالي)*

### 🏢 التوسّع والأمان (Scale & Security)
33. **طبقة فروع/امتياز (Multi-Branch)** — منيو/أسعار/مخزون/موظفون لكل فرع، تقارير موحّدة، royalty. *(عالي/عالي)*
34. **تحليلات QR ذكية لكل طاولة** — heatmap للمسح، scan-to-order، dwell، A/B للعروض حسب المنطقة. *(متوسط/متوسط)*
35. **حارس مكافحة الاحتيال** — fingerprint + IP + velocity للولاء، توكنات طاولة موقّعة. *(متوسط/عالي)*
36. **ترشيح مدفوع/تمييز الأصناف** — "اختيار الشيف"، "جديد"، carousel + A/B لصور الأصناف. *(متوسط/منخفض)*

---

## 11. خارطة طريق التنفيذ على مراحل (Phased Roadmap)

### 🔴 المرحلة 0 — حظر الإطلاق الأمني (Pre-MVP — أسبوع 1)
> **مستقل عن كل شيء، يجب أن يحدث أولاً.**
- **إلغاء توكن Telegram المسرّب** عبر BotFather، وحذفه من `index.html`/`order-status.html`/`menu`.
- نقل إرسال Telegram للخادم خلف env var.
- قفل `CORS_ORIGIN` على نطاق الإنتاج (لا '\*').
- إصلاح ثغرة `POST /api/orders` بلا مصادقة (نقل الحارس لحارس مركزي).

### 🟠 المرحلة 1 — MVP (الأسابيع 2-5)
**يُشحن:**
- Drizzle schema + الهجرة 0001 في CI؛ إنشاء الجداول الجديدة في Neon/Supabase branch.
- بذر التصنيفات (3 آباء + 7 أبناء) والكتالوج من `menu-data.js` (إصلاح خطأ `ar` المكرر، `counts_for_loyalty=false` للماء).
- بذر `cafe_tables` (1..15) مع توكنات + طباعة QR.
- مصادقة الموظفين (`argon2id` + جلسات) + RBAC؛ بذر حساب owner من `ADMIN_PASSWORD` الحالي.
- **عكس مسار الطلب:** `POST /api/orders` ← إعادة حساب خادمية للأموال + الولاء + DB-first.
- منيو SvelteKit مدفوع من `/api/menu` (حذف `fetchItems` regex).
- **طلب QR:** route `/t/<token>` + حجم المجموعة + نداء النادل.
- آلة حالة الطلب الأساسية + لوحة KDS بـ polling.
- لوحة إدارية: تسجيل دخول، CRUD أصناف/تصنيفات/variants.
- الثيم الفاخر (Tajawal + Cairo) عبر `design-tokens.css`.

### 🟡 المرحلة 2 — v1 (الأسابيع 6-10)
**يُشحن:**
- اللحظي الحقيقي (Supabase CDC أو SSE outbox) للـ KDS والمنيو.
- محرر الـ Modifiers (أول محرر mixins) + رفع صور Cloudinary مباشر.
- محرك العروض الكامل + معاينة + تطبيق خادمي.
- الولاء المتدرّج الخادمي (`loyalty_ledger` + tiers).
- CRM مُصفّح خادمياً + تقارير مبيعات حقيقية + تصدير CSV/PDF.
- توجيه المحطات + جاهزية لكل بند + دمج/تقسيم الطاولات.
- تحديث المنيو اللحظي (`menu_version`).
- 86 بنقرة + التوفّر الحي.
- Service Worker offline outbox + idempotency.
- Sentry + `/api/health` + نسخ احتياطي + Upstash rate-limit.

### 🟢 المرحلة 3 — v2 (ما بعد الإطلاق)
**يُشحن (مختار حسب الأولوية):**
- مدفوعات mada/Apple Pay/STC Pay + فواتير ZATCA.
- أتمتة WhatsApp/SMS + بوت WhatsApp.
- Neema AI Barista + الطلب الصوتي.
- مخزون مع 86 تلقائي + ETA.
- طبقة الفروع المتعددة + تحليلات QR متقدمة.
- ETA, AR preview, التقييمات, الإحالة, بطاقات الهدايا, الاشتراكات.
- تنظيف نهائي: حذف `menu`، `order-status.html`، `vercel.json`، `menu-data.js`-كمصدر-حي، وإسقاط الجداول القديمة بعد التحقق من التكافؤ.

---

## 12. المخاطر والاعتبارات الأمنية (Risks & Security)

### مخاطر معمارية
| الخطر | التخفيف |
|---|---|
| **عمر SSE على Netlify** | حدود تنفيذ الدوال قد تقطع SSE ← Supabase CDC أو polling fallback إلزامي |
| **هجرة الطلبات القديمة تفقد دقة البنود** | `cart` jsonb القديم حمل تصنيف الحرارة فقط ← لقطات `order_items` best-effort؛ تقارير تاريخية تقريبية |
| **عميل 'guest' الموحّد لا يُقسَّم رجعياً** | علّمه كـ legacy واحد؛ كل طلب مجهول جديد يحصل `customer_key` لكل جهاز |
| **`argon2id` على serverless** | تأكد من حزم الـ native binary؛ fallback لـ bcrypt إن فشل التحميل |
| **إعادة الحساب الخادمية ≠ العرض** | العميل يُسعّر من `/api/menu` بنفس `evaluateOffers` للعرض؛ رسالة "تحديث السعر" عند عدم التطابق + تقريب متسامح |
| **الـ outbox يتطلب معاملات** | الـ HTTP driver يلتزم لكل عبارة ← Supabase pooler أو دالة plpgsql ذرية أو CTE واحد |
| **مسار نشر مزدوج** | عطّل native build أو الـ Action (واحد فقط authoritative) |

### اعتبارات أمنية
1. **توكن Telegram:** إلغاء + إزالة من كل ملفات العميل = **حظر إطلاق**. يحدث في نفس الإصدار الذي يحذف `order-status.html`.
2. **الأموال خادمية:** لا تثق أبداً بـ `total`/`subtotal`؛ ابحث عن سعر كل بند من DB، أعد الحساب، ارفض عدم التطابق.
3. **الولاء خادمي:** `loyalty_ledger` append-only؛ العميل يعرض فقط حالة المكافأة المُرجعة من الخادم.
4. **توكنات opaque للطاولات:** لا أرقام في URL؛ HMAC + قابلية تدوير؛ ربط الطاولة hint لا حدود مصادقة (الخادم يُعيد الحساب دائماً).
5. **روابط القدرة منخفضة الصلاحية:** `order_token`/`session_token` تقرأ الحالة وتنادي النادل فقط؛ تنتهي عند إغلاق الجلسة.
6. **CORS مقفل** على نطاق الإنتاج؛ rate-limit على المسارات العامة (fail-open).
7. **PII (IP/UA/device):** تصدير = إجراء مميّز مُسجَّل في `audit_log` + سياسة احتفاظ (PDPL/GDPR).
8. **فصل البيئات:** Neon/Supabase staging branch + `ADMIN_PASSWORD`/أسرار منفصلة؛ الهجرات لا تعمل على prod غير مُختبَرة.
9. **idempotency للطلبات:** مفتاح idempotency يمنع التكرار عند إعادة المحاولة offline.
10. **تزامن متفائل:** انتقالات الحالة مشروطة (`WHERE status=expected`) ← 409 عند التعارض لمنع desync اللوحة.
11. **`schema.sql` لا يُنشر للـ CDN:** إزالة `netlify` من `build.mjs entriesToCopy`؛ إزالة host logging من `db.js`.
12. **سجل تدقيق append-only:** كل تعديل مميّز (item/offer/staff/qr.rotate/PII export) يُسجَّل مع actor + before/after.

---

> **خلاصة:** هذا المخطط يحوّل نيمة من صفحة ثابتة هشّة إلى نظام تشغيل مطعم احترافي: **قاعدة بيانات واحدة كمصدر للحقيقة، خادم يعيد حساب كل ريال، طلب QR لكل طاولة، لوحة KDS لحظية، إدارة كاملة بصلاحيات، وهوية فاخرة بـ Tajawal** — مع مسار هجرة آمن متدرّج يبدأ بإلغاء التوكن المسرّب فوراً.
