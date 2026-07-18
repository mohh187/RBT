import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// True only when the essential config is present.
export const firebaseReady = Boolean(config.apiKey && config.projectId && config.appId)

let app = null
let auth = null
let db = null
let storage = null
let functions = null

if (firebaseReady) {
  app = initializeApp(config)
  auth = getAuth(app)
  // Firestore with multi-tab offline persistence.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch (_) {
    db = getFirestore(app)
  }
  storage = getStorage(app)
  functions = getFunctions(app)
} else {
  // eslint-disable-next-line no-console
  console.warn('[RBT360] Firebase config missing. Copy .env.example to .env.local and fill VITE_FIREBASE_* values.')
}

export { app, auth, db, storage, functions, config as firebaseConfig }

