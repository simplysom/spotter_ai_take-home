import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

// Fix default icon path broken by bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ── Custom icons ──────────────────────────────────────────────────────────────
function makeIcon(emoji, bg = '#1d4ed8') {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:32px;height:32px;border-radius:50% 50% 50% 0;
        background:${bg};border:2px solid white;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;transform:rotate(-45deg);
        box-shadow:0 2px 8px rgba(0,0,0,0.4);
      ">
        <span style="transform:rotate(45deg)">${emoji}</span>
      </div>`,
    iconSize:   [32, 32],
    iconAnchor: [16, 32],
    popupAnchor:[0, -34],
  })
}

const ICONS = {
  current: makeIcon('📍', '#2563eb'),
  pickup:  makeIcon('📦', '#16a34a'),
  dropoff: makeIcon('🏁', '#dc2626'),
  rest:    makeIcon('🌙', '#7c3aed'),
  fuel:    makeIcon('⛽', '#d97706'),
  break_:  makeIcon('☕', '#0891b2'),
  pretrip: makeIcon('🔧', '#6366f1'),
}

// ── Fit bounds helper ─────────────────────────────────────────────────────────
function FitBounds({ route, coords }) {
  const map = useMap()
  useEffect(() => {
    if (!route && !coords) return
    const pts = []
    if (route?.to_pickup)  pts.push(...route.to_pickup)
    if (route?.to_dropoff) pts.push(...route.to_dropoff)
    if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] })
    } else if (coords?.current) {
      map.setView([coords.current.lat, coords.current.lon], 8)
    }
  }, [route, coords, map])
  return null
}

// ── Stop icon type ────────────────────────────────────────────────────────────
function stopIcon(stop) {
  const a = stop.activity?.toLowerCase() || ''
  if (a.includes('restart')) return ICONS.rest
  if (a.includes('rest'))    return ICONS.rest
  if (a.includes('fuel'))   return ICONS.fuel
  if (a.includes('break'))  return ICONS.break_
  if (a.includes('pre-trip') || a.includes('post-trip')) return ICONS.pretrip
  if (a.includes('pickup') || a.includes('loading'))   return ICONS.pickup
  if (a.includes('dropoff') || a.includes('unloading')) return ICONS.dropoff
  return ICONS.break_
}

function formatDuration(h) {
  const hrs  = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0)  return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MapView({ tripData }) {
  if (!tripData) return null
  const { route, coordinates, stops, summary, routing_meta } = tripData

  if (!summary) {
    return <div className="card p-8 text-center text-gray-500">No trip data available.</div>
  }

  // Filter meaningful stops and use server-provided lat/lon
  const stopMarkers = (stops || []).filter(s => {
    const a = (s.activity || '').toLowerCase()
    return (a.includes('rest') || a.includes('restart') || a.includes('fuel') || a.includes('break') ||
            a.includes('pickup') || a.includes('dropoff') ||
            a.includes('pre-trip') || a.includes('post-trip')) &&
           s.lat != null && s.lon != null
  })

  const center = coordinates?.current
    ? [coordinates.current.lat, coordinates.current.lon]
    : [39.5, -98.35]

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Distance', value: `${(summary.total_distance_miles ?? 0).toFixed(0)} mi`,
            sub: routing_meta ? `${routing_meta.segment1_miles} + ${routing_meta.segment2_miles} mi` : null },
          { label: 'Drive Time',     value: formatDuration(summary.total_drive_hours ?? 0) },
          { label: 'Rest Time',      value: formatDuration(summary.total_rest_hours ?? 0) },
          { label: 'Trip Days',      value: `${summary.total_days ?? 0} day${(summary.total_days ?? 0) > 1 ? 's' : ''}` },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3">
            <p className="text-xs text-gray-500 mb-0.5">{s.label}</p>
            <p className="text-lg font-bold text-white">{s.value}</p>
            {s.sub && <p className="text-[10px] text-gray-600 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="card overflow-hidden flex-1 min-h-[420px]">
        <MapContainer
          center={center}
          zoom={6}
          style={{ width: '100%', height: '100%', minHeight: 420 }}
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitBounds route={route} coords={coordinates} />

          {/* Route lines */}
          {route?.to_pickup && route.to_pickup.length > 1 && (
            <Polyline
              positions={route.to_pickup}
              pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.8 }}
            />
          )}
          {route?.to_dropoff && route.to_dropoff.length > 1 && (
            <Polyline
              positions={route.to_dropoff}
              pathOptions={{ color: '#10b981', weight: 4, opacity: 0.8 }}
            />
          )}

          {/* Start marker */}
          {coordinates?.current && (
            <Marker
              position={[coordinates.current.lat, coordinates.current.lon]}
              icon={ICONS.current}
            >
              <Popup>
                <strong>Starting Location</strong><br />
                {coordinates.current.display_name}
              </Popup>
            </Marker>
          )}

          {/* Pickup marker */}
          {coordinates?.pickup && (
            <Marker
              position={[coordinates.pickup.lat, coordinates.pickup.lon]}
              icon={ICONS.pickup}
            >
              <Popup>
                <strong>Pickup Location</strong><br />
                {coordinates.pickup.display_name}
              </Popup>
            </Marker>
          )}

          {/* Dropoff marker */}
          {coordinates?.dropoff && (
            <Marker
              position={[coordinates.dropoff.lat, coordinates.dropoff.lon]}
              icon={ICONS.dropoff}
            >
              <Popup>
                <strong>Dropoff Location</strong><br />
                {coordinates.dropoff.display_name}
              </Popup>
            </Marker>
          )}

          {/* Stop markers (using server-computed lat/lon) */}
          {stopMarkers.map((s, i) => (
            <Marker key={i} position={[s.lat, s.lon]} icon={stopIcon(s)}>
              <Popup>
                <strong>{s.activity}</strong><br />
                {s.location}<br />
                <em>Duration: {formatDuration(s.duration_hours)}</em>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400 px-1">
        {[
          { color: '#3b82f6', label: 'Route to pickup' },
          { color: '#10b981', label: 'Route to dropoff' },
          { color: '#2563eb', label: 'Start' },
          { color: '#16a34a', label: 'Pickup' },
          { color: '#dc2626', label: 'Dropoff' },
          { color: '#7c3aed', label: 'Rest stop' },
          { color: '#d97706', label: 'Fuel stop' },
          { color: '#0891b2', label: 'Break' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}
