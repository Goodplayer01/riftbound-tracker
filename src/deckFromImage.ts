import type { Card } from './types'
import { cardKey, displayCardName, printScore, SECTION_LABEL } from './deckHelpers.ts'
import { drawQtyBadge, loadUrl, RUNE_QTY_FONT, SHARE_BG, SHARE_LAYOUT } from './deckScreenshot.ts'
import { resolveToken } from './parseBulk.ts'

/**
 * Reads a deck back from the app's own share image (deckScreenshot.ts), also from a scaled or recompressed
 * copy: finds the card tiles, names each one by comparing it with the card images, reads the ×n badges and
 * the rune counts, and returns a deck list for the text import.
 */

export type Img = { width: number; height: number; data: Uint8ClampedArray }
export type Rect = { x: number; y: number; w: number; h: number }

/** The canvas and the card borders are near black; card faces, text and icons are brighter. */
const lit = (d: Uint8ClampedArray, i: number) => d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60
/** The amber of the copy badges. */
const amber = (d: Uint8ClampedArray, i: number) => d[i] > 190 && d[i + 1] > 110 && d[i + 1] < 205 && d[i + 2] < 110

/** Part of a card's width that is lit, the face inside its black border: the median over the card images
 *  (0.91 to 1 depending on the print), so only good for a first guess. */
const FACE = { x: 0.955, right: 0.006 }
const CARD_ASPECT = 744 / 1039
/** Share layout: space between two grid cards, and between the left column and the grid. */
const CARD_GAP = 8
const GRID_GAP = 24

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]

/** Sorted values that lie within tol of their neighbour become one centre each. */
function centres(vals: number[], tol: number): number[] {
  const groups: number[][] = []
  for (const v of [...vals].sort((a, b) => a - b)) {
    const g = groups[groups.length - 1]
    if (g && v - g[g.length - 1] <= tol) g.push(v)
    else groups.push([v])
  }
  return groups.map(median)
}

export type Layout = {
  /** Full tile rects in image pixels. */
  legend: Rect | null
  battlefields: Rect[]
  /** Grid rows top to bottom, each left to right. */
  rows: Rect[][]
  /** Index of the first sideboard row (rows.length without a sideboard). */
  sideRow: number
  /** Image pixels per logical pixel of the share layout. */
  scale: number
}

