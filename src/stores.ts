/** Official Riftbound retailer lookup via UVS / Spicerack public API (no stock). */

export const RIFTBOUND_GAME_ID = 3
export const STORE_LOCATOR_URL = 'https://locator.riftbound.uvsgames.com/find-a-store'
const STORES_API = 'https://api.riftbound.uvsgames.com/api/v2/game-stores/'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** UI / filter radius limits (km). UVS API still takes miles — we convert. */
export const STORE_RADIUS_KM_MIN = 1
export const STORE_RADIUS_KM_MAX = 250
export const STORE_RADIUS_KM_DEFAULT = 50

export type GeoPoint = { lat: number; lng: number; label: string }

export type StoreHit = {
  id: string
  name: string
  address: string
  city: string
  country: string
  website: string | null
  phone: string | null
  lat: number | null
  lng: number | null
  distanceKm: number | null
  types: string[]
}

type FetchJson = (url: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>

async function fetchJson(url: string): Promise<unknown> {
  if (typeof window !== 'undefined' && window.riftbound?.fetchJson) {
    const res = await window.riftbound.fetchJson(url)
    if (!res.ok) throw new Error(res.error || 'fetch failed')
    return res.data
  }
  // Dev / browser fallback (may hit CORS)
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function geocodeQuery(query: string, countryBias = 'de'): Promise<GeoPoint | null> {
  const q = query.trim()
  if (!q) return null
  const params = new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
    addressdetails: '0',
  })
  if (countryBias) params.set('countrycodes', countryBias)
  const data = (await fetchJson(`${NOMINATIM}?${params}`)) as Array<{
    lat: string
    lon: string
    display_name: string
  }>
  if (!Array.isArray(data) || !data.length) return null
  const hit = data[0]
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: hit.display_name,
  }
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Convert km → miles for UVS `num_miles` (ceil so we never undershoot). */
export function kmToApiMiles(km: number) {
  const n = Number.isFinite(km) ? km : STORE_RADIUS_KM_DEFAULT
  return Math.max(1, Math.ceil(n / 1.609344))
}

export function clampStoreRadiusKm(km: number) {
  if (!Number.isFinite(km)) return STORE_RADIUS_KM_DEFAULT
  return Math.min(STORE_RADIUS_KM_MAX, Math.max(STORE_RADIUS_KM_MIN, Math.round(km)))
}

/**
 * Search official Riftbound stores near a point.
 * @param radiusKm user-facing radius in kilometres (converted to miles for the API).
 */
export async function searchStoresNear(
  lat: number,
  lng: number,
  radiusKm = STORE_RADIUS_KM_DEFAULT,
  pageSize = 40,
): Promise<StoreHit[]> {
  const miles = kmToApiMiles(radiusKm)
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    num_miles: String(miles),
    page: '1',
    page_size: String(pageSize),
    game_id: String(RIFTBOUND_GAME_ID),
  })
  const data = (await fetchJson(`${STORES_API}?${params}`)) as {
    results?: Array<{
      id: string
      store?: {
        name?: string
        full_address?: string
        city?: string
        country?: string
        website?: string | null
        phone_number?: string | null
        latitude?: number | null
        longitude?: number | null
        store_types_pretty?: string[]
      }
      store_types_pretty?: string[]
    }>
  }
  const out: StoreHit[] = []
  for (const r of data.results || []) {
    const s = r.store || {}
    const sLat = s.latitude ?? null
    const sLng = s.longitude ?? null
    const distanceKm =
      sLat != null && sLng != null ? haversineKm(lat, lng, sLat, sLng) : null
    out.push({
      id: r.id,
      name: s.name || '—',
      address: s.full_address || '',
      city: s.city || '',
      country: s.country || '',
      website: s.website || null,
      phone: s.phone_number || null,
      lat: sLat,
      lng: sLng,
      distanceKm,
      types: s.store_types_pretty || r.store_types_pretty || [],
    })
  }
  // Keep within the KM radius the user asked for (API is miles-based).
  const filtered = out.filter((h) => h.distanceKm == null || h.distanceKm <= radiusKm + 0.05)
  filtered.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
  return filtered
}

export function mapsUrl(hit: StoreHit) {
  if (hit.lat != null && hit.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${hit.lat},${hit.lng}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hit.address || hit.name)}`
}

/** Unused but kept for typing / future; fetchJson path uses window.riftbound. */
export type _FetchJson = FetchJson
