import type { PriceBook } from './types'

/** Live prices: public/prices.json on main. Pushing a fresh bake to main
 *  updates every installed app on next start, no release needed.
 *  raw.githubusercontent.com sends Access-Control-Allow-Origin: *, so the
 *  file:// renderer can fetch it directly. */
const REMOTE_PRICES_URL = 'https://raw.githubusercontent.com/Goodplayer01/riftbound-tracker/main/public/prices.json'
const REMOTE_TIMEOUT_MS = 10000

/** Last good remote download, so offline starts keep the newer prices. */
const CACHE_KEY = 'rb.prices.remote.v1'

function isPriceBook(x: unknown): x is PriceBook {
  const b = x as PriceBook
  return !!b && typeof b === 'object' && typeof b.updatedAt === 'string'
    && !!b.cards && typeof b.cards === 'object' && Object.keys(b.cards).length > 0
}

function time(b: PriceBook | null) {
  const t = b ? Date.parse(b.updatedAt) : NaN
  return Number.isNaN(t) ? 0 : t
}

/** Newer updatedAt wins; ties keep `a`. */
export function newerPriceBook(a: PriceBook | null, b: PriceBook | null) {
  if (!a) return b
  if (!b) return a
  return time(b) > time(a) ? b : a
}

export function loadCachedPrices(): PriceBook | null {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return isPriceBook(data) ? data : null
  } catch {
    return null
  }
}

function saveCachedPrices(b: PriceBook) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(b))
  } catch {
    // Quota full: skip the cache, prices still apply for this session.
  }
}

export async function loadBundledPrices(): Promise<PriceBook | null> {
  try {
    const r = await fetch(new URL('prices.json', window.location.href))
    if (!r.ok) return null
    const data = await r.json()
    return isPriceBook(data) ? data : null
  } catch {
    return null
  }
}

export async function fetchRemotePrices(): Promise<PriceBook | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS)
  try {
    const r = await fetch(REMOTE_PRICES_URL, { cache: 'no-cache', signal: ctrl.signal })
    if (!r.ok) return null
    const data = await r.json()
    if (!isPriceBook(data)) return null
    saveCachedPrices(data)
    return data
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
