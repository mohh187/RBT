import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'

// Translation strings. Keep flat keys; use {n} style placeholders.
const STRINGS = {
  ar: {
    appName: 'RBT360',
    tagline: 'منيو رقمي وطلب عبر QR ونظام إدارة متكامل',
    // generic
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    close: 'إغلاق',
    confirm: 'تأكيد',
    back: 'رجوع',
    next: 'التالي',
    search: 'بحث',
    loading: 'جاري التحميل…',
    none: 'لا يوجد',
    optional: 'اختياري',
    required: 'مطلوب',
    yes: 'نعم',
    no: 'لا',
    all: 'الكل',
    saving: 'جاري الحفظ…',
    saved: 'تم الحفظ',
    deleted: 'تم الحذف',
    error: 'حدث خطأ',
    areYouSure: 'هل أنت متأكد؟',
    // auth
    login: 'تسجيل الدخول',
    signup: 'إنشاء حساب',
    logout: 'تسجيل الخروج',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    fullName: 'الاسم الكامل',
    haveAccount: 'لديك حساب؟',
    noAccount: 'ليس لديك حساب؟',
    forgotPassword: 'نسيت كلمة المرور؟',
    welcomeBack: 'مرحباً بعودتك',
    createYourAccount: 'أنشئ حسابك المجاني',
    // onboarding
    createVenue: 'إنشاء منشأتك',
    venueName: 'اسم المنشأة',
    venueType: 'نوع المنشأة',
    cafe: 'مقهى',
    restaurant: 'مطعم',
    other: 'آخر',
    venueSlug: 'الرابط المختصر',
    slugHint: 'سيظهر في رابط المنيو العام',
    currency: 'العملة',
    createVenueCta: 'إنشاء وبدء الاستخدام',
    onboardingIntro: 'دقيقة واحدة لإطلاق منيوك الرقمي',
    // nav / admin
    dashboard: 'الرئيسية',
    menu: 'المنيو',
    items: 'الأصناف',
    categories: 'التصنيفات',
    tables: 'الطاولات',
    orders: 'الطلبات',
    cashier: 'الكاشير',
    kitchen: 'المطبخ',
    customers: 'العملاء',
    offers: 'العروض',
    reports: 'التقارير',
    staff: 'الموظفون',
    myPortal: 'بوابتي',
    dailyReport: 'التقرير اليومي',
    staffAffairs: 'شؤون الموظفين',
    performance: 'أداء الموظفين',
    attendance: 'الحضور',
    roles: 'الأدوار والصلاحيات',
    policies: 'السياسات العامة',
    settings: 'الإعدادات',
    more: 'المزيد',
    // items
    itemName: 'اسم الصنف',
    itemNameEn: 'الاسم بالإنجليزية',
    price: 'السعر',
    calories: 'السعرات',
    description: 'الوصف',
    image: 'الصورة',
    category: 'التصنيف',
    available: 'متوفر',
    unavailable: 'غير متوفر',
    soldOut: 'نفد',
    addItem: 'إضافة صنف',
    editItem: 'تعديل صنف',
    noItems: 'لا توجد أصناف بعد',
    addFirstItem: 'أضف أول صنف لمنيوك',
    variants: 'الأحجام / الخيارات',
    addVariant: 'إضافة خيار',
    uploadImage: 'رفع صورة',
    uploading: 'جاري الرفع…',
    countsForLoyalty: 'يحتسب في الولاء',
    // categories
    addCategory: 'إضافة تصنيف',
    categoryName: 'اسم التصنيف',
    noCategories: 'لا توجد تصنيفات',
    // tables / qr
    addTable: 'إضافة طاولة',
    tableLabel: 'اسم/رقم الطاولة',
    seats: 'عدد المقاعد',
    qrCode: 'رمز QR',
    downloadQr: 'تحميل الرمز',
    printQr: 'طباعة',
    tableQrHint: 'اطبع الرمز وضعه على الطاولة',
    // menu / ordering
    addToCart: 'أضف للسلة',
    cart: 'السلة',
    yourOrder: 'طلبك',
    emptyCart: 'سلتك فارغة',
    total: 'الإجمالي',
    subtotal: 'المجموع',
    discount: 'الخصم',
    placeOrder: 'إرسال الطلب',
    orderPlaced: 'تم إرسال طلبك',
    callWaiter: 'نداء النادل',
    waiterCalled: 'تم إبلاغ النادل، سيصل حالاً',
    partySize: 'عدد الأشخاص',
    dineIn: 'في المكان',
    takeaway: 'سفري',
    chooseOrderType: 'كيف تحب طلبك؟',
    orderType: 'نوع الطلب',
    pickup: 'استلام من المحل',
    curbside: 'توصيل للسيارة',
    carDetails: 'بيانات السيارة',
    carModel: 'نوع السيارة',
    carColor: 'اللون',
    carPlate: 'رقم اللوحة',
    iArrived: 'وصلت — أنا في الموقف',
    arrivedNotified: 'تم إبلاغ الموظفين، طلبك في الطريق',
    customerArrived: 'وصل العميل',
    table: 'طاولة',
    notes: 'ملاحظات',
    notesPlaceholder: 'أي ملاحظات على الطلب؟',
    qty: 'الكمية',
    item: 'صنف',
    items_plural: 'أصناف',
    viewCart: 'عرض السلة',
    yourName: 'اسمك',
    phone: 'رقم الجوال',
    trackOrder: 'تتبع الطلب',
    // order status
    statusPending: 'بانتظار القبول',
    statusAccepted: 'تم القبول',
    statusPreparing: 'قيد التحضير',
    statusReady: 'جاهز',
    statusServed: 'تم التقديم',
    statusPaid: 'مدفوع',
    statusCancelled: 'ملغي',
    statusRefunded: 'مسترجع',
    status_pending: 'بانتظار القبول',
    status_accepted: 'تم القبول',
    status_preparing: 'قيد التحضير',
    status_ready: 'جاهز',
    status_served: 'تم التقديم',
    status_paid: 'مدفوع',
    status_cancelled: 'ملغي',
    status_refunded: 'مسترجع',
    accept: 'قبول',
    startPreparing: 'بدء التحضير',
    markReady: 'جاهز',
    markServed: 'تم التقديم',
    markPaid: 'تم الدفع',
    cancelOrder: 'إلغاء',
    newOrders: 'جديدة',
    preparing: 'تحضير',
    ready: 'جاهزة',
    // dashboard / reports
    todaysSales: 'مبيعات اليوم',
    todaysOrders: 'طلبات اليوم',
    avgTicket: 'متوسط الطلب',
    totalCustomers: 'إجمالي العملاء',
    revenue: 'الإيرادات',
    topItems: 'الأكثر مبيعاً',
    last7days: 'آخر 7 أيام',
    last30days: 'آخر 30 يوماً',
    today: 'اليوم',
    // offers
    addOffer: 'إضافة عرض',
    offerName: 'اسم العرض',
    offerType: 'نوع العرض',
    percent: 'نسبة %',
    fixed: 'مبلغ ثابت',
    value: 'القيمة',
    active: 'مُفعّل',
    inactive: 'متوقف',
    couponCode: 'كود الخصم',
    // staff
    inviteStaff: 'دعوة موظف',
    role: 'الدور',
    owner: 'مالك',
    manager: 'مدير',
    waiter: 'نادل',
    // settings
    venueProfile: 'بيانات المنشأة',
    theme: 'المظهر',
    language: 'اللغة',
    dark: 'داكن',
    light: 'فاتح',
    publicRBT360: 'رابط المنيو العام',
    copyLink: 'نسخ الرابط',
    copied: 'تم النسخ',
    loyaltyProgram: 'برنامج الولاء',
    enableLoyalty: 'تفعيل الولاء',
    loyaltyEvery: 'كل كم مشروب = مشروب مجاني',
    // notifications
    notifications: 'الإشعارات',
    notifSettings: 'إعدادات التنبيهات',
    enableNotifications: 'تفعيل تنبيهات المتصفح',
    notifSound: 'صوت التنبيه',
    volume: 'مستوى الصوت',
    repeatAlert: 'تكرار الصوت (3 مرات)',
    uploadSound: 'رفع صوت مخصص',
    testAlert: 'تجربة التنبيه',
    notifBlocked: 'التنبيهات محظورة — فعّلها من إعدادات المتصفح',
    notifEnabledMsg: 'تم تفعيل التنبيهات',
    customSound: 'صوت مخصص',
    preview: 'تشغيل',
    notifHint: 'يصدر صوت وإشعار عند الأحداث الجديدة. على الجوال أبقِ الصفحة مفتوحة لضمان وصول الصوت.',
    // reports
    peakHours: 'ذروة الساعات',
    newVsReturning: 'عملاء جدد مقابل عائدين',
    newCustomers: 'جدد',
    returningCustomers: 'عائدون',
    guests: 'ضيوف',
    staffPerformance: 'أداء الموظفين',
    ordersWord: 'طلب',
    noData: 'لا بيانات',
    // events / reservations / tickets
    events: 'الفعاليات',
    reservations: 'الحجوزات',
    scan: 'مسح التذاكر',
    addEvent: 'إضافة فعالية',
    eventTitle: 'عنوان الفعالية',
    eventDate: 'التاريخ والوقت',
    capacity: 'السعة',
    ticketTypes: 'أنواع التذاكر',
    addTicketType: 'إضافة نوع',
    publish: 'نشر',
    published: 'منشورة',
    draft: 'مسودة',
    getTicket: 'احصل على تذكرة',
    full: 'اكتمل العدد',
    bookOccasion: 'احجز مناسبة',
    occasion: 'نوع المناسبة',
    birthday: 'عيد ميلاد',
    gathering: 'تجمّع',
    meeting: 'اجتماع',
    otherOccasion: 'مناسبة أخرى',
    dateTime: 'التاريخ والوقت',
    sendRequest: 'إرسال الطلب',
    requested: 'بانتظار التأكيد',
    confirmed: 'مؤكد',
    declined: 'مرفوض',
    decline: 'رفض',
    digitalPass: 'بطاقتك الرقمية',
    showAtEntry: 'اعرض هذا الرمز عند الدخول',
    valid: 'سارية',
    used: 'مستخدمة',
    checkIn: 'تسجيل دخول',
    checkedIn: 'تم تسجيل الدخول',
    scanTicket: 'وجّه الكاميرا إلى رمز البطاقة',
    invalidPass: 'بطاقة غير صالحة',
    alreadyUsed: 'مستخدمة مسبقاً',
    noEvents: 'لا توجد فعاليات',
    noReservations: 'لا توجد حجوزات',
    upcoming: 'القادمة',
    ticketWord: 'تذكرة',
    reservationWord: 'حجز',
    viewPass: 'عرض البطاقة',
    bookNow: 'احجز الآن',
    startScan: 'بدء المسح',
    // menu detail
    ingredients: 'المكوّنات',
    prepTime: 'وقت التحضير (دقيقة)',
    servingTime: 'وقت التقديم',
    serves: 'يكفي لـ',
    persons: 'أشخاص',
    minutesShort: 'د',
    information: 'المعلومات',
    reviewsTab: 'التقييمات',
    writeReview: 'أضف تقييماً',
    submitReview: 'إرسال',
    noReviews: 'لا تقييمات بعد — كن أول من يقيّم',
    ratingLabel: 'التقييم',
    reviewsCount: 'عدد التقييمات (عرض)',
    addIngredient: 'إضافة مكوّن',
    searchFood: 'ابحث عن صنفك المفضّل',
    reviewThanks: 'شكراً لتقييمك',
    complaints: 'الشكاوى',
    fileComplaint: 'إبلاغ عن مشكلة',
    complaintPlaceholder: 'صِف المشكلة التي واجهتها لنعالجها بأسرع وقت...',
    sendComplaint: 'إرسال الشكوى',
    complaintSent: 'تم إرسال شكواك، شكراً لك',
    specialDishes: 'أصناف مميّزة',
    myOrders: 'طلباتي',
    noOrdersYet: 'لا طلبات بعد',
    listView: 'قائمة',
    galleryView: 'معرض',
    rateYourOrder: 'قيّم طلبك',
    rateItem: 'قيّم',
    rated: 'تم التقييم',
    orderReadyMsg: 'طلبك جاهز للاستلام',
    notificationsTitle: 'الإشعارات',
    noNotifs: 'لا إشعارات بعد',
  },
  en: {
    appName: 'RBT360',
    tagline: 'Digital menu, QR ordering & full management system',
    save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', add: 'Add', close: 'Close',
    confirm: 'Confirm', back: 'Back', next: 'Next', search: 'Search', loading: 'Loading…',
    none: 'None', optional: 'optional', required: 'required', yes: 'Yes', no: 'No', all: 'All',
    saving: 'Saving…', saved: 'Saved', deleted: 'Deleted', error: 'Something went wrong',
    areYouSure: 'Are you sure?',
    login: 'Log in', signup: 'Sign up', logout: 'Log out', email: 'Email', password: 'Password',
    fullName: 'Full name', haveAccount: 'Have an account?', noAccount: "Don't have an account?",
    forgotPassword: 'Forgot password?', welcomeBack: 'Welcome back', createYourAccount: 'Create your free account',
    createVenue: 'Create your venue', venueName: 'Venue name', venueType: 'Venue type',
    cafe: 'Café', restaurant: 'Restaurant', other: 'Other', venueSlug: 'Short link',
    slugHint: 'Appears in your public menu URL', currency: 'Currency',
    createVenueCta: 'Create & get started', onboardingIntro: 'One minute to launch your digital menu',
    dashboard: 'Home', menu: 'Menu', items: 'Items', categories: 'Categories', tables: 'Tables',
    orders: 'Orders', cashier: 'Cashier', kitchen: 'Kitchen', customers: 'Customers', offers: 'Offers',
    reports: 'Reports', staff: 'Staff', myPortal: 'My portal', dailyReport: 'Daily report', staffAffairs: 'Staff affairs', performance: 'Staff performance', attendance: 'Attendance', roles: 'Roles & permissions', policies: 'General policies', settings: 'Settings', more: 'More',
    itemName: 'Item name', itemNameEn: 'Name (English)', price: 'Price', calories: 'Calories',
    description: 'Description', image: 'Image', category: 'Category', available: 'Available',
    unavailable: 'Unavailable', soldOut: 'Sold out', addItem: 'Add item', editItem: 'Edit item',
    noItems: 'No items yet', addFirstItem: 'Add your first menu item', variants: 'Sizes / options',
    addVariant: 'Add option', uploadImage: 'Upload image', uploading: 'Uploading…',
    countsForLoyalty: 'Counts for loyalty',
    addCategory: 'Add category', categoryName: 'Category name', noCategories: 'No categories',
    addTable: 'Add table', tableLabel: 'Table name/number', seats: 'Seats', qrCode: 'QR code',
    downloadQr: 'Download', printQr: 'Print', tableQrHint: 'Print and place it on the table',
    addToCart: 'Add to cart', cart: 'Cart', yourOrder: 'Your order', emptyCart: 'Your cart is empty',
    total: 'Total', subtotal: 'Subtotal', discount: 'Discount', placeOrder: 'Place order',
    orderPlaced: 'Your order was placed', callWaiter: 'Call waiter', waiterCalled: 'Waiter notified, coming shortly',
    partySize: 'Party size', dineIn: 'Dine in', takeaway: 'Takeaway', table: 'Table',
    chooseOrderType: 'How would you like your order?', orderType: 'Order type',
    pickup: 'Pickup at store', curbside: 'Curbside (to car)',
    carDetails: 'Car details', carModel: 'Car make', carColor: 'Color', carPlate: 'Plate number',
    iArrived: "I've arrived — I'm in the lot", arrivedNotified: 'Staff notified, your order is on the way',
    customerArrived: 'Customer arrived',
    notes: 'Notes', notesPlaceholder: 'Any notes for the order?', qty: 'Qty', item: 'item',
    items_plural: 'items', viewCart: 'View cart', yourName: 'Your name',
    phone: 'Phone', trackOrder: 'Track order',
    statusPending: 'Pending', statusAccepted: 'Accepted', statusPreparing: 'Preparing',
    statusReady: 'Ready', statusServed: 'Served', statusPaid: 'Paid', statusCancelled: 'Cancelled', statusRefunded: 'Refunded',
    status_pending: 'Pending', status_accepted: 'Accepted', status_preparing: 'Preparing',
    status_ready: 'Ready', status_served: 'Served', status_paid: 'Paid', status_cancelled: 'Cancelled', status_refunded: 'Refunded',
    accept: 'Accept', startPreparing: 'Start preparing', markReady: 'Ready', markServed: 'Served',
    markPaid: 'Paid', cancelOrder: 'Cancel', newOrders: 'New', preparing: 'Preparing', ready: 'Ready',
    todaysSales: "Today's sales", todaysOrders: "Today's orders", avgTicket: 'Avg ticket',
    totalCustomers: 'Total customers', revenue: 'Revenue', topItems: 'Top sellers',
    last7days: 'Last 7 days', last30days: 'Last 30 days', today: 'Today',
    addOffer: 'Add offer', offerName: 'Offer name', offerType: 'Offer type', percent: 'Percent %',
    fixed: 'Fixed amount', value: 'Value', active: 'Active', inactive: 'Inactive', couponCode: 'Coupon code',
    inviteStaff: 'Invite staff', role: 'Role', owner: 'Owner', manager: 'Manager', waiter: 'Waiter',
    venueProfile: 'Venue profile', theme: 'Theme', language: 'Language', dark: 'Dark', light: 'Light',
    publicRBT360: 'Public menu link', copyLink: 'Copy link', copied: 'Copied',
    loyaltyProgram: 'Loyalty program', enableLoyalty: 'Enable loyalty', loyaltyEvery: 'Drinks per free reward',
    notifications: 'Notifications', notifSettings: 'Notification settings',
    enableNotifications: 'Enable browser notifications', notifSound: 'Alert sound', volume: 'Volume',
    repeatAlert: 'Repeat sound (3×)', uploadSound: 'Upload custom sound', testAlert: 'Test alert',
    notifBlocked: 'Notifications blocked — enable them in browser settings', notifEnabledMsg: 'Notifications enabled',
    customSound: 'Custom sound', preview: 'Play',
    notifHint: 'Plays a sound and notification on new events. On mobile keep the page open to ensure sound.',
    peakHours: 'Peak hours', newVsReturning: 'New vs returning customers', newCustomers: 'New',
    returningCustomers: 'Returning', guests: 'Guests', staffPerformance: 'Staff performance',
    ordersWord: 'orders', noData: 'No data',
    events: 'Events', reservations: 'Reservations', scan: 'Scan tickets',
    addEvent: 'Add event', eventTitle: 'Event title', eventDate: 'Date & time', capacity: 'Capacity',
    ticketTypes: 'Ticket types', addTicketType: 'Add type', publish: 'Publish', published: 'Published',
    draft: 'Draft', getTicket: 'Get a ticket', full: 'Sold out',
    bookOccasion: 'Book an occasion', occasion: 'Occasion type', birthday: 'Birthday', gathering: 'Gathering',
    meeting: 'Meeting', otherOccasion: 'Other', dateTime: 'Date & time', sendRequest: 'Send request',
    requested: 'Pending confirmation', confirmed: 'Confirmed', declined: 'Declined', decline: 'Decline',
    digitalPass: 'Your digital pass', showAtEntry: 'Show this code at entry', valid: 'Valid', used: 'Used',
    checkIn: 'Check in', checkedIn: 'Checked in', scanTicket: 'Point the camera at the pass code',
    invalidPass: 'Invalid pass', alreadyUsed: 'Already used', noEvents: 'No events', noReservations: 'No reservations',
    upcoming: 'Upcoming', ticketWord: 'ticket', reservationWord: 'reservation', viewPass: 'View pass',
    bookNow: 'Book now', startScan: 'Start scan',
    ingredients: 'Ingredients', prepTime: 'Prep time (min)', servingTime: 'Serving time', serves: 'Serves',
    persons: 'persons', minutesShort: 'min', information: 'Information', reviewsTab: 'Ratings',
    writeReview: 'Add a rating', submitReview: 'Submit', noReviews: 'No ratings yet — be the first',
    ratingLabel: 'Rating', reviewsCount: 'Ratings count (display)', addIngredient: 'Add ingredient',
    searchFood: 'Search your favorite dish', reviewThanks: 'Thanks for your rating', specialDishes: 'Special dishes',
    myOrders: 'My orders', noOrdersYet: 'No orders yet', listView: 'List', galleryView: 'Gallery',
    rateYourOrder: 'Rate your order', rateItem: 'Rate', rated: 'Rated', orderReadyMsg: 'Your order is ready',
    notificationsTitle: 'Notifications', noNotifs: 'No notifications yet',
    complaints: 'Complaints', fileComplaint: 'Report a problem',
    complaintPlaceholder: 'Describe the issue you faced so we can resolve it quickly...',
    sendComplaint: 'Send complaint', complaintSent: 'Your complaint was sent, thank you',
  },
}