export function findLayout(img: Img): Layout | null {
  // About one cell per logical pixel, so the gaps between tiles stay several cells wide.
  const k = Math.max(1, Math.round(img.width / 1400))
  const gw = Math.floor(img.width / k)
  const gh = Math.floor(img.height / k)
  const on = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0
      for (let y = gy * k; y < gy * k + k; y++) for (let x = gx * k; x < gx * k + k; x++) if (lit(img.data, (y * img.width + x) * 4)) n++
      if (n * 2 >= k * k) on[gy * gw + gx] = 1
    }
  }
  // Connected blobs of lit cells. Card faces are solid; text, icons and the amber print frames are not.
  const seen = new Uint8Array(gw * gh)
  const stack: number[] = []
  const blobs: (Rect & { n: number })[] = []
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, n = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % gw
      const y = (i - x) / gw
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, i - gw, i + gw]) {
        if (j >= 0 && j < on.length && on[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    blobs.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n })
  }
  const solid = blobs.filter((b) => b.w >= gw / 40 && b.n >= 0.45 * b.w * b.h)
  const portrait = solid.filter((b) => b.w / b.h > 0.6 && b.w / b.h < 0.82).sort((a, b) => b.w * b.h - a.w * a.h)
  if (!portrait.length) return null

  // The Legend is the one tile clearly bigger than the grid cards.
  const rest = portrait.slice(1)
  const legend = !rest.length || portrait[0].w * portrait[0].h >= 1.6 * median(rest.map((b) => b.w * b.h)) ? portrait[0] : null
  const left = legend ? legend.x + legend.w : 0
  const cards = (legend ? rest : portrait).filter((b) => b.x >= left)
  const mw = cards.length ? median(cards.map((b) => b.w)) : 0
  const mh = cards.length ? median(cards.map((b) => b.h)) : 0
  const good = cards.filter((b) => Math.abs(b.w - mw) <= 0.12 * mw && Math.abs(b.h - mh) <= 0.12 * mh)

  // The grid is a lattice: a dark or broken tile is found through its row and column.
  let cols = centres(good.map((b) => b.x + b.w / 2), mw / 2)
  const rowYs = centres(good.map((b) => b.y + b.h / 2), mh / 2)
  const filled = (cx: number, cy: number) => {
    const xa = Math.max(0, Math.round(cx - mw / 2)), xb = Math.min(gw, Math.round(cx + mw / 2))
    const ya = Math.max(0, Math.round(cy - mh / 2)), yb = Math.min(gh, Math.round(cy + mh / 2))
    if (xb - xa < mw * 0.9) return false
    let n = 0
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) n += on[y * gw + x]
    return n >= 0.25 * mw * mh
  }
  const pitch = cols.length > 1 ? Math.min(...cols.slice(1).map((c, i) => c - cols[i])) : 0
  if (pitch) {
    // Columns that no clean tile marked: gaps in between, then further out on both sides.
    const all: number[] = []
    cols.forEach((c, i) => {
      const steps = i ? Math.round((c - cols[i - 1]) / pitch) : 1
      for (let s = steps - 1; s > 0; s--) all.push(c - (s * (c - cols[i - 1])) / steps)
      all.push(c)
    })
    const any = (cx: number) => rowYs.some((cy) => filled(cx, cy))
    while (all[0] - pitch - mw / 2 >= left && any(all[0] - pitch)) all.unshift(all[0] - pitch)
    while (all[all.length - 1] + pitch + mw / 2 <= gw && any(all[all.length - 1] + pitch)) all.push(all[all.length - 1] + pitch)
    cols = all
  }
  if (!cols.length) return null

  // Card borders differ from print to print, so sizes come from the layout, not from a single lit face:
  // Legend centre to first column centre is leftW / 2 + 24 + card / 2, and a column step is card + 8.
  const L = SHARE_LAYOUT
  const rough = legend ? (legend.w * k) / FACE.x / L.leftW : (mw * k) / FACE.x / 110
  const exact = legend && pitch ? ((cols[0] - legend.x - legend.w / 2) * k - (pitch * k) / 2) / (L.leftW / 2 + GRID_GAP - CARD_GAP / 2) : rough
  const scale = Math.abs(exact / rough - 1) < 0.08 ? exact : rough
  const cardW = pitch ? pitch * k - CARD_GAP * scale : (mw * k) / FACE.x
  const cardH = cardW / CARD_ASPECT
  const centred = (cx: number, cy: number, w: number, h: number): Rect => ({ x: cx - w / 2, y: cy - h / 2, w, h })
  const rows = rowYs
    .map((cy) => cols.filter((cx) => filled(cx, cy)).map((cx) => centred(cx * k - FACE.right * cardW, cy * k, cardW, cardH)))
    .filter((r) => r.length)
  if (!rows.length) return null

  // The sideboard starts after its heading: 48 between the rows instead of 8.
  let sideRow = rows.length
  for (let i = rows.length - 1; i > 0; i--) if (rows[i][0].y - rows[i - 1][0].y - cardH > 28 * scale) sideRow = i

  const mid = legend ? (legend.x + legend.w / 2) * k : 0
  const inLeftColumn = (b: Rect) =>
    legend ? b.x + b.w / 2 > legend.x && b.x + b.w / 2 < left && b.y > legend.y + legend.h : b.x + b.w < cols[0] - mw / 2
  const battlefields = solid
    .filter((b) => b.w / b.h > 1.2 && b.w / b.h < 1.65 && inLeftColumn(b))
    .sort((a, b) => a.y - b.y)
    .map((b) => centred(legend ? mid : (b.x + b.w / 2) * k, (b.y + b.h / 2) * k, L.leftW * scale, L.leftW * CARD_ASPECT * scale))
  const legendTile = legend ? centred(mid, (legend.y + legend.h / 2) * k, L.leftW * scale, (L.leftW / CARD_ASPECT) * scale) : null
  return { legend: legendTile, battlefields, rows, sideRow, scale }
}

