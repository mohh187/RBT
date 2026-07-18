import { saveCategory, saveItem } from './db.js'

// Generic starter menu so a new venue isn't empty (owner can edit/delete freely).
const STARTER = [
  {
    cat: { nameAr: 'مشروبات ساخنة', nameEn: 'Hot Drinks', sortOrder: 1 },
    items: [
      { nameAr: 'قهوة', nameEn: 'Coffee', price: 8, calories: 5 },
      { nameAr: 'لاتيه', nameEn: 'Latte', price: 12, calories: 190 },
      { nameAr: 'شاي', nameEn: 'Tea', price: 4, calories: 2 },
    ],
  },
  {
    cat: { nameAr: 'مشروبات باردة', nameEn: 'Cold Drinks', sortOrder: 2 },
    items: [
      { nameAr: 'آيس لاتيه', nameEn: 'Iced Latte', price: 14, calories: 200 },
      { nameAr: 'موهيتو', nameEn: 'Mojito', price: 16, calories: 130 },
    ],
  },
  {
    cat: { nameAr: 'حلويات', nameEn: 'Desserts', sortOrder: 3 },
    items: [
      { nameAr: 'كيك', nameEn: 'Cake', price: 18, calories: 420 },
      { nameAr: 'كوكيز', nameEn: 'Cookies', price: 9, calories: 200 },
    ],
  },
]

export async function seedSampleMenu(tid) {
  let sort = 1
  for (const group of STARTER) {
    const ref = await saveCategory(tid, null, { ...group.cat, active: true })
    const categoryId = ref.id
    for (const it of group.items) {
      await saveItem(tid, null, {
        ...it,
        categoryId,
        descAr: '',
        descEn: '',
        imageUrl: '',
        available: true,
        active: true,
        countsForLoyalty: true,
        variants: [],
        sortOrder: sort++,
      })
    }
  }
}
