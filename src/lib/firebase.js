import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { isEmbedded } from './embedded.js'

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
  // Firestore cache strategy — THE ROOT FIX for the "INTERNAL ASSERTION FAILED
  // (ca9/b815) → page breaks and reloads" incidents.
  //
  // The admin embeds this same app in iframes all over (Settings menu preview,
  // the item editor's live preview, the platform Design gallery — one frame
  // per venue —, LandingStudio, StaffPreview). Each frame is its own JS realm
  // that used to run initializeFirestore against the SAME IndexedDB, bypassing
  // the multi-tab leader election (which coordinates tabs, not realms) — the
  // known trigger of the assertion that permanently bricks the async queue.
  //
  // So: an EMBEDDED realm gets a memory-only cache (live onSnapshot streams
  // work identically — it only loses offline persistence, meaningless for a
  // preview), and only top-level documents share the persistent multi-tab
  // cache (real multi-tab usage — admin + cashier — is what the manager is
  // actually designed for).
  try {
    db = initializeFirestore(app, {
      localCache: isEmbedded
        ? memoryLocalCache()
        : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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