/** Bounding box of the pixels in r that pass the test, and how many there are. */
export function boxOf(img: Img, r: Rect, test: (d: Uint8ClampedArray, i: number) => boolean): (Rect & { n: number }) | null {
  const xa = Math.max(0, Math.round(r.x)), xb = Math.min(img.width, Math.round(r.x + r.w))
  const ya = Math.max(0, Math.round(r.y)), yb = Math.min(img.height, Math.round(r.y + r.h))
  let x0 = xb, y0 = yb, x1 = -1, y1 = -1, n = 0
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      if (!test(img.data, (y * img.width + x) * 4)) continue
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n } : null
}

/** Runs of columns in r that hold lit pixels, runs closer than gap joined (the "×" and digits of one count). */
export function litRuns(img: Img, r: Rect, gap: number): Rect[] {
  const out: Rect[] = []
  let from = -1
  let last = -1
  const close = () => {
    if (from < 0) return
    const b = boxOf(img, { x: from, y: r.y, w: last - from + 1, h: r.h }, lit)
    if (b) out.push(b)
    from = -1
  }
  for (let x = Math.max(0, Math.round(r.x)); x < Math.min(img.width, Math.round(r.x + r.w)); x++) {
    if (!boxOf(img, { x, y: r.y, w: 1, h: r.h }, lit)) continue
    if (from >= 0 && x - last > gap) close()
    if (from < 0) from = x
    last = x
  }
  close()
  return out
}

export type Tile = {
  card: Card
  /** Number on the amber badge, 0 without one. */
  badge: number
  /** How much the small "×2" of a framed print shows. */
  pill: number
}

/**
 * Copies per tile. Prints of one card sit side by side in a frame: the amber badge on the last one counts
 * them all, so every print gets one copy and the rest goes to the prints showing the small "×2".
 */
export function tileCounts(tiles: Tile[]): number[] {
  const out = tiles.map(() => 1)
  for (let a = 0; a < tiles.length; ) {
    let b = a
    while (b + 1 < tiles.length && !tiles[b].badge && cardKey(tiles[b + 1].card) === cardKey(tiles[a].card)) b++
    const size = b - a + 1
    let extra = Math.max(0, (tiles[b].badge || size) - size)
    const order = tiles.slice(a, b + 1).map((t, i) => ({ i: a + i, pill: t.pill })).sort((x, y) => y.pill - x.pill)
    for (let i = 0; extra > 0; i = (i + 1) % size, extra--) out[order[i].i]++
    a = b + 1
  }
  return out
}

export type DeckRead = {
  legend?: Card
  battlefields: Card[]
  main: Tile[]
  side: Tile[]
  runes: { domain: string; qty: number }[]
}

/** The read deck as import text. Codes pin the exact print; the Champion is the first main deck tile. */
export function deckReadText(read: DeckRead, cards: Card[]): string {
  const line = (qty: number, c: Card) => {
    const token = [c.code, c.id].find((t) => /^[A-Za-z0-9*/-]+$/.test(t) && resolveToken(t, cards)?.id === c.id)
    return `${qty} ${displayCardName(c)}${token ? ` [${token}]` : ''}`
  }
  const lines: string[] = []
  const block = (title: string, rows: string[]) => {
    if (rows.length) lines.push(`${title}:`, ...rows, '')
  }
  const mainQty = tileCounts(read.main)
  const first = read.main[0]?.card
  const champion = first && (first.superTypes || []).includes('Champion') && (!read.legend || first.name === read.legend.name) ? first : null
  if (champion) mainQty[0]--
  const merged = (tiles: Tile[], qty: number[]) => {
    const by = new Map<string, number>()
    tiles.forEach((t, i) => qty[i] > 0 && by.set(t.card.id, (by.get(t.card.id) || 0) + qty[i]))
    return [...by].map(([id, n]) => line(n, tiles.find((t) => t.card.id === id)!.card))
  }
  block(SECTION_LABEL.legend, read.legend ? [line(1, read.legend)] : [])
  block(SECTION_LABEL.champion, champion ? [line(1, champion)] : [])
  block(SECTION_LABEL.main, merged(read.main, mainQty))
  block(SECTION_LABEL.battlefield, read.battlefields.map((c) => line(1, c)))
  block(SECTION_LABEL.sideboard, merged(read.side, tileCounts(read.side)))
  block(SECTION_LABEL.rune, read.runes.map((r) => `${r.qty} ${r.domain} Rune`))
  return lines.join('\n').trim()
}

