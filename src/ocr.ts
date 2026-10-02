/**
 * Offline card-art OCR for the enlarge lightbox (tesseract.js + bundled eng data).
 * Crops the lower text-box region, upscales, and caches results in memory + localStorage.
 */

import { createWorker, PSM, type Worker } from 'tesseract.js'

const CACHE_KEY = 'riftbound-ocr-v1'
const CACHE_MAX = 250

export type OcrResult = {
  text: string
  /** true when OCR ran but produced nothing useful */
  empty: boolean
  fromCache: boolean
}

type CacheMap = Record<string, string>

const memory = new Map<string, string>()
let workerPromise: Promise<Worker> | null = null
let workerFailed = false

function publicOcrAsset(rel: string) {
  return new URL(`ocr/${rel}`, window.location.href).href
}

function loadDiskCache(): CacheMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CacheMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveDiskCache(map: CacheMap) {
  try {
    const keys = Object.keys(map)
    if (keys.length > CACHE_MAX) {
      for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete map[k]
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode — memory cache still works */
  }
}

function getCached(cardId: string): string | null {
  if (memory.has(cardId)) return memory.get(cardId)!
  const disk = loadDiskCache()
  const hit = disk[cardId]
  if (typeof hit === 'string') {
    memory.set(cardId, hit)
    return hit
  }
  return null
}

function setCached(cardId: string, text: string) {
  memory.set(cardId, text)
  const disk = loadDiskCache()
  disk[cardId] = text
  saveDiskCache(disk)
}

async function getWorker(): Promise<Worker> {
  if (workerFailed) throw new Error('OCR worker unavailable')
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        workerPath: publicOcrAsset('worker.min.js'),
        langPath: publicOcrAsset('').replace(/\/$/, ''),
        corePath: publicOcrAsset('tesseract-core-simd-lstm.wasm.js'),
        gzip: true,
        logger: () => {},
      })
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
      return worker
    })().catch((err) => {
      workerFailed = true
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/** Allowlist for Electron main-process image fetch (CORS bypass). */
export function isOcrImageHost(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname
    return (
      h === 'cmsassets.rgpub.io' ||
      h.endsWith('.rgpub.io') ||
      h === 'cdn.piltoverarchive.com' ||
      h.endsWith('.piltoverarchive.com')
    )
  } catch {
    return false
  }
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  // Prefer main-process fetch to avoid CDN CORS tainting canvas in Electron.
  let resolved = src
  try {
    if (window.riftbound?.fetchImageDataUrl && isOcrImageHost(src)) {
      const res = await window.riftbound.fetchImageDataUrl(src)
      if (res.ok && res.dataUrl) resolved = res.dataUrl
    }
  } catch {
    /* fall through to direct Image load */
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    // data: URLs must not set crossOrigin
    if (!resolved.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.src = resolved
  })
}

/** Crop lower text box, mild contrast, 2× upscale → canvas for tesseract. */
function prepareTextBoxCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const x = Math.floor(w * 0.07)
  const y = Math.floor(h * 0.62)
  const cw = Math.max(1, Math.floor(w * 0.86))
  const ch = Math.max(1, Math.floor(h * 0.28))
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = cw * scale
  canvas.height = ch * scale
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, x, y, cw, ch, 0, 0, canvas.width, canvas.height)

  // Adaptive polarity threshold: dark badges (white glyphs) + light box (dark glyphs)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  const W = canvas.width
  const H = canvas.height
  const copy = new Uint8ClampedArray(data)
  const rad = 12
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let sum = 0
      let n = 0
      for (let dy = -rad; dy <= rad; dy += 3) {
        for (let dx = -rad; dx <= rad; dx += 3) {
          const yy = py + dy
          const xx = px + dx
          if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue
          const i = (yy * W + xx) * 4
          sum += 0.299 * copy[i] + 0.587 * copy[i + 1] + 0.114 * copy[i + 2]
          n++
        }
      }
      const mean = sum / n
      const i = (py * W + px) * 4
      const lum = 0.299 * copy[i] + 0.587 * copy[i + 1] + 0.114 * copy[i + 2]
      let v: number
      if (mean < 125) {
        v = lum > mean + 16 ? 0 : 255
      } else {
        v = lum < mean - 16 ? 0 : 255
      }
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

function cleanOcrText(raw: string): string {
  return raw
    .replace(/\u000c/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim()
}

/**
 * OCR rules text from a card art URL. Cached by cardId.
 * Returns empty text (empty:true) on failure — caller shows fallback.
 */
export async function ocrCardText(cardId: string, imageUrl: string | null | undefined): Promise<OcrResult> {
  if (!imageUrl) return { text: '', empty: true, fromCache: false }

  const cached = getCached(cardId)
  if (cached != null) {
    return { text: cached, empty: cached.length === 0, fromCache: true }
  }

  try {
    const img = await loadImageElement(imageUrl)
    const canvas = prepareTextBoxCanvas(img)
    const worker = await getWorker()
    const { data } = await worker.recognize(canvas)
    const text = cleanOcrText(data.text || '')
    setCached(cardId, text)
    return { text, empty: text.length === 0, fromCache: false }
  } catch {
    setCached(cardId, '')
    return { text: '', empty: true, fromCache: false }
  }
}
