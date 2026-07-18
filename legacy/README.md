# Neema Café Menu

This repo contains two builds of the interactive Neema Café menu:

- `index.html` – the production-ready build with the full loyalty and logging experience.
- `menu` – the compact legacy build that shares the same functionality and strings.
- `menu-data.js` – the shared catalogue of drinks and desserts that both builds render.
- `admin/index.html` – Comprehensive Arabic menu management dashboard with full CRUD operations, category management, variant/options support, image preview, search functionality, and CSV export capabilities. Connects to `/api/items`, `/api/orders`, and `/api/customers` endpoints with authentication.
- `order-status.html` – lightweight view Telegram uses when a waiter accepts or finishes an order.

## Latest enhancements

- زر إرسال الطلب السريع تمت إضافته إلى الشريط السفلي بجانب زر استدعاء النادل لبدء الطلب مباشرة من أي قسم.
- منطق الولاء يحتسب الآن كل المشروبات ضمن رصيد العميل؛ كل خمس مشروبات (بغض النظر عن النوع) تمنح مشروبًا مجانيًا.
- الطلبات المخزنة في قاعدة البيانات تتضمن ملف العميل، إجمالي المشروبات، خصومات الولاء، نوع الجهاز، اللغة، وعنوان الـ IP.
- لوحة التحكم الإدارية تعرض الطلبات ببيانات الجهاز وتتيح تصدير تقارير CSV لكل من الطلبات والعملاء عبر `/api/orders` و`/api/customers`.

## Asset pipeline and hosting

Static assets are now optimized and hosted on Cloudinary to keep the repository lean and avoid paid storage tiers. The workflow lives in `scripts/`:

- `scripts/optimize-and-upload.mjs` – walks common image folders, converts assets to WebP with `sharp`, uploads them to Cloudinary, and writes a manifest to `scripts/upload-map.json`.
- `scripts/update-menu-data.mjs` – rewrites image URLs inside the shared menu dataset so that every drink image points to the freshly uploaded Cloudinary URLs.
- `scripts/git-cleanup.sh` – runs [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) to purge large blobs from history after the assets move.

Create `scripts/.env` (see `scripts/.env.example`) with your Cloudinary credentials plus `BUILD_DIR`, `MENU_DATA_FILE`, and optional `IMAGE_SOURCE_DIRS` overrides if needed, then run:

```bash
npm ci
npm run img:upload
npm run img:rewrite
```

Commit the resulting manifest and menu data changes. After assets move, run `bash scripts/git-cleanup.sh` to shrink the Git history.

## Builds and deployment

The Netlify build (`npm run build`) copies the static bundle into `dist/`, which matches `BUILD_DIR` in `netlify.toml`. A GitHub Action in `.github/workflows/deploy-netlify.yml` installs dependencies, builds, and triggers a Netlify deploy on pushes to `main`. Set `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` secrets in the repository to enable automated deployments.

## Using the shared menu data in another page

If you are copying the menu UI into a new HTML file, add the shared dataset before the main script that renders the menu:

```html
<!-- Your menu markup … -->
<script src="menu-data.js"></script>
<script>
  // Existing menu logic that expects window.NEEMA_SHARED.MENU_DATA
</script>
```

The JavaScript inside each menu file now looks up `window.NEEMA_SHARED.MENU_DATA`. If that script does not load, the UI will still render but without any menu items, and the console logs:

```
[Neema] Shared menu data not found — rendering with empty menu dataset.
```

Including `menu-data.js` on the page ensures both menu builds use the same catalogue of products and imagery.

## Customising the catalogue

You now have two options when updating the menu:

1. **Admin Dashboard (`/admin/`)** – A modern, comprehensive web interface that connects to the `/api/items` endpoint for full menu management:
   - **Add/Edit/Delete Items**: Complete CRUD operations with form validation
   - **Category Management**: Assign items to categories (hot-coffee, hot-tea, cold-coffee, cold-mojito, cold-other, dessert-cake, dessert-side)
   - **Variant/Options Support**: Add size variations, flavor options, or pricing tiers to any item
   - **Image Management**: Live image preview and URL management
   - **Search & Filter**: Quick search across all menu items
   - **Bulk Operations**: Export menu as JSON, view and export orders/customers as CSV
   - **Statistics Dashboard**: View total items, orders, and customers at a glance
   - **Authentication**: Password-protected using the `ADMIN_PASSWORD` environment variable
   - Access the dashboard at `/admin/` and log in with your admin password

2. **Manual File Editing** – You can still edit `menu-data.js` directly to modify prices or items when you need default data without a database connection.

## Serverless API

- `/api/items` – Full CRUD operations for menu items with support for:
  - **GET**: Retrieve all items or a specific item by ID
  - **POST**: Create new menu items with category and variant support
  - **PUT**: Update existing items (requires `Authorization: Bearer <ADMIN_PASSWORD>`)
  - **DELETE**: Remove items (requires `Authorization: Bearer <ADMIN_PASSWORD>`)
  - **Fields**: `name_ar`, `name_en`, `price`, `calories`, `img_url`, `category`, `variants` (JSONB)
  
- `/api/orders` – Order management and retrieval:
  - **POST**: Submit new orders from the frontend
  - **GET**: Retrieve order history (requires `Authorization: Bearer <ADMIN_PASSWORD>`)
  - Stores customer profile, total drinks, loyalty discounts, device info, language, and IP address
  
- `/api/customers` – Aggregated customer data endpoint:
  - **GET**: List all customers with order count, total spent, total drinks, rewards, last device, and last IP
  - Requires authorization header for access from admin dashboard
  - Used for analytics and CSV export

يستعمل كلا المسارين قاعدة بيانات PostgreSQL عبر Netlify Neon. استورد المخطط الموجود في `netlify/functions/schema.sql` لتجهيز الجداول المطلوبة (`items` و`orders`)، وتمت إضافة جدول `customers` وأعمدة إضافية داخل `orders` للاحتفاظ بملخصات الولاء، خصومات الولاء، بيانات الجهاز، وعناوين الـ IP.

### Environment variables

- `ADMIN_PASSWORD` – required لكلا لوحة التحكم والعمليات المحمية في واجهات `/api`.
- `CORS_ORIGIN` – (اختياري) اضبطه لتحجيم النطاقات المسموح لها باستهلاك الواجهات؛ القيمة الافتراضية `*`.

## Persisted data keys

The menu stores customer preferences and order history in `localStorage`. These keys are shared by both builds:

- `nima.lang` – preferred language (`ar` or `en`).
- `nima.mode` – theme (`dark` or `light`).
- `nima.customerProfile` – saved name and phone number.
- `nima.customerRegistry` – known customers for multi-guest logs.
- `nima.orderLog` – history of orders sent from the device.
- `nima.loyaltyTracker` – عدادات الولاء لكل عميل (عدد المشروبات والمستويات المكتملة بغض النظر عن نوع المشروب).
- `neema.menuData.custom` – نسخة محلية من أصناف المنيو يتم إنشاؤها من خلال لوحة التحكم.

Clearing browser storage resets the greeting, loyalty counts, and saved customer details.
