// Maps Firebase Auth error codes to friendly bilingual messages.
const MAP = {
  'auth/invalid-email': { ar: 'بريد إلكتروني غير صالح', en: 'Invalid email' },
  'auth/user-not-found': { ar: 'لا يوجد حساب بهذا البريد', en: 'No account with this email' },
  'auth/wrong-password': { ar: 'كلمة المرور غير صحيحة', en: 'Wrong password' },
  'auth/invalid-credential': { ar: 'بيانات الدخول غير صحيحة', en: 'Invalid login credentials' },
  'auth/email-already-in-use': { ar: 'هذا البريد مستخدم بالفعل', en: 'Email already in use' },
  'auth/weak-password': { ar: 'كلمة المرور ضعيفة (6 أحرف على الأقل)', en: 'Weak password (min 6 chars)' },
  'auth/too-many-requests': { ar: 'محاولات كثيرة، حاول لاحقاً', en: 'Too many attempts, try later' },
  'auth/network-request-failed': { ar: 'تعذّر الاتصال بالشبكة', en: 'Network error' },
}

export function authErrorMessage(error, lang = 'ar') {
  const code = error?.code || ''
  const entry = MAP[code]
  if (entry) return entry[lang] || entry.ar
  return lang === 'ar' ? 'حدث خطأ، حاول مرة أخرى' : 'Something went wrong, try again'
}
