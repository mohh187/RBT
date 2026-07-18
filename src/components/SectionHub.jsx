import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import Icon from './Icon.jsx'

// Reusable management hub: a sticky sub-tab bar that swaps the active sub-page
// (the staff-affairs pattern, generalized). Tabs are capability-gated and the
// active tab is URL-persisted (?tab=) for deep-linking. Each tab lazily renders
// its own page component (which keeps its own `.page` wrapper).
export default function SectionHub({ tabs }) {
  const { can } = useAuth()
  const visible = tabs.filter((tb) => !tb.cap || can(tb.cap))
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(visible[0]?.id)
  useEffect(() => {
    const want = params.get('tab')
    if (want && visible.find((tb) => tb.id === want)) setTab(want)
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  const active = visible.find((tb) => tb.id === tab) ? tab : visible[0]?.id
  const select = (id) => { const p = new URLSearchParams(params); p.set('tab', id); setParams(p, { replace: true }); setTab(id) }
  const cur = visible.find((tb) => tb.id === active)
  return (
    <>
      {visible.length > 1 && (
        <div className="page hub-tabs" style={{ paddingBottom: 6, borderBottom: '1px solid var(--border)', width: '100%', overflow: 'hidden' }}>
          <div className="row scroll-x" style={{ gap: 8, paddingBottom: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' }}>
            {visible.map((tb) => (
              <button
                key={tb.id}
                className="btn btn-sm"
                style={{
                  whiteSpace: 'nowrap',
                  flex: '0 0 auto',
                  borderRadius: 'var(--r-md)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  border: '1px solid',
                  borderColor: active === tb.id ? 'var(--brand)' : 'var(--border)',
                  background: active === tb.id ? 'var(--brand)' : 'var(--surface)',
                  color: active === tb.id ? 'var(--on-brand)' : 'var(--text-muted)'
                }}
                onClick={() => select(tb.id)}
              >
                <Icon name={tb.icon} size={14} />
                <span>{tb.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="hub-container" style={{ width: '100%' }}>
        {cur ? cur.render() : null}
      </div>
    </>
  )
}
