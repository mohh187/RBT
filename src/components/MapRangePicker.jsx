// MapRangePicker — reusable Leaflet picker that ALWAYS pairs the map with
// manual numeric inputs (user rule: both ways everywhere).
//   mode="radius": pick a center + a single radius (m or km) — circle preview.
//   mode="zones":  pick a center + concentric delivery zones [{maxKm, fee}].
// Lifecycle-safe: map created once on a ref div, layers updated in a separate
// effect (refs), full map.remove() cleanup on unmount. Latin digits only.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Icon from './Icon.jsx'
import { getPosition } from '../lib/geo.js'

const RIYADH = { lat: 24.7136, lng: 46.6753 }
// zone stroke/fill colors cycle; index 0 resolves to the live --brand value
const ZONE_COLOR_VARS = ['var(--brand)', '#c9a24b', '#4b8bc9', '#7c4bc9']

// Resolve any CSS color expression (incl. var()/color-mix) to a concrete
// rgb() string Leaflet can put on SVG attributes — probe inherits theme vars
// from the component subtree.
function resolveColor(host, cssValue, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const probe = document.createElement('i')
    probe.style.color = cssValue
    probe.style.display = 'none'
    ;(host || document.body).appendChild(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out || fallback
  } catch {
    return fallback
  }
}

