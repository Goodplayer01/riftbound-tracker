import { unitEur } from './copies'
import type { PriceBook, PriceEntry } from './types'

/** public/price-history.json, written by scripts/bake_price_history.py.
 *  Prices are euro cents, 0 = no price; ids[i] belongs to n[i] / f[i] of every point. */
export type PriceHistoryFile = {
  updatedAt: string
  ids: string[]
  points: { at: string; n: number[]; f: number[] }[]
}

/** One snapshot as unit prices in EUR per card id (missing = no price). */
export type PricePoint = { at: string; n: Record<string, number>; f: Record<string, number> }

const REMOTE_HISTORY_URL = 'https://raw.githubusercontent.com/Goodplayer01/riftbound-tracker/main/public/price-history.json'
const REMOTE_TIMEOUT_MS = 15000

function isHistory(x: unknown): x is PriceHistoryFile {
  const h = x as PriceHistoryFile
  return !!h && Array.isArray(h.ids) && Array.isArray(h.points)
}

async function getJson(url: string | URL, init?: RequestInit) {
  const r = await fetch(url, init)
  if (!r.ok) return null
  const data = await r.json()
  return isHistory(data) ? data : null
}

/** Live copy from main, the bundled file when offline. */
export async function loadPriceHistory(): Promise<PriceHistoryFile | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS)
  try {
    const remote = await getJson(REMOTE_HISTORY_URL, { cache: 'no-cache', signal: ctrl.signal })
    if (remote) return remote
  } catch {
    // offline: fall through to the bundled copy
  } finally {
    clearTimeout(timer)
  }
  try {
    return await getJson(new URL('price-history.json', window.location.href))
  } catch {
    return null
  }
}

/** Same unit prices as the collection value (low, else trend; foil falls back to normal). */
export function unitPrices(p: PriceEntry) {
  return { n: unitEur(p, false), f: unitEur(p, true) }
}

/** History points oldest first, plus the loaded price book when it is newer than the last point. */
export function historyPoints(file: PriceHistoryFile | null, book: PriceBook | null): PricePoint[] {
  const out: PricePoint[] = []
  for (const p of file?.points ?? []) {
    const n: Record<string, number> = {}
    const f: Record<string, number> = {}
    file!.ids.forEach((id, i) => {
      if (p.n[i] > 0) n[id] = p.n[i] / 100
      if (p.f[i] > 0) f[id] = p.f[i] / 100
    })
    out.push({ at: p.at, n, f })
  }
  const last = out[out.length - 1]
  if (book && (!last || Date.parse(book.updatedAt) > Date.parse(last.at))) {
    const n: Record<string, number> = {}
    const f: Record<string, number> = {}
    for (const [id, entry] of Object.entries(book.cards)) {
      const u = unitPrices(entry)
      if (u.n != null && u.n > 0) n[id] = u.n
      if (u.f != null && u.f > 0) f[id] = u.f
    }
    // Same day as the last point: the newer book replaces it.
    if (last && last.at.slice(0, 10) === book.updatedAt.slice(0, 10)) out.pop()
    out.push({ at: book.updatedAt, n, f })
  }
  return out
}

/** What the given copies were worth at one point. */
export function valueAt(point: PricePoint, owned: Record<string, { qty?: number; foil?: number }>) {
  let sum = 0
  for (const [id, o] of Object.entries(owned)) {
    const qty = o.qty || 0
    const foil = o.foil || 0
    const n = point.n[id]
    const f = point.f[id] ?? n
    if (qty > 0 && n != null) sum += qty * n
    if (foil > 0 && f != null) sum += foil * f
  }
  return sum
}