// ---- canvas part: comparing pictures ----

const SIG_W = 12
const SIG_H = 16
/** Part of a tile that is compared: cost, art, name and the top of the text, clear of the badge at the bottom. */
const WINDOW = { x: 0.1, y: 0.07, w: 0.8, h: 0.72 }
const RUNE_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']
/** Badges and counts are compared finer than cards. */
const FINE = 20
/** Where drawQtyBadge puts a print's small count: top centre of the tile, in logical pixels. */
const PILL = { y: 6, w: 26, h: 16 }
/** The amber badge ends 5 in from the tile's right and bottom edge. From that corner: a part that is amber
 *  whatever the number, the badge's right end with its outline (shows where exactly the badge is), the digit. */
const BADGE = {
  inset: 5,
  inner: { x: -27, y: -17.5, w: 24, h: 15 },
  end: { x: -19, y: -21.5, w: 20.5, h: 23 },
  digit: { x: -18, y: -17, w: 13, h: 14 },
}
/** A rune count from the centre of its icon: the text starts 6 right of the icon, its middle 1 lower. */
const RUNE_TEXT = { x: SHARE_LAYOUT.domainIcon / 2 + 6 - 1.5, y: 1 - 9.5, w: 31, h: 19 }
/** A tile is placed to a few pixels (its row and column come from the lit card faces, and those differ),
 *  too coarse for a digit: small templates are tried around their place. */
const NUDGE = [-4.2, -3.5, -2.8, -2.1, -1.4, -0.7, 0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2]

let sigCtx: CanvasRenderingContext2D | null = null

/** A region as a small normalised colour vector; two of them multiply to their correlation. */
function sig(src: CanvasImageSource, r: Rect, w = SIG_W, h = SIG_H): Float32Array {
  if (!sigCtx) {
    sigCtx = canvasOf(32, 32).ctx
    sigCtx.imageSmoothingQuality = 'high'
  }
  sigCtx.fillStyle = SHARE_BG
  sigCtx.fillRect(0, 0, w, h)
  sigCtx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h)
  const d = sigCtx.getImageData(0, 0, w, h).data
  const v = new Float32Array(w * h * 3)
  let sum = 0
  for (let i = 0, j = 0; i < d.length; i += 4) {
    sum += v[j++] = d[i]
    sum += v[j++] = d[i + 1]
    sum += v[j++] = d[i + 2]
  }
  const mean = sum / v.length
  let sq = 0
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean
    sq += v[i] * v[i]
  }
  const norm = Math.sqrt(sq) || 1
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

function dot(a: Float32Array, b: Float32Array) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! }
}