export default function MapRangePicker({
  mode = 'radius',
  center = null,
  onCenter,
  radius = 0,
  onRadius,
  unit = 'm',
  zones = [],
  onZones,
  label,
  height = 260,
}) {
  const wrapRef = useRef(null)
  const mapDivRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef([])
  const fitLayerRef = useRef(null) // outermost circle — target of «تكبير للنطاق»
  const cbRef = useRef({})
  cbRef.current = { onCenter, onRadius, onZones, center }

  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState('')

  // ---- create the map once ----
  useEffect(() => {
    if (typeof window === 'undefined' || !mapDivRef.current || mapRef.current) return
    const map = L.map(mapDivRef.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    const c0 = cbRef.current.center
    map.setView(c0 && c0.lat != null ? [c0.lat, c0.lng] : [RIYADH.lat, RIYADH.lng], c0 && c0.lat != null ? 14 : 11)
    map.on('click', (e) => cbRef.current.onCenter?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => map.invalidateSize())
      ro.observe(mapDivRef.current)
    }
    mapRef.current = map
    return () => {
      ro?.disconnect()
      map.remove()
      mapRef.current = null
      layersRef.current = []
      fitLayerRef.current = null
    }
  }, [])

  // ---- redraw layers when props change ----
  const zonesFp = JSON.stringify(zones || [])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.forEach((l) => map.removeLayer(l))
    layersRef.current = []
    fitLayerRef.current = null
    if (!center || center.lat == null) return
    const ll = [Number(center.lat), Number(center.lng)]
    const brand = resolveColor(wrapRef.current, 'var(--brand)', '#7c2d2d')
    if (mode === 'zones') {
      const sorted = [...(zones || [])]
        .filter((z) => Number(z?.maxKm) > 0)
        .sort((a, b) => Number(a.maxKm) - Number(b.maxKm))
      sorted.forEach((z, i) => {
        const idx = i % ZONE_COLOR_VARS.length
        const color = idx === 0 ? brand : ZONE_COLOR_VARS[idx]
        const c = L.circle(ll, { radius: Number(z.maxKm) * 1000, color, fillColor: color, fillOpacity: 0.08, weight: 2 })
        c.bindTooltip(`حتى ${Number(z.maxKm)} كم — رسوم ${Number(z.fee) || 0}`, { permanent: true, direction: 'top' })
        c.addTo(map)
        layersRef.current.push(c)
        fitLayerRef.current = c // sorted ascending → last is outermost
      })
    } else {
      const meters = unit === 'km' ? Number(radius) * 1000 : Number(radius)
      if (Number.isFinite(meters) && meters > 0) {
        const c = L.circle(ll, { radius: meters, color: brand, fillColor: brand, fillOpacity: 0.12, weight: 2 })
        c.addTo(map)
        layersRef.current.push(c)
        fitLayerRef.current = c
      }
    }
    // center as circleMarker — bundler-safe (no default marker icon assets)
    const marker = L.circleMarker(ll, { radius: 6, weight: 2, color: '#ffffff', fillColor: brand, fillOpacity: 1 })
    marker.addTo(map)
    layersRef.current.push(marker)
    if (!map.getBounds().contains(ll)) map.panTo(ll)
  }, [mode, center?.lat, center?.lng, radius, unit, zonesFp])

  // ---- actions ----
  const locate = async () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGeoError('تحديد الموقع غير مدعوم في هذا الجهاز')
      return
    }
    setLocating(true)
    setGeoError('')
    try {
      const p = await getPosition()
      cbRef.current.onCenter?.(p)
      const map = mapRef.current
      if (map) map.setView([p.lat, p.lng], Math.max(map.getZoom() || 0, 14))
    } catch {
      setGeoError('تعذر تحديد موقعك — تأكد من تفعيل صلاحية الموقع')
    }
    setLocating(false)
  }

  const fitRange = () => {
    const map = mapRef.current
    const target = fitLayerRef.current
    if (map && target) map.fitBounds(target.getBounds(), { padding: [24, 24] })
  }

  // zones: every emit is sorted by maxKm (contract with the parent)
  const emitZones = (list) => cbRef.current.onZones?.([...list].sort((a, b) => (Number(a.maxKm) || 0) - (Number(b.maxKm) || 0)))
  const setZone = (i, patch) => emitZones((zones || []).map((z, idx) => (idx === i ? { ...z, ...patch } : z)))
  const removeZone = (i) => emitZones((zones || []).filter((_, idx) => idx !== i))
  const addZone = () => {
    const last = (zones || []).length ? Math.max(...zones.map((z) => Number(z.maxKm) || 0)) : 0
    emitZones([...(zones || []), { maxKm: last + 3, fee: 0 }])
  }

  const slider = unit === 'km' ? { min: 1, max: 100, step: 1 } : { min: 20, max: 2000, step: 10 }
  const meters = unit === 'km' ? Number(radius) * 1000 : Number(radius)
  const hasRange = !!center && center.lat != null && (mode === 'zones'
    ? (zones || []).some((z) => Number(z?.maxKm) > 0)
    : Number.isFinite(meters) && meters > 0)

  return (
    <div ref={wrapRef} className="stack" style={{ gap: 'var(--sp-2, 8px)' }}>
      <style>{'.leaflet-container{font:inherit;}'}</style>
      {label ? <div className="small" style={{ fontWeight: 600 }}>{label}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3, 12px)', alignItems: 'stretch' }}>
        {/* map */}
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div
            ref={mapDivRef}
            style={{
              height,
              width: '100%',
              borderRadius: 'var(--r-md, 12px)',
              overflow: 'hidden',
              border: '1px solid var(--border)',
              position: 'relative',
              zIndex: 0,
            }}
          />
        </div>

        {/* manual controls beside the map — always visible */}
        <div className="stack" style={{ flex: '1 1 180px', minWidth: 180, gap: 'var(--sp-2, 8px)', alignContent: 'flex-start' }}>
          {mode === 'radius' ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="small">النطاق</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: 90 }}
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={radius}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value)
                    if (Number.isFinite(v)) cbRef.current.onRadius?.(v)
                  }}
                />
                <span className="small faint">{unit === 'km' ? 'كم' : 'م'}</span>
              </div>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={Number(radius) || slider.min}
                onChange={(e) => cbRef.current.onRadius?.(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--brand)' }}
              />
            </div>
          ) : null}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={locate} disabled={locating}>
              <Icon name="pin" size={14} /> {locating ? 'جار تحديد الموقع…' : 'موقعي الحالي'}
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={fitRange} disabled={!hasRange}>
              <Icon name="search" size={14} /> تكبير للنطاق
            </button>
          </div>

          {center && center.lat != null ? (
            <div className="xs faint">
              <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Number(center.lat).toFixed(5)}, {Number(center.lng).toFixed(5)}
              </span>
            </div>
          ) : (
            <div className="xs faint">اضغط على الخريطة لتحديد الموقع</div>
          )}
          {geoError ? <div className="xs" style={{ color: 'var(--danger)' }}>{geoError}</div> : null}
        </div>
      </div>

      {/* zones list — manual editing under the map */}
      {mode === 'zones' ? (
        <div className="stack" style={{ gap: 8 }}>
          {(zones || []).length === 0 ? (
            <div className="small faint">لا توجد نطاقات توصيل — الميزة غير مفعلة. أضف نطاقا لتحديد الرسوم حسب المسافة.</div>
          ) : (
            (zones || []).map((z, i) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    flex: '0 0 auto',
                    background: ZONE_COLOR_VARS[i % ZONE_COLOR_VARS.length],
                  }}
                />
                <span className="small">حتى</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: 80 }}
                  min={1}
                  step={1}
                  value={z.maxKm}
                  onChange={(e) => setZone(i, { maxKm: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <span className="small faint">كم</span>
                <span className="small">رسوم</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: 80 }}
                  min={0}
                  step={0.5}
                  value={z.fee}
                  onChange={(e) => setZone(i, { fee: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <button type="button" className="icon-btn" aria-label="حذف النطاق" onClick={() => removeZone(i)}>
                  <Icon name="delete" size={16} />
                </button>
              </div>
            ))
          )}
          <div className="row">
            <button type="button" className="btn btn-sm btn-outline" onClick={addZone}>
              <Icon name="add" size={14} /> إضافة نطاق
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
