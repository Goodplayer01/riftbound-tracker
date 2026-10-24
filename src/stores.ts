/** Riftbound stores near a place, from the official event search on playriftbound.com/events
 *  (every store that runs upcoming events, with its events and contact details). If that search
 *  fails, the older UVS / Spicerack retailer list is used instead. Online stock only from a real
 *  Shopify suggest.json hit whose title contains "riftbound" (available flag); no quantities. */

export const RIFTBOUND_GAME_ID = 3
export const STORE_LOCATOR_URL = 'https://playriftbound.com/de-DE/events/'

/** Entry fee as text, or null when the event is free (no fee, or 0). Uses the currency's own number of
 *  decimals (JPY has none); an unknown currency code never throws, it falls back to "12.50 XYZ". */
export function formatEntryFee(feeMinor: number | null, currency: string | null, locale: string): string | null {
  if (feeMinor == null || feeMinor <= 0) return null
  if (!currency) return (feeMinor / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  try {
    const nf = new Intl.NumberFormat(locale, { style: 'currency', currency })
    return nf.format(feeMinor / 10 ** (nf.resolvedOptions().maximumFractionDigits ?? 2))
  } catch {
    return `${(feeMinor / 100).toFixed(2)} ${currency}`
  }
}

/** Link to one event on the official events page. */
export function eventUrl(id: string, lang: 'de' | 'en') {
  return `https://playriftbound.com/${lang === 'de' ? 'de-DE' : 'en-US'}/events/${encodeURIComponent(id)}`
}
const STORES_API = 'https://api.riftbound.uvsgames.com/api/v2/game-stores/'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** UI / filter radius limits (km). UVS API still takes miles — we convert. */
export const STORE_RADIUS_KM_MIN = 1
export const STORE_RADIUS_KM_MAX = 250
export const STORE_RADIUS_KM_DEFAULT = 50

export type GeoPoint = { lat: number; lng: number; label: string }

/** Real online listing. `available` is the shop's boolean, never a guessed count. */
export type StoreProduct = {
  name: string
  available: boolean
}

export type StoreHit = {
  id: string
  name: string
  address: string
  city: string
  country: string
  website: string | null
  phone: string | null
  email: string | null
  lat: number | null
  lng: number | null
  distanceKm: number | null
  types: string[]
  /** null = no real source. Non empty = Shopify titles that matched. */
  products: StoreProduct[] | null
  /** Upcoming events of this store, soonest first (empty when the result came from the UVS fallback). */
  events: StoreEvent[]
}

/** One upcoming event from the official event search. */
export type StoreEvent = {
  id: string
  name: string
  startsAt: string
  /** e.g. NEXUS_NIGHT, SUMMONER_SKIRMISH */
  type: string | null
  /** Entry fee in the smallest unit (cents), null when free or unknown. */
  feeMinor: number | null
  currency: string | null
  registered: number
  capacity: number | null
}


async function fetchJson(url: string): Promise<unknown> {
  if (typeof window !== 'undefined' && window.riftbound?.fetchJson) {
    const res = await window.riftbound.fetchJson(url)
    if (!res.ok) throw new Error(res.error || 'fetch failed')
    return res.data
  }
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

function textOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s || null
}

const SKIP_SHOP = /(^|\.)(instagram|facebook|fb|tiktok|linktr)\.[a-z.]+$|^(wa|t)\.me$/i

function shopOrigin(website: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
    if (u.protocol !== 'https:') return null
    if (SKIP_SHOP.test(u.hostname)) return null
    return u.origin
  } catch {
    return null
  }
}

/** Shopify predictive search. null if the shop does not serve that JSON. */
async function shopifyRiftbound(website: string): Promise<StoreProduct[] | null> {
  const origin = shopOrigin(website)
  if (!origin) return null
  const params = new URLSearchParams({
    q: 'riftbound',
    'resources[type]': 'product',
    'resources[limit]': '10',
    'resources[options][unavailable_products]': 'last',
    'resources[options][fields]': 'title',
  })
  let data: {
    resources?: { results?: { products?: Array<{ title?: string; available?: unknown }> } }
  }
  try {
    data = (await fetchJson(`${origin}/search/suggest.json?${params}`)) as typeof data
  } catch {
    return null
  }
  const products = data?.resources?.results?.products
  if (!Array.isArray(products)) return null
  const out: StoreProduct[] = []
  const seen = new Set<string>()
  for (const p of products) {
    const name = textOrNull(p?.title)
    if (!name || !/riftbound/i.test(name)) continue
    if (typeof p.available !== 'boolean') continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, available: p.available })
  }
  out.sort((a, b) => Number(b.available) - Number(a.available))
  return out.length ? out : null
}

