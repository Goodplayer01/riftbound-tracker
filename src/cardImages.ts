/**
 * Card image sources.
 *
 * Grids use the small WebP thumbnails baked into public/thumbs/ (Release
 * workflow, scripts/bake_thumbs.py), so they render straight from disk.
 * Full-size art goes through the Electron main process (rbimg://), which keeps
 * a disk cache, so every original is downloaded only once. In a plain browser
 * (vite dev without Electron) both fall back to the remote URL.
 */

type CardLike = { id: string; image?: string | null }

/** source image URL -> thumbnail URL (index.json maps card id -> the URL its thumbnail was made from) */
const thumbByImage = new Map<string, string>()

const inElectron = typeof window !== 'undefined' && !!window.riftbound

/** Load public/thumbs/index.json. Call before the first grid renders; never rejects. */
export async function loadThumbIndex(): Promise<void> {
  try {
    const r = await fetch(new URL('thumbs/index.json', window.location.href))
    if (!r.ok) return
    const data = (await r.json()) as { byId?: Record<string, string> }
    if (!data?.byId) return
    for (const [id, src] of Object.entries(data.byId)) {
      thumbByImage.set(src, new URL(`thumbs/${id}.webp`, window.location.href).href)
    }
  } catch {
    /* no thumbnails (dev build): grids use the full art */
  }
}

/** Full-size art URL, served from the disk cache inside Electron. */
export function cardArt(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (!inElectron || !/^https:\/\//i.test(url)) return url
  return `rbimg://card/?u=${encodeURIComponent(url)}`
}

/** Small image for a card image URL: the bundled thumbnail when there is one, else the full art. */
export function thumbForImage(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return thumbByImage.get(url) ?? cardArt(url)
}

/** Small grid image for a card. Keyed by image URL, so a re-baked image never shows a stale thumbnail. */
export function cardThumb(c: CardLike | null | undefined): string | undefined {
  return thumbForImage(c?.image)
}

const warmed = new Set<string>()

/** Start loading the full art (e.g. on hover) so the large view opens instantly. */
export function preloadArt(url: string | null | undefined) {
  const src = cardArt(url)
  if (!src || warmed.has(src)) return
  warmed.add(src)
  const img = new Image()
  img.decoding = 'async'
  img.src = src
}

/** CSS background with the thumbnail underneath, so the full art paints over it once loaded. */
export function layeredArtBackground(c: CardLike | null | undefined): string | undefined {
  const full = cardArt(c?.image)
  const thumb = cardThumb(c)
  if (!full) return undefined
  return thumb && thumb !== full ? `url("${full}"), url("${thumb}")` : `url("${full}")`
}
