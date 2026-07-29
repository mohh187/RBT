// LANGUAGE AND DIRECTION FOR OUTGOING MAIL.
//
// Two jobs, deliberately in one small module because they are the same fact:
// which language this reader gets, and therefore which way the page runs.
//
// WHY DIRECTION IS A PARAMETER AND NOT A CONSTANT
// The templates used to declare RTL once, on <html>. Gmail strips <html>,
// <head> and <body> and keeps only the markup between them, so that single
// declaration was thrown away and every report arrived left-to-right — labels
// on the wrong edge, numbers crowding the text. Direction now travels with the
// brand object and is stamped on the nodes Gmail actually keeps.
//
// WHY A PICK FUNCTION AND NOT A KEY TABLE
// There are ~7 email builders and ~60 strings. A key table needs a drift guard
// (this repo already had to build one for exactly that class of problem, see
// MIRRORS in scripts/guard.mjs) and a missing key degrades SILENTLY to the key
// itself. `p('رقم الطلب', 'Order number')` cannot go stale, cannot go missing,
// and puts the English where the reviewer is already reading the Arabic.

// Anything unrecognised is Arabic: this is an Arabic-first product, and an
// unexpected value must never produce a half-translated page.
function normLang(v) {
  return String(v || '').toLowerCase().startsWith('en') ? 'en' : 'ar'
}

function dirOf(lang) {
  return normLang(lang) === 'en' ? 'ltr' : 'rtl'
}

// The reading edge (where a label sits) and the far edge (where a figure sits).
// Values are pinned to the FAR edge in both languages so the eye runs down one
// column of numbers; only which physical side that is changes.
const startOf = (dir) => (dir === 'rtl' ? 'right' : 'left')
const endOf = (dir) => (dir === 'rtl' ? 'left' : 'right')

// L('en')('نص', 'text') -> 'text'
function L(lang) {
  const en = normLang(lang) === 'en'
  return (ar, eng) => (en ? eng : ar)
}

// Item lines carry both names. Prefer the reader's, fall back to whichever
// exists — a venue that only filled the Arabic name still gets a readable line.
function pickName(obj, lang, fallback) {
  const o = obj || {}
  const ar = String(o.nameAr || '').trim()
  const en = String(o.nameEn || '').trim()
  const first = normLang(lang) === 'en' ? (en || ar) : (ar || en)
  return first || fallback || ''
}

module.exports = { normLang, dirOf, startOf, endOf, L, pickName }