const imgOf = (c: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Img => ctx.getImageData(0, 0, c.width, c.height)

/** Compared window of a tile, optionally shifted by a part of the tile size. */
function windowOf(tile: Rect, dx = 0, dy = 0): Rect {
  return { x: tile.x + (WINDOW.x + dx) * tile.w, y: tile.y + (WINDOW.y + dy) * tile.h, w: WINDOW.w * tile.w, h: WINDOW.h * tile.h }
}

const refSigs = new Map<string, Promise<Float32Array | null>>()

/** A card image as the share image draws it into a tile (cover, battlefields on their side). */
function refSig(url: string, landscape: boolean): Promise<Float32Array | null> {
  const key = `${landscape ? 'l' : 'p'}|${url}`
  let p = refSigs.get(key)
  if (!p) {
    p = (async () => {
      try {
        const bmp = await createImageBitmap(await (await fetch(url)).blob())
        let src: CanvasImageSource = bmp
        let w = bmp.width
        let h = bmp.height
        if (landscape && h > w) {
          const { c, ctx } = canvasOf(h, w)
          ctx.translate(h / 2, w / 2)
          ctx.rotate(Math.PI / 2)
          ctx.drawImage(bmp, -w / 2, -h / 2)
          src = c
          ;[w, h] = [h, w]
        }
        const aspect = landscape ? 1 / CARD_ASPECT : CARD_ASPECT
        const cw = Math.min(w, h * aspect)
        const ch = Math.min(h, w / aspect)
        const s = sig(src, windowOf({ x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }))
        bmp.close()
        return s
      } catch {
        return null
      }
    })()
    refSigs.set(key, p)
  }
  return p
}

type Ref = { card: Card; sig: Float32Array }

async function loadRefs(cards: Card[], src: (c: Card) => string | undefined, landscape: boolean): Promise<Ref[]> {
  const out: Ref[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: 24 }, async () => {
      while (next < cards.length) {
        const card = cards[next++]
        const url = src(card)
        const s = url ? await refSig(url, landscape) : null
        if (s) out.push({ card, sig: s })
      }
    }),
  )
  return out
}

export type Match = { card: Card; score: number; /** Best other card. */ next: number }

/** The card a tile shows. Prints with the same picture tie: an owned one wins, then the ordinary print. */
function matchTile(src: CanvasImageSource, tile: Rect, refs: Ref[], owned: (id: string) => boolean): Match | null {
  // The tile position is good to a pixel or two; small shifts take up the rest.
  const sigs: Float32Array[] = []
  for (const dx of [-0.02, 0, 0.02]) for (const dy of [-0.02, 0, 0.02]) sigs.push(sig(src, windowOf(tile, dx, dy)))
  const scored = refs.map((r) => ({ card: r.card, score: Math.max(...sigs.map((s) => dot(s, r.sig))) })).sort((a, b) => b.score - a.score)
  const top = scored[0]
  if (!top) return null
  const key = cardKey(top.card)
  const rank = (c: Card) => (owned(c.id) ? 100 : 0) + printScore(c)
  const pick = scored
    .filter((m) => m.score >= top.score - 0.04 && cardKey(m.card) === key)
    .sort((a, b) => rank(b.card) - rank(a.card) || b.score - a.score)[0]
  return { card: pick.card, score: top.score, next: scored.find((m) => cardKey(m.card) !== key)?.score ?? 0 }
}

type Templates = { badge: Map<number, { end: Float32Array; digit: Float32Array }>; pill: Float32Array; rune: Map<number, Float32Array> }
let templates: Templates | null = null

/** A rect given relative to a point, in logical pixels. */
function from(x: number, y: number, r: Rect, s: number): Rect {
  return { x: x + r.x * s, y: y + r.y * s, w: r.w * s, h: r.h * s }
}

/** The share image's own badges and rune counts, drawn 4× with the same code and font, to compare against. */
async function loadTemplates(): Promise<Templates> {
  if (templates) return templates
  await document.fonts.load(RUNE_QTY_FONT).catch(() => undefined)
  const sheet = (bg: string) => {
    const { c, ctx } = canvasOf(320, 160)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 320, 160)
    ctx.scale(4, 4)
    return { c, ctx }
  }
  const fine = (c: HTMLCanvasElement, x: number, y: number, r: Rect) => sig(c, from(4 * x, 4 * y, r, 4), FINE, FINE)
  const badge: Templates['badge'] = new Map()
  // shortcut: only ×2 and ×3, a deck holds at most 3 copies of a card. More candidates once that changes.
  for (const n of [2, 3]) {
    const { c, ctx } = sheet(SHARE_BG)
    drawQtyBadge(ctx, 0, 0, 60, 40, n)
    badge.set(n, { end: fine(c, 60 - BADGE.inset, 40 - BADGE.inset, BADGE.end), digit: fine(c, 60 - BADGE.inset, 40 - BADGE.inset, BADGE.digit) })
  }
  const p = sheet('#777')
  drawQtyBadge(p.ctx, 0, 0, 60, 40, 2, true)
  const pill = fine(p.c, 30, 0, { x: -PILL.w / 2, ...PILL })
  const rune = new Map<number, Float32Array>()
  for (let n = 1; n <= 12; n++) {
    const { c, ctx } = sheet(SHARE_BG)
    ctx.fillStyle = '#f5f5f7'
    ctx.font = RUNE_QTY_FONT
    ctx.textBaseline = 'middle'
    // Like the share image: text 6 right of the icon, 1 below its middle. The icon centre is at 20, 20.
    ctx.fillText(`×${n}`, 20 + SHARE_LAYOUT.domainIcon / 2 + 6, 21)
    rune.set(n, fine(c, 20, 20, RUNE_TEXT))
  }
  templates = { badge, pill, rune }
  return templates
}

