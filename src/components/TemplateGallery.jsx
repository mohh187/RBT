// Visual template gallery (THEMES_HUB #36): each back-office layout template
// is a live CSS-wireframe mini-card instead of a text chip, so managers pick
// by shape, not by name. Pure divs — no images, adapts to the active theme.

// schematic primitives: <i> blocks tinted from tokens (hot = brand-colored)
function Thumb({ sec, id }) {
  const t = `${sec}:${id}`
  switch (t) {
    // ===== cashier =====
    case 'cashier:grid':
      return (
        <span className="tpl-thumb">
          <span className="col" style={{ flex: 2.6 }}>
            <span className="grid3">{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ height: 10 }} />)}</span>
          </span>
          <span className="col"><i style={{ flex: 1 }} /><i className="hot" style={{ height: 7 }} /></span>
        </span>
      )
    case 'cashier:options':
      return (
        <span className="tpl-thumb">
          <span className="col">
            <i style={{ height: 7, width: '55%' }} />
            <span className="row3"><i style={{ flex: 1, height: 5 }} /><i className="hot" style={{ flex: 1, height: 5 }} /><i style={{ flex: 1, height: 5 }} /></span>
            <span className="row3"><i style={{ flex: 1, height: 5 }} /><i style={{ flex: 1, height: 5 }} /></span>
            <i className="hot" style={{ height: 8, marginTop: 'auto' }} />
          </span>
        </span>
      )
    case 'cashier:compact':
      return (
        <span className="tpl-thumb">
          <span className="col"><i style={{ height: 7, width: '60%' }} /><i style={{ height: 5 }} /><i style={{ height: 5 }} /><i style={{ height: 5 }} /><i className="hot" style={{ height: 6, width: '40%', marginTop: 'auto' }} /></span>
        </span>
      )
    case 'cashier:touch':
      return (
        <span className="tpl-thumb">
          <span className="col" style={{ flex: 0.7 }}><i style={{ height: 8 }} /><i style={{ height: 8 }} /><i style={{ height: 8 }} /></span>
          <span className="col" style={{ flex: 2.4 }}>
            <span className="grid2">{Array.from({ length: 4 }, (_, i) => <i key={i} style={{ height: 13 }} />)}</span>
          </span>
        </span>
      )
    case 'cashier:lite':
      return (
        <span className="tpl-thumb">
          <span className="col"><i style={{ height: 6 }} /><i style={{ height: 6 }} /><i style={{ height: 6 }} /><i className="hot" style={{ height: 9, marginTop: 'auto' }} /></span>
        </span>
      )
    // ===== kds =====
    case 'kds:rail':
      return (
        <span className="tpl-thumb">
          <span className="col"><i style={{ height: 5, width: '45%' }} />
            <span className="row3"><i style={{ flex: 1, height: 28 }} /><i style={{ flex: 1, height: 28 }} /><i className="hot" style={{ flex: 1, height: 28 }} /></span>
          </span>
        </span>
      )
    case 'kds:kanban':
      return (
        <span className="tpl-thumb">
          <span className="col"><i style={{ height: 4, width: '70%' }} /><i style={{ flex: 1 }} /><i style={{ flex: 1 }} /></span>
          <span className="col"><i className="hot" style={{ height: 4, width: '70%' }} /><i style={{ flex: 1 }} /></span>
          <span className="col"><i style={{ height: 4, width: '70%' }} /><i style={{ flex: 1 }} /><i style={{ flex: 1 }} /></span>
        </span>
      )
    case 'kds:grid':
      return (
        <span className="tpl-thumb">
          <span className="col"><span className="grid2">{Array.from({ length: 4 }, (_, i) => <i key={i} style={{ height: 17 }} />)}</span></span>
        </span>
      )
    case 'kds:display':
      return (
        <span className="tpl-thumb" style={{ background: '#14161d' }}>
          <span className="col"><i className="hot" style={{ height: 7 }} /><i style={{ height: 5, background: 'rgba(255,255,255,0.35)' }} /><i style={{ height: 5, background: 'rgba(255,255,255,0.35)' }} /><i style={{ height: 5, background: 'rgba(255,255,255,0.2)' }} /></span>
        </span>
      )
    // ===== dashboard =====
    case 'dashboard:exec':
      return (
        <span className="tpl-thumb">
          <span className="col">
            <span className="row3"><i style={{ flex: 1, height: 9 }} /><i style={{ flex: 1, height: 9 }} /><i className="hot" style={{ flex: 1, height: 9 }} /></span>
            <i style={{ flex: 1 }} />
          </span>
        </span>
      )
    case 'dashboard:ops':
      return (
        <span className="tpl-thumb">
          <span className="col" style={{ flex: 1.8 }}><i style={{ height: 6 }} /><i style={{ height: 6 }} /><i style={{ height: 6 }} /><i style={{ height: 6 }} /></span>
          <span className="col"><i className="hot" style={{ height: 12 }} /><i style={{ flex: 1 }} /></span>
        </span>
      )
    case 'dashboard:min':
      return (
        <span className="tpl-thumb">
          <span className="col"><span className="row3"><i style={{ flex: 1, height: 12 }} /><i className="hot" style={{ flex: 1, height: 12 }} /></span><i style={{ flex: 1 }} /></span>
        </span>
      )
    // ===== menu admin =====
    case 'menu:table':
      return (
        <span className="tpl-thumb">
          <span className="col"><i className="hot" style={{ height: 6 }} /><i style={{ height: 5 }} /><i style={{ height: 5 }} /><i style={{ height: 5 }} /></span>
        </span>
      )
    case 'menu:cards':
      return (
        <span className="tpl-thumb">
          <span className="col"><span className="grid3">{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ height: 11 }} />)}</span></span>
        </span>
      )
    case 'menu:catalog':
      return (
        <span className="tpl-thumb">
          <span className="col" style={{ flex: 0.7 }}><i style={{ height: 7 }} /><i className="hot" style={{ height: 7 }} /><i style={{ height: 7 }} /></span>
          <span className="col" style={{ flex: 2.2 }}><span className="grid2">{Array.from({ length: 4 }, (_, i) => <i key={i} style={{ height: 13 }} />)}</span></span>
        </span>
      )
    // ===== orders =====
    case 'orders:kanban':
      return (
        <span className="tpl-thumb">
          <span className="col"><i style={{ height: 4, width: '70%' }} /><i style={{ flex: 1 }} /><i style={{ flex: 1 }} /></span>
          <span className="col"><i className="hot" style={{ height: 4, width: '70%' }} /><i style={{ flex: 1 }} /></span>
          <span className="col"><i style={{ height: 4, width: '70%' }} /><i style={{ flex: 1 }} /></span>
        </span>
      )
    case 'orders:grid':
      return (
        <span className="tpl-thumb">
          <span className="col"><span className="grid2">{Array.from({ length: 4 }, (_, i) => <i key={i} style={{ height: 17 }} />)}</span></span>
        </span>
      )
    case 'orders:timeline':
      return (
        <span className="tpl-thumb">
          <span className="col" style={{ flex: 0.16 }}><i className="hot" style={{ width: 3, flex: 1, alignSelf: 'center' }} /></span>
          <span className="col"><i style={{ height: 7 }} /><i style={{ height: 7 }} /><i style={{ height: 7 }} /></span>
        </span>
      )
    default:
      return <span className="tpl-thumb"><span className="col"><i style={{ flex: 1 }} /></span></span>
  }
}

// One section's gallery row: label + a wrap of pickable thumbnails.
export default function TemplateGallery({ sec, def, current, onPick, ar }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small bold">{ar ? def.label.ar : def.label.en}</span>
      <div className="row wrap" style={{ gap: 8 }}>
        {def.options.map((o) => (
          <button key={o.id} type="button" className="tpl-pick" data-active={current === o.id ? 'true' : undefined} title={o.hint || ''} onClick={() => onPick(o.id)}>
            <Thumb sec={sec} id={o.id} />
            <span className="xs bold">{ar ? o.ar : o.en}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
