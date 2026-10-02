/**
 * Offline card-art OCR for the enlarge lightbox (tesseract.js + bundled eng data).
 * Used only when catalog has no baked rulesText. Crops the lower text-box region
 * (avoids art), upscales, thresholds, filters low-confidence junk, caches in
 * memory + localStorage (cache key bumped when preprocessing changes).
 */

import { createWorker, PSM, type Worker } from 'tesseract.js'

const CACHE_KEY = 'riftbound-ocr-v2'
const CACHE_MAX = 250

/** Min mean word confidence (0–100) to accept a line. */
const LINE_CONF_MIN = 55
/** Overall mean confidence below this → treat as empty (show scan fallback). */
const OVERALL_CONF_MIN = 48
/** Reject if too many non-letter garbage characters. */
const JUNK_RATIO_MAX = 0.42

export type OcrResult = {
  text: string
  /** true when OCR ran but produced nothing useful / mostly junk */
  empty: boolean
  fromCache: boolean
  /** mean word confidence when freshly recognized (0–100); undefined if cached/failed */
  confidence?: number
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
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        // Prefer Latin rules-text glyphs; still allow brackets / punctuation used on cards.
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789[](){}.,;:'\"!?/+-&=% \n",
        preserve_interword_spaces: '1',
      })
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

/**
 * Crop lower rules-text box (start below art / type bar), mild adaptive threshold, 3× upscale.
 * y≈0.68 avoids pulling art/title junk into OCR (was 0.62 and caused garbled prefixes).
 */
function prepareTextBoxCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const x = Math.floor(w * 0.08)
  const y = Math.floor(h * 0.68)
  const cw = Math.max(1, Math.floor(w * 0.84))
  const ch = Math.max(1, Math.floor(h * 0.24))
  const scale = 3
  const canvas = document.createElement('canvas')
  canvas.width = cw * scale
  canvas.height = ch * scale
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, x, y, cw, ch, 0, 0, canvas.width, canvas.height)

  // Adaptive polarity threshold: dark badges (white glyphs) + light box (dark glyphs)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  const W = canvas.width
  const H = canvas.height
  const copy = new Uint8ClampedArray(data)
  const rad = 14
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
      const mean = sum / Math.max(1, n)
      const i = (py * W + px) * 4
      const lum = 0.299 * copy[i] + 0.587 * copy[i + 1] + 0.114 * copy[i + 2]
      let v: number
      if (mean < 125) {
        v = lum > mean + 14 ? 0 : 255
      } else {
        v = lum < mean - 14 ? 0 : 255
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

/** Drop lines that are mostly symbols / low letter content (OCR art junk). */
function isJunkLine(line: string): boolean {
  const s = line.trim()
  if (s.length < 2) return true
  const letters = (s.match(/[A-Za-z]/g) || []).length
  const alnum = (s.match(/[A-Za-z0-9]/g) || []).length
  if (letters === 0 && s.length > 2) return true
  if (s.length >= 4 && letters / s.length < 0.35) return true
  // Long runs of identical junk glyphs
  if (/(.)\1{5,}/.test(s)) return true
  const weird = (s.match(/[^A-Za-z0-9\[\](){}.,;:'"!?/+&\-=%\s]/g) || []).length
  if (s.length > 0 && weird / s.length > JUNK_RATIO_MAX) return true
  // Single-token gibberish with no vowels (common OCR noise)
  if (alnum >= 4 && letters === alnum && !/[aeiouAEIOU]/.test(s) && !/^\d+$/.test(s)) return true
  return false
}

type WordLike = { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }

function linesFromWords(words: WordLike[]): { text: string; conf: number }[] {
  if (!words.length) return []
  // Group by approximate y band
  const sorted = [...words].filter((w) => (w.text || '').trim()).sort((a, b) => {
    const ay = a.bbox?.y0 ?? 0
    const by = b.bbox?.y0 ?? 0
    if (Math.abs(ay - by) > 12) return ay - by
    return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0)
  })
  const lines: { parts: string[]; confs: number[] }[] = []
  let cur: { parts: string[]; confs: number[]; y: number } | null = null
  for (const w of sorted) {
    const t = (w.text || '').trim()
    if (!t) continue
    const y = w.bbox?.y0 ?? 0
    const conf = typeof w.confidence === 'number' ? w.confidence : 0
    if (!cur || Math.abs(y - cur.y) > 18) {
      cur = { parts: [t], confs: [conf], y }
      lines.push(cur)
    } else {
      cur.parts.push(t)
      cur.confs.push(conf)
      cur.y = (cur.y + y) / 2
    }
  }
  return lines.map((l) => {
    const conf = l.confs.length ? l.confs.reduce((a, b) => a + b, 0) / l.confs.length : 0
    return { text: l.parts.join(' '), conf }
  })
}

function filterRecognized(
  data: { text?: string; confidence?: number; words?: WordLike[] },
): { text: string; confidence: number; empty: boolean } {
  const words = (data.words || []) as WordLike[]
  const lineObjs = linesFromWords(words)
  const kept: string[] = []
  const confs: number[] = []
  for (const line of lineObjs) {
    if (line.conf < LINE_CONF_MIN) continue
    const cleaned = cleanOcrText(line.text)
    if (!cleaned || isJunkLine(cleaned)) continue
    kept.push(cleaned)
    confs.push(line.conf)
  }
  let text = kept.join('\n').trim()
  // Fallback to raw text cleaning if word boxes missing
  if (!text && data.text) {
    text = cleanOcrText(data.text)
      .split('\n')
      .filter((l) => !isJunkLine(l))
      .join('\n')
      .trim()
  }
  const confidence =
    confs.length > 0
      ? confs.reduce((a, b) => a + b, 0) / confs.length
      : typeof data.confidence === 'number'
        ? data.confidence
        : 0

  if (!text) return { text: '', confidence, empty: true }
  if (confidence > 0 && confidence < OVERALL_CONF_MIN) {
    return { text: '', confidence, empty: true }
  }
  // Final junk ratio on whole block
  const letters = (text.match(/[A-Za-z]/g) || []).length
  if (text.length >= 8 && letters / text.length < 0.4) {
    return { text: '', confidence, empty: true }
  }
  return { text, confidence, empty: false }
}

/**
 * OCR rules text from a card art URL. Cached by cardId.
 * Returns empty text (empty:true) on failure / low confidence — caller shows scan fallback.
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
    const filtered = filterRecognized(data as { text?: string; confidence?: number; words?: WordLike[] })
    setCached(cardId, filtered.text)
    return {
      text: filtered.text,
      empty: filtered.empty,
      fromCache: false,
      confidence: filtered.confidence,
    }
  } catch {
    setCached(cardId, '')
    return { text: '', empty: true, fromCache: false }
  }
}
