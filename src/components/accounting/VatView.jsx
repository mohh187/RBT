import { Price } from '../Riyal.jsx'
import Icon from '../Icon.jsx'
import { downloadCsv } from '../../lib/accounting.js'

// VAT return for the period. Input VAT is only ever deducted from bills the
// venue explicitly flagged as vatable — unflagged bills are reported as a
// separate, honest "not claimed" figure rather than silently assumed.
export default function VatView({ vat, ar = true, lang = 'ar', currency = 'SAR', showMoney = true, tenant, periodLabel = '', onPrint }) {
  const M = ({ v }) => (showMoney ? <Price value={v} currency={currency} lang={lang} /> : <span className="faint">—</span>)
  const taxNumber = tenant?.vatNumber || tenant?.taxNumber || ''

  const rows = [
    { k: 'taxableSales', ar: 'المبيعات الخاضعة للضريبة (بدون ضريبة)', en: 'Taxable sales (excl. VAT)', v: vat.taxableSales },
    { k: 'outputVat', ar: 'ضريبة المخرجات المحصّلة', en: 'Output VAT collected', v: vat.outputVat, tone: 'bad' },
    { k: 'purchasesTaxable', ar: 'المشتريات والمصروفات الخاضعة', en: 'Taxable purchases & expenses', v: vat.purchasesTaxable },
    { k: 'inputVat', ar: 'ضريبة المدخلات القابلة للخصم', en: 'Deductible input VAT', v: vat.inputVat, tone: 'good' },
  ]

  const exportCsv = () => downloadCsv('vat-return.csv', rows.concat([{ k: 'netPayable', ar: 'صافي الضريبة المستحقة', en: 'Net VAT payable', v: vat.netPayable }]).map((r) => ({
    line: ar ? r.ar : r.en, amount: r.v,
  })), [
    { key: 'line', label: ar ? 'البند' : 'Line' },
    { key: 'amount', label: ar ? 'المبلغ' : 'Amount' },
  ])

  return (
    <div className="acc-stack">
      <div className="acc-card acc-print-area" id="acc-print-vat">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="acc-card-title"><Icon name="receipt" size={17} /> {ar ? 'الإقرار الضريبي' : 'VAT return'}</span>
          <span className="acc-no-print row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-outline" onClick={exportCsv}><Icon name="download" size={15} /> CSV</button>
            {onPrint && <button className="btn btn-sm btn-outline" onClick={onPrint}><Icon name="print" size={15} /> {ar ? 'طباعة' : 'Print'}</button>}
          </span>
        </div>

        <div className="acc-decl-head">
          <div>
            <strong>{tenant?.name || (ar ? 'المنشأة' : 'Venue')}</strong>
            <div className="acc-hint">
              {taxNumber
                ? `${ar ? 'الرقم الضريبي' : 'Tax number'}: ${taxNumber}`
                : (ar ? 'لا يوجد رقم تسجيل ضريبي في الإعدادات' : 'No tax registration number set')}
            </div>
          </div>
          <div className="acc-decl-period">
            <span className="acc-period-label">{ar ? 'الفترة' : 'Period'}</span>
            <strong className="acc-num">{periodLabel}</strong>
            <span className="acc-period-label">{ar ? `النسبة ${vat.rate}%` : `Rate ${vat.rate}%`}</span>
          </div>
        </div>

        {!taxNumber && vat.outputVat > 0 && (
          <div className="acc-warn">
            <Icon name="warning" size={15} />
            <span>{ar ? 'حُصّلت ضريبة بدون رقم تسجيل ضريبي مسجّل في الإعدادات — الفاتورة الضريبية غير مكتملة نظاماً.' : 'VAT collected without a registered tax number.'}</span>
          </div>
        )}

        <div className="acc-pnl">
          {rows.map((r) => (
            <div key={r.k} className="acc-pnl-row is-static" data-tone={r.tone || ''}>
              <span className="acc-pnl-label">{ar ? r.ar : r.en}</span>
              <span className="acc-pnl-val acc-num"><M v={r.v} /></span>
            </div>
          ))}
          <div className="acc-pnl-row is-strong" data-tone={vat.netPayable > 0 ? 'bad' : 'good'}>
            <span className="acc-pnl-label">{ar ? 'صافي الضريبة المستحقة للهيئة' : 'Net VAT payable'}</span>
            <span className="acc-pnl-val acc-num"><M v={vat.netPayable} /></span>
          </div>
        </div>

        {vat.purchasesUntaxed > 0 && (
          <p className="acc-hint">
            {ar
              ? `توجد مشتريات ومصروفات بقيمة ${vat.purchasesUntaxed} لم تُعلَّم كخاضعة للضريبة، لذلك لم تُخصم ضريبة مدخلاتها. علّمها من تبويب «المصروفات والفواتير» إن كانت فواتيرها ضريبية.`
              : `Purchases worth ${vat.purchasesUntaxed} were not flagged vatable, so no input VAT was deducted for them.`}
          </p>
        )}
        <p className="acc-hint">
          {ar
            ? 'الأرقام أعلاه محسوبة من الطلبات المسدّدة والفواتير المسجّلة فعلياً في النظام لهذه الفترة فقط. راجعها قبل الرفع للهيئة.'
            : 'Figures are derived only from settled orders and recorded bills in this period.'}
        </p>
      </div>
    </div>
  )
}