function bestOf<T>(items: Iterable<[number, T]>, score: (t: T) => number): { n: number; score: number } {
  let best = { n: 0, score: -Infinity }
  for (const [n, t] of items) {
    const s = score(t)
    if (s > best.score) best = { n, score: s }
  }
  return best
}

/** Where around r one of the templates shows best, as an offset in logical pixels. */
function nudge(src: CanvasImageSource, r: Rect, s: number, refs: Float32Array[]) {
  let best = { score: -1, dx: 0, dy: 0 }
  for (const dx of NUDGE) {
    for (const dy of NUDGE) {
      const v = sig(src, { ...r, x: r.x + dx * s, y: r.y + dy * s }, FINE, FINE)
      for (const ref of refs) {
        const score = dot(v, ref)
        if (score > best.score) best = { score, dx, dy }
      }
    }
  }
  return best
}

/** Amber badge at the bottom right of a tile: 0 without one, else its number. */
function readBadge(src: CanvasImageSource, img: Img, tile: Rect, s: number, t: Templates): number {
  const x = tile.x + tile.w - BADGE.inset * s
  const y = tile.y + tile.h - BADGE.inset * s
  const inner = from(x, y, BADGE.inner, s)
  if ((boxOf(img, inner, amber)?.n ?? 0) < 0.35 * inner.w * inner.h) return 0
  // The badge end looks nearly the same for every number, so it only places the badge; the digit decides.
  const at = nudge(src, from(x, y, BADGE.end, s), s, [...t.badge.values()].map((b) => b.end))
  if (at.score < 0.5) return 0
  const digit = sig(src, from(x + at.dx * s, y + at.dy * s, BADGE.digit, s), FINE, FINE)
  return bestOf(t.badge, (b) => dot(digit, b.digit)).n
}

function meanLit(img: Img, r: Rect): number[] {
  const sum = [0, 0, 0]
  let n = 0
  for (let y = Math.max(0, Math.round(r.y)); y < Math.min(img.height, Math.round(r.y + r.h)); y++) {
    for (let x = Math.max(0, Math.round(r.x)); x < Math.min(img.width, Math.round(r.x + r.w)); x++) {
      const i = (y * img.width + x) * 4
      if (!lit(img.data, i)) continue
      n++
      for (let ch = 0; ch < 3; ch++) sum[ch] += img.data[i + ch]
    }
  }
  return sum.map((v) => v / (n || 1))
}