async function withProducts(hits: StoreHit[]): Promise<StoreHit[]> {
  const out = hits.slice()
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, hits.length) }, async () => {
    while (cursor < hits.length) {
      const i = cursor++
      const products = hits[i].website ? await shopifyRiftbound(hits[i].website!) : null
      if (products) out[i] = { ...hits[i], products }
    }
  })
  await Promise.all(workers)
  return out
}

type StoreRow = {
  id: string
  store?: {
    name?: string
    full_address?: string
    city?: string
    country?: string
    website?: string | null
    phone_number?: string | null
    preferred_contact_phone?: string | null
    email?: string | null
    preferred_contact_email?: string | null
    latitude?: number | null
    longitude?: number | null
    store_types_pretty?: string[]
  }
  store_types_pretty?: string[]
}

/** Geographic center of Germany. Cover radius reaches the borders, not the slider. */
export const GERMANY_CENTER = { lat: 51.1657, lng: 10.4515 }
const GERMANY_COVER_KM = 650

export function isGermanCountry(country: string) {
  const c = country.trim().toUpperCase()
  return c === 'DE' || c === 'DEU' || c === 'GERMANY' || c === 'DEUTSCHLAND'
}

/** True only when Shopify returned a Riftbound title with available === true. */
export function storeReportsStock(hit: StoreHit) {
  return !!hit.products?.some((p) => p.available === true)
}

function rowToHit(r: StoreRow, originLat: number, originLng: number): StoreHit {
  const s = r.store || {}
  const sLat = s.latitude ?? null
  const sLng = s.longitude ?? null
  const distanceKm =
    sLat != null && sLng != null ? haversineKm(originLat, originLng, sLat, sLng) : null
  return {
    id: r.id,
    name: s.name || 'Store',
    address: s.full_address || '',
    city: s.city || '',
    country: s.country || '',
    website: textOrNull(s.website),
    phone: textOrNull(s.preferred_contact_phone) || textOrNull(s.phone_number),
    email: textOrNull(s.preferred_contact_email) || textOrNull(s.email),
    lat: sLat,
    lng: sLng,
    distanceKm,
    types: s.store_types_pretty || r.store_types_pretty || [],
    products: null,
    events: [],
  }
}

type StorePage = { results?: StoreRow[]; next_page_number?: number | null }

async function fetchStorePage(lat: number, lng: number, radiusKm: number, page: number, pageSize: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    num_miles: String(kmToApiMiles(radiusKm)),
    page: String(page),
    page_size: String(pageSize),
    game_id: String(RIFTBOUND_GAME_ID),
  })
  return (await fetchJson(`${STORES_API}?${params}`)) as StorePage
}

/** UVS retailer list near a point (fallback when the event search fails). */
async function uvsStoresNear(lat: number, lng: number, radiusKm: number, pageSize = 40): Promise<StoreHit[]> {
  const data = await fetchStorePage(lat, lng, radiusKm, 1, pageSize)
  const out = (data.results || []).map((r) => rowToHit(r, lat, lng))
  const filtered = out.filter((h) => h.distanceKm == null || h.distanceKm <= radiusKm + 0.05)
  filtered.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
  return filtered
}

// ---- Official event search (playriftbound.com/events) ----

type EventLocation = { city?: string | null; formattedAddress?: string | null; latitude?: number | null; longitude?: number | null }
/** One edge of competeTournamentSearch, only the fields used here. */
export type EventEdge = {
  node?: {
    organizer?: { id?: string; name?: string } | null
    tournament?: {
      id?: string
      name?: string
      startsAt?: string
      tournamentLocation?: EventLocation | null
      entryFee?: { currency?: string; minorUnits?: number } | null
      registrantCounts?: { status?: string; count?: number }[] | null
      config?: { tournamentType?: string; participantCapacity?: number } | null
    } | null
  } | null
}

