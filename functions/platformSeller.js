// ==================== WHO IS SELLING ====================
// The legal identity printed on every quotation and tax invoice RBT360 issues.
//
// THIS IS A FROZEN CONSTANT, NOT A FIRESTORE DOCUMENT — deliberately. A CR
// number and a VAT number on a tax invoice are legal statements to a
// regulator. A console screen where one mistyped digit silently invalidates
// every invoice issued afterwards is the wrong home for them, and they change
// approximately never. What the console MAY edit is presentation: the logo,
// the contact line, the footer note. sellerBlock() merges those and refuses
// anything else — that refusal is the point of the function.
//
// Source: certificates held for شركة وميض الابداع المحدودة, of which RBT360 is
// a registered activity. Verified 2026-07-28.
//
// NOTE on the VAT number: two have circulated. `312896412200003` is the one on
// the ZATCA certificate and the only correct one. `312890641200003` is a digit
// transposition that was live in a sibling project until 2026-07-21 and got
// baked into the QR of every invoice issued there before that date. If you are
// ever comparing against an old document, that is why they differ.
const PLATFORM_SELLER = {
  legalNameAr: 'شركة وميض الابداع المحدودة',
  legalNameEn: 'Wameed Al-Ibdaa Co. Ltd.',
  brand: 'RBT360',
  crNumber: '1009203280',
  vatNumber: '312896412200003',
  unifiedNumber: '7049171403',
  buildingNo: '4107',
  streetAr: 'طريق الإمام فيصل بن تركي بن عبدالله',
  districtAr: 'حي أم سليم',
  cityAr: 'الرياض',
  cityEn: 'Riyadh',
  postalCode: '12744',
  additionalNo: '8682',
  shortAddress: 'RBGA4107',
  countryAr: 'المملكة العربية السعودية',
  countryCode: 'SA',
  bankNameAr: 'مصرف الراجحي',
  iban: 'SA2680000282608019595858',
  swift: 'RJHISARI',
  vatRate: 15,
}

// The seven fields above that are legal statements. Nothing may override them.
const FROZEN = ['legalNameAr', 'legalNameEn', 'crNumber', 'vatNumber', 'unifiedNumber', 'iban', 'vatRate']

const addressAr = (s) => `${s.buildingNo} ${s.streetAr}، ${s.districtAr}، ${s.cityAr} ${s.postalCode}، ${s.countryAr}`

// The seller block to stamp onto a document. `cfg` is
// platformConfig/finance.sellerDisplay — presentation only.
function sellerBlock(cfg) {
  const d = (cfg && cfg.sellerDisplay) || {}
  const out = {
    ...PLATFORM_SELLER,
    addressAr: addressAr(PLATFORM_SELLER),
    // Editable presentation.
    logoUrl: d.logoUrl || '/brand/word-448.png',
    contactEmail: d.contactEmail || 'support@rbt360sa.com',
    contactPhone: d.contactPhone || '',
    website: d.website || 'rbt360sa.com',
    footerNoteAr: d.footerNoteAr || '',
    showIban: d.showIban !== false,
  }
  // Belt and braces: even if a future caller passes the whole config in, the
  // legal fields come from the constant.
  FROZEN.forEach((k) => { out[k] = PLATFORM_SELLER[k] })
  return out
}

module.exports = { PLATFORM_SELLER, sellerBlock, addressAr, FROZEN }
