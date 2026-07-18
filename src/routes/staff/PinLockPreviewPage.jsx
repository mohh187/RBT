import { useAuth } from '../../lib/auth.jsx'
import PinLock from '../../components/PinLock.jsx'
import { useSystemThemeBody } from '../../lib/systemThemes.js'

// The REAL lock screen rendered standalone for the Settings live preview iframe
// (demo mode: always visible, fake staff if none, digits just shake).
// Body mirror so theme variants/tokens match the real lock exactly.
export default function PinLockPreviewPage() {
  const { tenant, tenantId } = useAuth()
  useSystemThemeBody(tenant, 'admin')
  return <PinLock tenant={tenant} tenantId={tenantId} demo />
}
