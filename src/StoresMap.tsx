import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { StoreHit } from './stores'

export type MapCenter = { lat: number; lng: number }

type Props = {
  center: MapCenter | null
  radiusKm: number
  hits: StoreHit[]
  emptyHint: string
  /** Fit markers and skip the radius circle (Ganz Deutschland). */
  fitHits?: boolean
}

const DE_CENTER: [number, number] = [51.1657, 10.4515]
const DE_ZOOM = 6

function storeDivIcon(selected = false) {
  return L.divIcon({
    className: 'stores-marker' + (selected ? ' stores-marker-sel' : ''),
    html: '<span class="stores-marker-dot"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function centerDivIcon() {
  return L.divIcon({
    className: 'stores-marker stores-marker-center',
    html: '<span class="stores-marker-pin"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

export function StoresMap({ center, radiusKm, hits, emptyHint, fitHits = false }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const centerMarkerRef = useRef<L.Marker | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const lastFitKey = useRef<string>('')

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    }).setView(DE_CENTER, DE_ZOOM)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    markersLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false })
    })
    ro.observe(containerRef.current)

    const t = window.setTimeout(() => map.invalidateSize({ animate: false }), 80)

    return () => {
      window.clearTimeout(t)
      ro.disconnect()
      map.remove()
      mapRef.current = null
      circleRef.current = null
      centerMarkerRef.current = null
      markersLayerRef.current = null
      lastFitKey.current = ''
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = markersLayerRef.current
    if (!map || !layer) return

    layer.clearLayers()

    if (!center) {
      if (circleRef.current) {
        map.removeLayer(circleRef.current)
        circleRef.current = null
      }
      if (centerMarkerRef.current) {
        map.removeLayer(centerMarkerRef.current)
        centerMarkerRef.current = null
      }
      map.setView(DE_CENTER, DE_ZOOM)
      lastFitKey.current = ''
      return
    }

    const { lat, lng } = center
    const meters = Math.max(500, radiusKm * 1000)

    if (!circleRef.current) {
      circleRef.current = L.circle([lat, lng], {
        radius: meters,
        color: '#d4af37',
        weight: 2,
        fillColor: '#d4af37',
        fillOpacity: 0.12,
      }).addTo(map)
    } else {
      circleRef.current.setLatLng([lat, lng])
      circleRef.current.setRadius(meters)
    }

    if (!centerMarkerRef.current) {
      centerMarkerRef.current = L.marker([lat, lng], { icon: centerDivIcon(), zIndexOffset: 600 }).addTo(map)
    } else {
      centerMarkerRef.current.setLatLng([lat, lng])
    }

    const placed: L.LatLngTuple[] = []
    for (const h of hits) {
      if (h.lat == null || h.lng == null) continue
      placed.push([h.lat, h.lng])
      const m = L.marker([h.lat, h.lng], { icon: storeDivIcon() })
      const dist =
        h.distanceKm != null ? `${h.distanceKm.toFixed(1)} km` : ''
      m.bindPopup(
        `<strong>${escapeHtml(h.name)}</strong><br/>${escapeHtml(h.address || '')}` +
          (dist ? `<br/><span style="opacity:.8">${escapeHtml(dist)}</span>` : ''),
      )
      layer.addLayer(m)
    }

    if (fitHits) {
      if (circleRef.current) {
        map.removeLayer(circleRef.current)
        circleRef.current = null
      }
      if (centerMarkerRef.current) {
        map.removeLayer(centerMarkerRef.current)
        centerMarkerRef.current = null
      }
      const fitKey = `hits:${placed.map((pt) => pt.join(',')).join('|')}`
      if (fitKey !== lastFitKey.current) {
        lastFitKey.current = fitKey
        if (placed.length) {
          try {
            map.fitBounds(L.latLngBounds(placed), { padding: [28, 28], maxZoom: 8 })
          } catch {
            map.setView(DE_CENTER, DE_ZOOM)
          }
        } else {
          map.setView(DE_CENTER, DE_ZOOM)
        }
      }
      map.invalidateSize({ animate: false })
      return
    }

    // Fit to circle when center changes or radius jumps a lot; avoid fighting live drag.
    const fitKey = `${lat.toFixed(4)},${lng.toFixed(4)}`
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey
      try {
        map.fitBounds(circleRef.current.getBounds(), { padding: [28, 28], maxZoom: 12 })
      } catch {
        map.setView([lat, lng], 10)
      }
    } else if (circleRef.current) {
      // Keep circle in view when radius grows beyond current viewport
      const b = circleRef.current.getBounds()
      if (!map.getBounds().contains(b)) {
        map.fitBounds(b, { padding: [28, 28], maxZoom: 12 })
      }
    }

    map.invalidateSize({ animate: false })
  }, [center, radiusKm, hits, fitHits])

  return (
    <div className="stores-map-wrap">
      <div ref={containerRef} className="stores-map" role="img" aria-label="map" />
      {!center && <div className="stores-map-empty">{emptyHint}</div>}
    </div>
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