// Registry of available languages. To add a language: add a STRINGS[<id>] dictionary
// and an entry here (set dir to 'rtl' for right-to-left scripts).
export const LANGS = [
  { id: 'ar', name: 'العربية', dir: 'rtl' },
  { id: 'en', name: 'English', dir: 'ltr' },
]
export const dirOf = (lang) => LANGS.find((l) => l.id === lang)?.dir || 'ltr'

const I18nContext = createContext(null)

// Diner-facing surfaces keep their OWN light/dark preference: flipping the
// back-office dark must never flip the customer menu (and vice versa). The
// studio's menu preview runs in an iframe on a diner route, so it follows the
// menu key — toggle it from the preview or the menu itself, independently.
const DINER_PREFIXES = ['/m/', '/order/', '/e/', '/book/', '/t/', '/screen', '/preview/menu']
const isDinerSurface = () => typeof location !== 'undefined' && DINER_PREFIXES.some((p) => location.pathname.startsWith(p))
const themeKey = () => (isDinerSurface() ? 'ml.theme.menu' : 'ml.theme')

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('ml.lang') || 'ar')
  const [theme, setTheme] = useState(
    () => localStorage.getItem(themeKey()) || (isDinerSurface() ? 'light' : document.documentElement.getAttribute('data-theme') || 'light'),
  )

  useEffect(() => {
    localStorage.setItem('ml.lang', lang)
    document.documentElement.setAttribute('lang', lang)
    document.documentElement.setAttribute('dir', dirOf(lang))
  }, [lang])

  useEffect(() => {
    localStorage.setItem(themeKey(), theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Keep React state in sync with data-theme even when a skin sets it directly,
  // so the toggle (and the sun/moon icon) is always correct and works first click.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const obs = new MutationObserver(() => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light'
      setTheme((prev) => (prev !== cur ? cur : prev))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const t = useCallback(
    (key) => {
      const dict = STRINGS[lang] || STRINGS.ar
      return dict[key] ?? STRINGS.ar[key] ?? key
    },
    [lang],
  )

  const value = useMemo(
    () => ({
      lang,
      dir: dirOf(lang),
      langs: LANGS,
      theme,
      t,
      setLang,
      toggleLang: () => setLang((l) => (l === 'ar' ? 'en' : 'ar')),
      setTheme,
      // Flip from the ACTUAL current mode (a skin may have set data-theme directly),
      // so a single click always toggles — no stale-state "catch-up" double click.
      toggleTheme: () => {
        const cur = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || theme || 'light'
        setTheme(cur === 'dark' ? 'light' : 'dark')
      },
    }),
    [lang, theme, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

// Helper to pick the right localized field from a doc ({nameAr, nameEn}).
export function pickLang(obj, base, lang) {
  if (!obj) return ''
  const en = obj[`${base}En`]
  if (lang === 'en' && en) return en
  return obj[`${base}Ar`] || en || ''
}
