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
  // A DINER NEVER GETS THE PERSISTENT CACHE. This is the fix for "the menu
  // collapses and reloads while scrolling", reported from an iPhone 15, a 12 and
  // an 11 — all modern, all with memory to spare, which is what ruled memory out
  // as the cause. What they share is WebKit's IndexedDB, and the persistent cache
  // is built on it: it takes a lock, elects a leader across tabs, and survives
  // between visits. Safari evicts that store aggressively, freezes and restores
  // tabs underneath it, and the SDK answers a store it no longer recognises with
  // INTERNAL ASSERTION FAILED (ca9/b815), which permanently fails its async
  // queue. Our own handler in main.jsx then wipes and reloads the page, and that
  // reload IS the "crash" the guest sees.
  //
  // Nothing about a guest needs any of it. They open a menu, read it, order, and
  // leave; offline persistence across visits buys them nothing, and every live
  // onSnapshot behaves identically on a memory cache. So the whole failure mode
  // is removed rather than recovered from: no IndexedDB, no lock, no leader
  // election, no assertion possible.
  //
  // Staff keep the persistent multi-tab cache, which is what it was built for:
  // a manager with the admin and the till open at once, on a device that stays
  // signed in, where surviving a dropped connection genuinely matters.
  const DINER_PATHS = ['/m/', '/t/', '/order/', '/e/', '/book/', '/reserve/', '/pass/', '/mcard/', '/screen', '/join/']
  let isDiner = false
  try {
    const p = typeof location !== 'undefined' ? location.pathname : ''
    isDiner = DINER_PATHS.some((x) => p === x || p.indexOf(x) === 0)
    // A venue's own domain serves its menu at the ROOT, so "/" is a diner
    // surface there and the staff console is not. Treated as a diner unless the
    // path is one of the app's own entry points.
    if (!isDiner && p === '/') {
      const h = (location.hostname || '').toLowerCase()
      isDiner = !(h.endsWith('web.app') || h.endsWith('firebaseapp.com') || h === 'localhost' || h === 'rbt360sa.com' || h === 'www.rbt360sa.com')
    }
  } catch (_) { isDiner = false }

  try {
    db = initializeFirestore(app, {
      localCache: (isEmbedded || isDiner)
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