/** Groups event search results into one store per organizer, nearest first, events soonest first. */
export function eventsToStores(edges: EventEdge[], originLat: number, originLng: number): StoreHit[] {
  const byOrg = new Map<string, StoreHit>()
  for (const e of edges) {
    const org = e.node?.organizer
    const tr = e.node?.tournament
    if (!org?.id || !tr?.id) continue
    const loc = tr.tournamentLocation || {}
    let hit = byOrg.get(org.id)
    if (!hit) {
      const lat = typeof loc.latitude === 'number' ? loc.latitude : null
      const lng = typeof loc.longitude === 'number' ? loc.longitude : null
      hit = {
        id: org.id,
        name: org.name || 'Store',
        address: loc.formattedAddress || '',
        city: loc.city || '',
        country: '',
        website: null,
        phone: null,
        email: null,
        lat,
        lng,
        distanceKm: lat != null && lng != null ? haversineKm(originLat, originLng, lat, lng) : null,
        types: [],
        products: null,
        events: [],
      }
      byOrg.set(org.id, hit)
    }
    if (hit.events.some((x) => x.id === tr.id)) continue
    hit.events.push({
      id: tr.id,
      name: tr.name || '',
      startsAt: tr.startsAt || '',
      type: tr.config?.tournamentType || null,
      feeMinor: tr.entryFee?.minorUnits ?? null,
      currency: tr.entryFee?.currency ?? null,
      registered: (tr.registrantCounts || []).filter((r) => r.status === 'REGISTERED').reduce((s, r) => s + (r.count || 0), 0),
      capacity: tr.config?.participantCapacity ?? null,
    })
  }
  const out = [...byOrg.values()]
  for (const h of out) h.events.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
  return out
}

async function rbEvents(req: Parameters<NonNullable<Window['riftbound']>['rbEvents']>[0]): Promise<unknown> {
  const api = typeof window !== 'undefined' ? window.riftbound?.rbEvents : undefined
  if (!api) throw new Error('event search needs the desktop app')
  const res = await api(req)
  if (!res.ok) throw new Error(res.error || 'event search failed')
  return res.data
}

/** Result of a store search. `truncated`: not every event could be loaded (page cap or a later page
 *  failed), so stores may be missing. `source`: where the list came from. */
export type StoreSearch = { hits: StoreHit[]; truncated: boolean; source: 'events' | 'uvs' }

/** Event search pages within the radius (50 events a page, at most `maxPages`). Only a failing first
 *  page throws; a later failure keeps what was loaded and reports the list as truncated. */
async function searchEvents(lat: number, lng: number, radiusKm: number, maxPages: number): Promise<{ edges: EventEdge[]; truncated: boolean }> {
  const edges: EventEdge[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page++) {
    let data: { competeTournamentSearch?: { edges?: EventEdge[]; pageInfo?: { endCursor?: string | null; hasNextPage?: boolean } } }
    try {
      data = (await rbEvents({ op: 'search', lat, lng, distanceMeters: radiusKm * 1000, after })) as typeof data
    } catch (e) {
      if (page === 0) throw e
      return { edges, truncated: true }
    }
    const conn = data?.competeTournamentSearch
    edges.push(...(conn?.edges || []))
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) return { edges, truncated: false }
    after = conn.pageInfo.endCursor
  }
  return { edges, truncated: true }
}

type OrganizerContact = { email: string | null; website: string | null; phone: string | null; address: string | null; lat: number | null; lng: number | null }
/** Organizer profiles hardly change: one lookup per store and app session. */
const contactCache = new Map<string, OrganizerContact>()

async function organizerContact(id: string): Promise<OrganizerContact> {
  const cached = contactCache.get(id)
  if (cached) return cached
  const d = (await rbEvents({ op: 'organizer', id })) as {
    organizerSummary?: {
      email?: string | null
      website?: string | null
      phone?: { countryDialingCode?: string; number?: string } | null
      physicalAddress?: EventLocation | null
    } | null
  }
  const o = d?.organizerSummary
  const a = o?.physicalAddress
  const c: OrganizerContact = {
    email: textOrNull(o?.email),
    website: textOrNull(o?.website),
    phone: o?.phone?.number ? `${o.phone.countryDialingCode || ''} ${o.phone.number}`.trim() : null,
    address: textOrNull(a?.formattedAddress),
    lat: typeof a?.latitude === 'number' ? a.latitude : null,
    lng: typeof a?.longitude === 'number' ? a.longitude : null,
  }
  contactCache.set(id, c)
  return c
}

/** Contact details and the store's own address and position (not the first event's venue) from its
 *  organizer profile. When no profile loads at all (e.g. that query changed), `uvsFallback` supplies
 *  phone, e-mail and website from the UVS list, matched by name or a position within 300 m. */
