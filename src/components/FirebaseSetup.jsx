import { useI18n } from '../lib/i18n.jsx'
import { BrandMark } from './ui.jsx'

// Shown when VITE_FIREBASE_* env vars are missing.
export default function FirebaseSetup() {
  const { lang } = useI18n()
  const ar = lang === 'ar'
  return (
    <div className="auth-shell">
      <div className="auth-card card card-pad stack">
        <BrandMark />
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>{ar ? 'إعداد Firebase مطلوب' : 'Firebase setup required'}</h2>
        <p className="muted small">
          {ar
            ? 'لم يتم العثور على إعدادات Firebase. أنشئ مشروعاً على Firebase ثم انسخ القيم إلى ملف .env.local'
            : 'No Firebase config found. Create a Firebase project and copy the values into .env.local'}
        </p>
        <ol className="small muted stack" style={{ paddingInlineStart: 18, gap: 8 }}>
          <li>{ar ? 'افتح console.firebase.google.com وأنشئ مشروعاً (الخطة المجانية تكفي).' : 'Open console.firebase.google.com and create a project (free plan is enough).'}</li>
          <li>{ar ? 'أضف تطبيق ويب (&lt;/&gt;) وانسخ قيم الإعداد.' : 'Add a Web App (</>) and copy the config values.'}</li>
          <li>{ar ? 'فعّل: Authentication (Email/Password)، Firestore، Storage.' : 'Enable: Authentication (Email/Password), Firestore, Storage.'}</li>
          <li>
            {ar ? 'انسخ ' : 'Copy '}
            <code>.env.example</code>
            {ar ? ' إلى ' : ' to '}
            <code>.env.local</code>
            {ar ? ' واملأ القيم، ثم أعد تشغيل الخادم.' : ', fill the values, then restart the dev server.'}
          </li>
        </ol>
        <pre
          className="small"
          style={{
            background: 'var(--surface-2)',
            padding: 'var(--sp-3)',
            borderRadius: 'var(--r-md)',
            overflow: 'auto',
            border: '1px solid var(--border)',
          }}
        >{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...`}</pre>
      </div>
    </div>
  )
}
