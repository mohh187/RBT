// Location helpers for order geofencing (dine-in premises + delivery radius).

// Great-circle distance in meters between two {lat,lng} points (haversine).
export function distanceMeters(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// One-shot geolocation as a promise → { lat, lng }.
export function getPosition(opts = { enableHighAccuracy: true, timeout: 8000 }) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('unsupported')); return }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      opts,
    )
  })
}