async function withContacts(
  hits: StoreHit[],
  origin: { lat: number; lng: number },
  uvsFallback: () => Promise<StoreHit[]>,
): Promise<StoreHit[]> {
  const out = hits.slice()
  let loaded = 0
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, hits.length) }, async () => {
    while (cursor < hits.length) {
      const i = cursor++
      try {
        const c = await organizerContact(hits[i].id)
        loaded++
        const lat = c.lat ?? hits[i].lat
        const lng = c.lng ?? hits[i].lng
        out[i] = {
          ...hits[i],
          email: c.email,
          website: c.website,
          phone: c.phone,
          address: c.address || hits[i].address,
          lat,
          lng,
          distanceKm: lat != null && lng != null ? haversineKm(origin.lat, origin.lng, lat, lng) : hits[i].distanceKm,
        }
      } catch {
        // One missing profile: the store still shows with its events.
      }
    }
  })
  await Promise.all(workers)
  if (hits.length && loaded === 0) {
    try {
      const uvs = await uvsFallback()
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      for (let i = 0; i < out.length; i++) {
        const h = out[i]
        const m = uvs.find((u) => (norm(u.name) && norm(u.name) === norm(h.name))
          || (u.lat != null && u.lng != null && h.lat != null && h.lng != null && haversineKm(u.lat, u.lng, h.lat, h.lng) < 0.3))
        if (m) out[i] = { ...h, phone: m.phone, email: m.email, website: m.website }
      }
    } catch {
      // No contact source reachable: stores and events still show.
    }
  }
  out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
  return out
}

/** Event search page cap per circle: 50 events a page, so up to 1000 events in one circle. */
const MAX_PAGES = 20

/** The event search answers at most ~160 km (100 miles) around a point, a larger distance returns the
 *  same events. Bigger areas are covered by several circles of this size. */
export const EVENT_SEARCH_MAX_KM = 160

function offsetPoint(lat: number, lng: number, northKm: number, eastKm: number) {
  return { lat: lat + northKm / 111.32, lng: lng + eastKm / (111.32 * Math.cos((lat * Math.PI) / 180)) }
}

/** Search circles for a radius around a point: one circle up to 160 km, else a 3×3 grid 180 km apart,
 *  so every spot within 250 km is inside a circle. */
export function searchCircles(lat: number, lng: number, radiusKm: number) {
  if (radiusKm <= EVENT_SEARCH_MAX_KM) return [{ lat, lng }]
  const out: { lat: number; lng: number }[] = []
  for (const n of [-180, 0, 180]) for (const e of [-180, 0, 180]) out.push(offsetPoint(lat, lng, n, e))
  return out
}

/** 5×4 grid over Germany, about 180 km apart: every German spot is within ~130 km of a circle center. */
export const GERMANY_CIRCLES = [47.8, 49.4, 51.0, 52.6, 54.2].flatMap((lat) => [6.8, 9.4, 12.0, 14.6].map((lng) => ({ lat, lng })))

/** Runs the event search for each circle (3 at a time), events once each even where circles overlap.
 *  Only throws when no circle answers at all; a failing circle marks the result as truncated. */
async function searchEventCircles(circles: { lat: number; lng: number }[], radiusKm: number) {
  const seen = new Set<string>()
  const edges: EventEdge[] = []
  let truncated = false
  let answered = 0
  let lastError: unknown
  let cursor = 0
  const workers = Array.from({ length: Math.min(3, circles.length) }, async () => {
    while (cursor < circles.length) {
      const c = circles[cursor++]
      try {
        const r = await searchEvents(c.lat, c.lng, Math.min(radiusKm, EVENT_SEARCH_MAX_KM), MAX_PAGES)
        answered++
        truncated ||= r.truncated
        for (const e of r.edges) {
          const id = e.node?.tournament?.id
          if (!id || seen.has(id)) continue
          seen.add(id)
          edges.push(e)
        }
      } catch (e) {
        lastError = e
        truncated = true
      }
    }
  })
  await Promise.all(workers)
  if (!answered) throw lastError ?? new Error('event search failed')
  return { edges, truncated }
}

/**
 * Riftbound stores with upcoming events near a point, from the official event search.
 * Falls back to the UVS retailer list when the event search is not reachable.
 * @param radiusKm user-facing radius in kilometres.
 */
