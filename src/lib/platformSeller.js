// Browser mirror of functions/platformSeller.js — WHO IS SELLING.
//
// The legal identity of the company behind RBT360. It appears in three places
// a customer can see — the landing footer, a quotation, a tax invoice — and
// those three MUST agree: a CR number that reads one way on the marketing page
// and another on the invoice is the kind of discrepancy a buyer's accountant
// notices before you do.
//
// The server copy is the one that gets stamped onto an issued document. This
// copy exists because functions/ is CommonJS and never reaches the browser.
// scripts/guard.mjs fails the build if the two drift.
//
// FROZEN. The seven legal fields (names, CR, VAT, unified number, IBAN, VAT
// rate) are statements to a regulator, not settings. Presentation — logo,
// contact line, footer note — is what the console may edit.
export const PLATFORM_SELLER = {
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

// Same composition the server uses, so a preview and an issued document print
// the address identically rather than «nearly».
export const SELLER_ADDRESS_AR =
  `${PLATFORM_SELLER.buildingNo} ${PLATFORM_SELLER.streetAr}، ${PLATFORM_SELLER.districtAr}، ` +
  `${PLATFORM_SELLER.cityAr} ${PLATFORM_SELLER.postalCode}، ${PLATFORM_SELLER.countryAr}`

export const SELLER_CONTACT = {
  email: 'support@rbt360sa.com',
  website: 'rbt360sa.com',
}

// The full block a preview (quotation form) or the landing footer renders.
export const sellerPreview = () => ({
  ...PLATFORM_SELLER,
  addressAr: SELLER_ADDRESS_AR,
  contactEmail: SELLER_CONTACT.email,
  website: SELLER_CONTACT.website,
  logoUrl: '/brand/word-448.png',
  showIban: true,
})
