// Official Saudi Riyal symbol (SAMA) as an inline SVG + a direction-aware <Price>.
// AR: symbol on the LEFT of the number · EN: symbol on the RIGHT of the number.
import { fmtNum } from '../lib/format.js'

// The national currency mark — scales with font-size via `size` (em-based by default).
export function Riyal({ size = '1em', className = '', style }) {
  return (
    <svg
      viewBox="0 0 1124.14 1256.39"
      width={size}
      height={size}
      role="img"
      aria-label="SAR"
      className={`riyal ${className}`}
      style={{ display: 'inline-block', verticalAlign: '-0.11em', fill: 'currentColor', flex: 'none', ...style }}
    >
      <path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z" />
      <path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z" />
    </svg>
  )
}

// Render a price with the new symbol on the correct side. Non-SAR currencies stay as text.
export function Price({ value, currency = 'SAR', lang = 'ar', className = '', symbolSize = '0.92em' }) {
  const num = fmtNum(value, lang)
  if (currency && currency !== 'SAR') {
    return (
      <span className={className} dir="ltr" style={{ whiteSpace: 'nowrap' }}>
        {lang === 'ar' ? `${currency} ${num}` : `${num} ${currency}`}
      </span>
    )
  }
  return (
    <span className={`price-amt ${className}`} dir="ltr" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.26em', whiteSpace: 'nowrap' }}>
      {lang === 'ar'
        ? (<><Riyal size={symbolSize} /><span>{num}</span></>)
        : (<><span>{num}</span><Riyal size={symbolSize} /></>)}
    </span>
  )
}

export default Riyal
