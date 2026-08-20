import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { useToast } from './Toast.jsx'
import { compressMenuImages } from '../lib/imageBackfill.js'
import Icon from './Icon.jsx'

// One button, run once per venue: re-encodes the photos already live on the
// menu so a guest's phone stops decoding camera originals into thumbnails.
// See lib/imageBackfill.js for why this cannot be solved at upload time alone.
//
// Deliberately manual. It rewrites live menu data, and a silent self-healing
// migration that rewrites a venue's photos the moment an owner opens a page is
// not something to do on their behalf without them asking for it.
export default function CompressMenuImages() {
  const { tenantId } = useAuth()
  const { lang } = useI18n()
  const toast = useToast()
  const ar = lang === 'ar'
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState(null)

  async function run() {
    if (busy || !tenantId) return
    const ok = window.confirm(ar
      ? 'سيُعاد ترميز صور المنيو الكبيرة بمقاسٍ مناسبٍ للجوال. الصور الأصلية تبقى في مكانها ولا يُحذف شيء. قد تستغرق العملية عدة دقائق حسب عدد الصور. هل نبدأ؟'
      : 'Large menu photos will be re-encoded at a size a phone can hold. The originals stay in place and nothing is deleted. This can take a few minutes. Start?')
    if (!ok) return
    setBusy(true)
    setProg({ done: 0, total: 0 })
    try {
      const r = await compressMenuImages(tenantId, setProg)
      if (!r.compressed) {
        toast.success(ar ? 'كل الصور بمقاسٍ مناسبٍ أصلاً، لا حاجة لأي تغيير' : 'Every photo is already within size, nothing to change')
      } else {
        toast.success(ar
          ? `تم ضغط ${r.compressed} صورة وتحديث ${r.docs} سجلاً`
          : `Compressed ${r.compressed} photos across ${r.docs} records`)
      }
      if (r.failed.length) {
        toast.error(ar ? `تعذّر الوصول إلى ${r.failed.length} صورة، والباقي تم` : `${r.failed.length} photos were unreachable, the rest are done`)
      }
    } catch (e) {
      toast.error(ar ? 'تعذّر إكمال الضغط' : 'Could not finish compressing')
      console.error('[compressMenuImages]', e)
    } finally {
      setBusy(false)
      setProg(null)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline"
      onClick={run}
      disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
      title={ar
        ? 'يعيد ترميز صور المنيو الكبيرة لتفتح القائمة أسرع ولا ينهار جوال الضيف'
        : 'Re-encode oversized menu photos so the menu opens faster and guests’ phones stop crashing'}
    >
      <Icon name="image" size={14} />
      <span>
        {busy && prog && prog.total
          ? (ar ? `جارٍ الضغط ${prog.done}/${prog.total}` : `Compressing ${prog.done}/${prog.total}`)
          : busy
            ? (ar ? 'جارٍ الفحص' : 'Scanning')
            : (ar ? 'ضغط صور المنيو' : 'Compress menu photos')}
      </span>
    </button>
  )
}
