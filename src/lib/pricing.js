// ONE definition of what an ordered line costs. Every ordering surface (diner
// menu, editorial menu, cashier, voice waiter) must price through here.
//
// THE RULE — a variant price of 0 (or blank/negative/NaN) means "this variant
// does not set its own price", NOT "this variant is free. The item editor lets
// a venue add variants purely as CHOICES (مشوي على الفحم / مقلي / على الصاج)
// and leave the price cell empty; the menu card already reads it that way
// (`effectivePrice` in growth.js, and every print/preview surface, filter
// variant prices with `> 0` and fall back to item.price).
//
// The ordering path used to read `variant ? variant.price : item.price`, which
// turned every choice-only variant into a 0 ﷼ line: on the live menu 17 of 54
// items advertised a real price on the card and then priced at 0 in the item
// stage, the add-to-cart bar and the cart total. That is money lost on every
// such order, so this helper is the single place the rule lives.

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// The unit price of `item` when `variant` is selected — before modifiers.
export function basePrice(item, variant) {
  const vp = num(variant?.price)
  return vp > 0 ? vp : num(item?.price)
}

// Sum of the selected modifiers/extras.
export function modifiersTotal(mods) {
  return (Array.isArray(mods) ? mods : []).reduce((s, m) => s + num(m?.price), 0)
}

// Full unit price: variant-or-item base + modifiers.
export function unitPrice(item, variant, mods) {
  return basePrice(item, variant) + modifiersTotal(mods)
}

// Does this variant carry its own price (worth showing next to its name)?
export function variantHasOwnPrice(variant) {
  return num(variant?.price) > 0
}
