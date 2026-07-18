// Client side of the generic payment pipeline. The amount is ALWAYS derived
// server-side in createPayIntent — the client only names what to pay for.
import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot } from 'firebase/firestore'
import { functions, db } from './firebase.js'
import { deviceKey } from './device.js'

// ---- Saved cards (#6): token lives server-only; the client only sees last4/brand ----
// List this device's saved cards for a venue.
export async function listSavedCards(tenantId) {
  try { const res = await httpsCallable(functions, 'listSavedCards')({ tenantId, deviceKey: deviceKey() }); return res?.data?.cards || [] } catch (_) { return [] }
}
// Charge a saved card. Returns { paid, payIntentId, transactionUrl?, settled? }.
export async function payWithSavedCard({ tenantId, kind, refId, savedCardId }) {
  const res = await httpsCallable(functions, 'payWithSavedCard')({ tenantId, kind, refId, savedCardId, deviceKey: deviceKey() })
  return res?.data || {}
}
export async function deleteSavedCard(tenantId, savedCardId) {
  try { await httpsCallable(functions, 'deleteSavedCard')({ tenantId, savedCardId, deviceKey: deviceKey() }) } catch (_) { /* ignore */ }
}

// Start a payment for one flow. The amount is derived server-side in
// createPayIntent; we then send the browser to our OWN inline checkout page
// (/pay/:intentId) where Apple Pay opens its native sheet in place — no jump to
// checkout.moyasar.com. The hosted URL is stashed as a safety-net fallback the
// inline page uses if the embedded SDK can't initialise.
// kind: 'order' | 'subscription' | 'booking' | 'ticket'.
export async function startPayment(kind, tenantId, refId) {
  const res = await httpsCallable(functions, 'createPayIntent')({ kind, tenantId, refId })
  const data = res?.data || {}
  if (data.payIntentId) {
    try { sessionStorage.setItem(`payHosted:${data.payIntentId}`, data.url || '') } catch (_) { /* ignore */ }
    window.location.href = `${window.location.origin}/pay/${data.payIntentId}`
    return data
  }
  if (data.url) { window.location.href = data.url; return data } // legacy fallback
  throw new Error('no-checkout-url')
}

// Issue a FREE ticket via the server (it verifies the event's ticket-type price
// is 0 and creates it as 'valid'). Diners can no longer self-issue 'valid' tickets.
export async function issueFreeTicket({ tenantId, eventId, typeKey, name, phone }) {
  const res = await httpsCallable(functions, 'issueFreeTicket')({ tenantId, eventId, typeKey, name, phone })
  return res?.data || {}
}

// Settle from the return page (belt-and-suspenders with the webhook). Idempotent.
export async function confirmPayment({ payIntentId, paymentId }) {
  const res = await httpsCallable(functions, 'confirmPayIntent')({ payIntentId, paymentId })
  return res?.data || {}
}

// Live status of a pay intent (client reads its own by unguessable id).
export function watchPayIntent(payIntentId, cb) {
  if (!payIntentId) { cb(null); return () => {} }
  return onSnapshot(doc(db, 'payIntents', payIntentId), (d) => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null))
}