export async function searchStoresNear(
  lat: number,
  lng: number,
  radiusKm = STORE_RADIUS_KM_DEFAULT,
): Promise<StoreSearch> {
  try {
    const { edges, truncated } = await searchEventCircles(searchCircles(lat, lng, radiusKm), radiusKm)
    // Circles beyond the radius bring extra events; keep the ones inside it.
    const inside = edges.filter((e) => {
      const l = e.node?.tournament?.tournamentLocation
      return typeof l?.latitude !== 'number' || typeof l?.longitude !== 'number' || haversineKm(lat, lng, l.latitude, l.longitude) <= radiusKm + 0.05
    })
    const hits = await withContacts(eventsToStores(inside, lat, lng), { lat, lng }, () => uvsStoresNear(lat, lng, radiusKm))
    return { hits: await withProducts(hits), truncated, source: 'events' }
  } catch {
    return { hits: await withProducts(await uvsStoresNear(lat, lng, radiusKm)), truncated: false, source: 'uvs' }
  }
}

/** Rough box around Germany; neighbours inside it are caught by their country name in the address. */
const GERMANY_BOX = { south: 47.27, north: 55.06, west: 5.87, east: 15.04 }
// \b does not work next to letters like Ö, so word edges are "no letter" (Unicode) instead.
const NOT_GERMANY = /(?<!\p{L})(netherlands|nederland|belgium|belgi[eë]|belgique|poland|polska|czechia|czech republic|česko|austria|österreich|switzerland|schweiz|suisse|svizzera|denmark|danmark|france|luxembourg|luxemburg)(?!\p{L})/iu

/** Whether an event takes place in Germany: the address names Germany, or it names no neighbour and
 *  lies inside Germany's box (addresses without a country). */
export function isGermanEvent(loc: EventLocation | null | undefined) {
  const text = loc?.formattedAddress || ''
  if (/\b(germany|deutschland)\b/i.test(text)) return true
  if (NOT_GERMANY.test(text)) return false
  const lat = loc?.latitude
  const lng = loc?.longitude
  return typeof lat === 'number' && typeof lng === 'number'
    && lat >= GERMANY_BOX.south && lat <= GERMANY_BOX.north && lng >= GERMANY_BOX.west && lng <= GERMANY_BOX.east
}

/**
 * Every store in Germany with upcoming events (event search around the center of Germany, German
 * events only), sorted by distance to `sortOrigin` when given. Falls back to the UVS list, also when
 * the event search finds no German store at all.
 */
export async function searchStoresInGermany(
  sortOrigin?: { lat: number; lng: number },
): Promise<StoreSearch> {
  const origin = { lat: sortOrigin?.lat ?? GERMANY_CENTER.lat, lng: sortOrigin?.lng ?? GERMANY_CENTER.lng }
  try {
    const { edges, truncated } = await searchEventCircles(GERMANY_CIRCLES, EVENT_SEARCH_MAX_KM)
    const stores = eventsToStores(edges.filter((e) => isGermanEvent(e.node?.tournament?.tournamentLocation)), origin.lat, origin.lng)
    if (!stores.length) throw new Error('no German stores in the event search')
    const hits = await withContacts(stores, origin, () => uvsStoresInGermany(sortOrigin))
    return { hits: await withProducts(hits), truncated, source: 'events' }
  } catch {
    return { hits: await withProducts(await uvsStoresInGermany(sortOrigin)), truncated: false, source: 'uvs' }
  }
}

/**
 * Every UVS store whose country is Germany (fallback). Ignores the UI radius.
 * Distances and sort use `sortOrigin` when given (typed city), else Germany center.
 */
async function uvsStoresInGermany(
  sortOrigin?: { lat: number; lng: number },
): Promise<StoreHit[]> {
  const cover = GERMANY_CENTER
  const originLat = sortOrigin?.lat ?? cover.lat
  const originLng = sortOrigin?.lng ?? cover.lng
  const out: StoreHit[] = []
  const seen = new Set<string>()
  let page = 1
  for (let guard = 0; guard < 40; guard++) {
    const data = await fetchStorePage(cover.lat, cover.lng, GERMANY_COVER_KM, page, 100)
    const results = data.results || []
    for (const r of results) {
      const hit = rowToHit(r, originLat, originLng)
      if (!isGermanCountry(hit.country) || seen.has(hit.id)) continue
      seen.add(hit.id)
      out.push(hit)
    }
    const next = data.next_page_number
    if (!next || next === page || results.length === 0) break
    page = next
  }
  out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
  return out
}

export function mapsUrl(hit: StoreHit) {
  if (hit.lat != null && hit.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${hit.lat},${hit.lng}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hit.address || hit.name)}`
}

export function websiteUrl(raw: string) {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}