/** Rune counts under the Legend: domain icon, "×n", next icon, ... The icons can only be the Legend's domains. */
async function readRunes(src: CanvasImageSource, img: Img, legend: Rect, domains: string[], s: number, t: Templates) {
  const L = SHARE_LAYOUT
  const band = { x: legend.x - 3 * s, y: legend.y + legend.h + (L.stackGap + L.labelH - 5) * s, w: legend.w + 6 * s, h: (L.domainIcon + 10) * s }
  const colours: [string, number[]][] = []
  const known = RUNE_DOMAINS.filter((d) => domains.includes(d))
  for (const d of known.length ? known : RUNE_DOMAINS) {
    const icon = await loadUrl(`${import.meta.env.BASE_URL}domains/${d.toLowerCase()}.svg`)
    if (!icon) continue
    const { c, ctx } = canvasOf(68, 68)
    ctx.fillStyle = SHARE_BG
    ctx.fillRect(0, 0, 68, 68)
    ctx.drawImage(icon, 0, 0, 68, 68)
    colours.push([d, meanLit(imgOf(c, ctx), { x: 0, y: 0, w: 68, h: 68 })])
  }
  if (!colours.length) return []
  // By hue: a scaled copy comes out darker than the icon itself.
  const hue = (a: number[], b: number[]) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1)
  return litRuns(img, band, 3.5 * s)
    .filter((r) => r.h >= 0.7 * L.domainIcon * s)
    .map((icon) => {
      const rgb = meanLit(img, icon)
      const domain = bestOf(colours.map((e, n) => [n, e[1]] as [number, number[]]), (c) => hue(c, rgb))
      const text = from(icon.x + icon.w / 2, icon.y + icon.h / 2, RUNE_TEXT, s)
      return { domain: colours[domain.n][0], qty: bestOf(t.rune, (ref) => nudge(src, text, s, [ref]).score).n }
    })
}

export type ImageImport = {
  text: string
  /** Cards read, copies counted. */
  count: number
  /** Names the picture did not show clearly: worth a look before importing. */
  unsure: string[]
  read: DeckRead
  layout: Layout
  matches: Match[]
}

/** Below SURE a tile looks like no card well enough; within MARGIN of another card it could be either. */
const SURE = 0.6
const MARGIN = 0.05

/**
 * Deck list from a share image, or null when the picture holds no deck.
 * src: image URL of a card (thumbnail or full art), owned: whether the user has that print.
 */
export async function deckFromImage(
  file: Blob,
  cards: Card[],
  src: (c: Card) => string | undefined,
  owned: (id: string) => boolean,
): Promise<ImageImport | null> {
  const bmp = await createImageBitmap(file)
  const { c, ctx } = canvasOf(bmp.width, bmp.height)
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = imgOf(c, ctx)
  const layout = findLayout(img)
  if (!layout) return null

  const is = (card: Card, type: string) => (card.types || []).includes(type)
  const [legends, fields, others, t] = await Promise.all([
    loadRefs(cards.filter((x) => is(x, 'Legend')), src, false),
    loadRefs(cards.filter((x) => is(x, 'Battlefield')), src, true),
    loadRefs(cards.filter((x) => !is(x, 'Legend') && !is(x, 'Battlefield') && !is(x, 'Rune') && !is(x, 'Token')), src, false),
    loadTemplates(),
  ])
  const matches: Match[] = []
  const unsure: string[] = []
  const match = (tile: Rect, refs: Ref[]) => {
    const m = matchTile(c, tile, refs, owned)
    if (m) {
      matches.push(m)
      if (m.score < SURE || m.score - m.next < MARGIN) unsure.push(displayCardName(m.card))
    }
    return m
  }
  const s = layout.scale
  const tiles = (rows: Rect[][]): Tile[] =>
    rows.flat().flatMap((tile) => {
      const m = match(tile, others)
      if (!m) return []
      const pill = from(tile.x + tile.w / 2, tile.y, { x: -PILL.w / 2, ...PILL }, s)
      return [{ card: m.card, badge: readBadge(c, img, tile, s, t), pill: nudge(c, pill, s, [t.pill]).score }]
    })
  const legend = (layout.legend && match(layout.legend, legends)?.card) || undefined
  const read: DeckRead = {
    legend,
    battlefields: layout.battlefields.flatMap((b) => match(b, fields)?.card ?? []),
    main: tiles(layout.rows.slice(0, layout.sideRow)),
    side: tiles(layout.rows.slice(layout.sideRow)),
    runes: layout.legend ? await readRunes(c, img, layout.legend, legend?.domains || [], s, t) : [],
  }
  const copies = [...tileCounts(read.main), ...tileCounts(read.side), ...read.runes.map((r) => r.qty)].reduce((a, b) => a + b, 0)
  return { text: deckReadText(read, cards), count: (read.legend ? 1 : 0) + read.battlefields.length + copies, unsure, read, layout, matches }
}
