import type { Card, Deck, DeckCard } from './types'
import { groupPrints, printRuns, printSlots, sectionOf } from './deckHelpers'

// Same palette as the app: near-black canvas, amber accent, Apple grey for secondary text.
const BG = '#0f0f11'
const AMBER = '#f5a623'
const MUTED = '#98989f'
const FONT = '"Inter Variable", system-ui, sans-serif'
/** Fixed 3× logical layout so exported PNG stays crisp on all displays. */
const RENDER_SCALE = 3
const DOMAINS = new Set(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'])

type Loaded = HTMLImageElement | null

/** Drop CDN thumb/resize params so we load full card art. */
function fullResImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    for (const key of 'w h width height auto q dpr fit rect max-w max-h quality fm'.split(' ')) {
      u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return url
  }
}

async function loadUrl(url: string | null | undefined): Promise<Loaded> {
  const full = fullResImageUrl(url)
  if (!full) return null
  let src = full
  try {
    if (window.riftbound?.fetchImageDataUrl && /^https:\/\//i.test(full)) {
      const res = await window.riftbound.fetchImageDataUrl(full)
      if (res.ok && res.dataUrl) src = res.dataUrl
    }
  } catch {
    /* fall through */
  }
  return new Promise((resolve) => {
    const img = new Image()
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function sectionCards(deck: Deck, section: string): DeckCard[] {
  return deck.cards.filter((c) => sectionOf(c) === section && c.qty > 0)
}

function runeDomainCounts(deck: Deck, byId: Map<string, Card>): Map<string, number> {
  const m = new Map<string, number>()
  for (const dc of sectionCards(deck, 'rune')) {
    const card = byId.get(dc.id)
    if (!card) continue
    for (const d of card.domains || []) {
      if (!d || d === 'Colorless') continue
      m.set(d, (m.get(d) || 0) + dc.qty)
    }
  }
  return m
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

/** Scale img to cover a boxW×boxH box centred on (cx, cy). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, boxW: number, boxH: number) {
  const s = Math.max(boxW / img.width, boxH / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
}

function drawQtyBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  qty: number,
  print = false,
) {
  if (qty <= 1) return
  // print: the copies of one print inside a framed group, small and neutral bottom left, so the amber
  // badge clearly counts the whole group.
  const label = `×${qty}`
  ctx.font = `800 ${print ? 11 : 13}px ${FONT}`
  const tw = ctx.measureText(label).width
  const bw = tw + (print ? 10 : 14)
  const bh = print ? 16 : 20
  const bx = print ? x + 5 : x + w - bw - 5
  const by = y + h - bh - 5
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 6
  ctx.fillStyle = print ? 'rgba(24,24,27,0.88)' : AMBER
  roundRect(ctx, bx, by, bw, bh, 10)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = print ? '#f5f5f7' : '#1c1306'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  img: Loaded,
  x: number,
  y: number,
  w: number,
  h: number,
  qty: number,
  radius = 6,
) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#26262a'
  roundRect(ctx, x, y, w, h, radius)
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()
  ctx.fillStyle = '#26262a'
  ctx.fillRect(x, y, w, h)
  if (img) drawCover(ctx, img, x + w / 2, y + h / 2, w, h)
  ctx.restore()
  drawQtyBadge(ctx, x, y, w, h, qty)
}

/**
 * Piltover Archive landscape battlefield banner.
 * Landscape art (w ≥ h): draw as-is. Portrait files store the banner on its
 * side — rotate 90° clockwise (same as card detail bf-on) so text reads flat.
 */
function drawBattlefieldBanner(
  ctx: CanvasRenderingContext2D,
  img: Loaded,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save()
  roundRect(ctx, x, y, w, h, 4)
  ctx.clip()
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(x, y, w, h)
  if (img) {
    if (img.naturalHeight > img.naturalWidth) {
      ctx.translate(x + w / 2, y + h / 2)
      ctx.rotate(Math.PI / 2)
      drawCover(ctx, img, 0, 0, h, w)
    } else drawCover(ctx, img, x + w / 2, y + h / 2, w, h)
  }
  ctx.restore()
}

/** Small uppercase section label with an optional amber count, top-aligned at y. */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, count: number | null, x: number, y: number) {
  ctx.textBaseline = 'top'
  ctx.font = `700 12px ${FONT}`
  ctx.letterSpacing = '1.2px'
  ctx.fillStyle = MUTED
  const label = text.toUpperCase()
  ctx.fillText(label, x, y)
  if (count != null) {
    const w = ctx.measureText(label).width
    ctx.fillStyle = AMBER
    ctx.fillText(String(count), x + w + 8, y)
  }
  ctx.letterSpacing = '0px'
  ctx.textBaseline = 'alphabetic'
}

function safeFileName(name: string) {
  return name.replace(/[^\w\- äöüÄÖÜß]+/gi, '_').replace(/\s+/g, '_').slice(0, 80) || 'deck'
}

export type ShareRender =
  | { ok: true; fileName: string; dataUrl: string }
  | { ok: false; error: string }

/** Piltover Archive style share canvas (no separate Runes row; rune counts as domain icons). */
export async function renderDeckShareCanvas(
  deck: Deck,
  byId: Map<string, Card>,
): Promise<ShareRender> {
  try {
    const legend = sectionCards(deck, 'legend')[0]
    const champion = sectionCards(deck, 'champion')[0]
    const main = sectionCards(deck, 'main')
    const battlefields = sectionCards(deck, 'battlefield')
    const sideboard = groupPrints(sectionCards(deck, 'sideboard'), byId)
    const domainCounts = runeDomainCounts(deck, byId)

    // Champion is the first card of the main grid (not under Legend). Every print gets its own tile with
    // its own count, prints of one card side by side in a frame (drawGrid).
    const mainGrid: DeckCard[] = groupPrints(champion ? [champion, ...main] : main, byId)

    const allIds = [
      legend?.id,
      ...mainGrid.map((c) => c.id),
      ...battlefields.map((c) => c.id),
      ...sideboard.map((c) => c.id),
    ].filter(Boolean) as string[]

    const imgMap = new Map<string, Loaded>()
    await Promise.all(
      allIds.map(async (id) => {
        const c = byId.get(id)
        imgMap.set(id, await loadUrl(c?.image))
      }),
    )

    const domainImgs = new Map<string, Loaded>()
    await Promise.all(
      [...domainCounts.keys()].map(async (d) => {
        if (!DOMAINS.has(d)) return
        domainImgs.set(d, await loadUrl(`${import.meta.env.BASE_URL}domains/${d.toLowerCase()}.svg`))
      }),
    )

    const pad = 28
    const headerH = 58
    const labelH = 24
    const leftW = 210
    const gap = 24
    const cardGap = 8
    const legendH = Math.round(leftW * 1039 / 744)
    const domainIcon = 34
    const domainRowH = domainCounts.size ? labelH + domainIcon : 0
    // Full landscape card (744×1039 on its side); a thin strip cropped away most of the art.
    const bfH = Math.round(leftW * 744 / 1039)
    const bfGap = 10
    const leftStack =
      legendH +
      (domainRowH ? 20 + domainRowH : 0) +
      (battlefields.length ? 20 + labelH + battlefields.length * (bfH + bfGap) - bfGap : 0)

    // Pick the column count that gives the largest cards while main deck + sideboard
    // fit next to the left stack, so the grid fills the space whatever the copy count (more prints in
    // frames take more rows, so the cards get smaller).
    const sideExtra = sideboard.length ? 24 + labelH : 0
    let cols = 8
    let cardW = 70
    for (let c = 6; c <= 12; c++) {
      const rows = Math.max(1, printSlots(mainGrid, byId, c).rows) + printSlots(sideboard, byId, c).rows
      const gaps = (rows - (sideboard.length ? 2 : 1)) * cardGap
      const byHeight = ((leftStack - labelH - sideExtra - gaps) / rows) * 744 / 1039
      const byWidth = (1200 + cardGap) / c - cardGap
      const w = Math.floor(Math.min(150, byHeight, byWidth))
      if (w > cardW) {
        cols = c
        cardW = w
      }
    }
    const cardH = Math.round(cardW * 1039 / 744)
    const mainRows = Math.max(1, printSlots(mainGrid, byId, cols).rows)
    const sideRows = printSlots(sideboard, byId, cols).rows

    const mainBlockH = labelH + (mainGrid.length ? mainRows * (cardH + cardGap) - cardGap : 40)
    const sideBlockH = sideboard.length ? 24 + labelH + sideRows * (cardH + cardGap) - cardGap : 0

    const rightW = cols * (cardW + cardGap) - cardGap
    const width = pad * 2 + leftW + gap + rightW
    const contentTop = pad + headerH + 18
    const height = contentTop + Math.max(leftStack, mainBlockH + sideBlockH) + pad

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * RENDER_SCALE)
    canvas.height = Math.round(height * RENDER_SCALE)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, error: 'canvas' }
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, width, height)
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.6)
    glow.addColorStop(0, 'rgba(245,166,35,0.10)')
    glow.addColorStop(1, 'rgba(245,166,35,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)

    // Header: deck name, legend + card count underneath, brand on the right.
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#f5f5f7'
    ctx.font = `700 26px ${FONT}`
    ctx.fillText((deck.name || 'Deck').trim(), pad, pad + 26)
    const total = deck.cards.reduce((n, c) => n + c.qty, 0)
    const legendName = legend ? byId.get(legend.id)?.name : undefined
    ctx.fillStyle = MUTED
    ctx.font = `500 14px ${FONT}`
    ctx.fillText([legendName, `${total} cards`].filter(Boolean).join('  ·  '), pad, pad + 50)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(pad, pad + headerH + 2, width - pad * 2, 1)

    const lx = pad
    let ly = contentTop

    if (legend) {
      drawCard(ctx, imgMap.get(legend.id) || null, lx, ly, leftW, legendH, 0, 10)
    } else {
      ctx.fillStyle = '#26262a'
      roundRect(ctx, lx, ly, leftW, legendH, 10)
      ctx.fill()
    }
    ly += legendH

    if (domainCounts.size) {
      ly += 20
      drawLabel(ctx, 'Runes', null, lx, ly)
      ly += labelH
      let dx = lx
      for (const [dom, n] of domainCounts) {
        const dimg = domainImgs.get(dom)
        if (dimg) ctx.drawImage(dimg, dx, ly, domainIcon, domainIcon)
        ctx.fillStyle = '#f5f5f7'
        ctx.font = `700 15px ${FONT}`
        ctx.textBaseline = 'middle'
        const qtyLabel = `×${n}`
        ctx.fillText(qtyLabel, dx + domainIcon + 6, ly + domainIcon / 2 + 1)
        const tw = ctx.measureText(qtyLabel).width
        ctx.textBaseline = 'alphabetic'
        dx += domainIcon + 6 + tw + 18
      }
      ly += domainIcon
    }

    if (battlefields.length) {
      ly += 20
      drawLabel(ctx, 'Battlefields', battlefields.length, lx, ly)
      ly += labelH
      for (const bf of battlefields) {
        drawBattlefieldBanner(ctx, imgMap.get(bf.id) || null, lx, ly, leftW, bfH)
        ly += bfH + bfGap
      }
    }

    const rx = pad + leftW + gap
    const drawGrid = (cards: DeckCard[], top: number) => {
      const { slots } = printSlots(cards, byId, cols)
      const tileX = (i: number) => rx + slots[i][0] * (cardW + cardGap)
      const tileY = (i: number) => top + slots[i][1] * (cardH + cardGap)
      const runs = printRuns(cards, byId)
      const inRun = (i: number) => runs.some(([a, b]) => i >= a && i <= b)
      cards.forEach((dc, i) => {
        drawCard(ctx, imgMap.get(dc.id) || null, tileX(i), tileY(i), cardW, cardH, inRun(i) ? 0 : dc.qty)
        if (inRun(i)) drawQtyBadge(ctx, tileX(i), tileY(i), cardW, cardH, dc.qty, true)
      })
      // Prints of one card: an amber frame around them (inside the gap, so neighbours never touch) and one
      // amber badge with the copies of all prints together. A run only wraps when it is wider than a row.
      ctx.strokeStyle = AMBER
      ctx.lineWidth = 1.5
      for (const [a, b] of runs) {
        for (let i = a; i <= b; ) {
          let end = i
          while (end < b && slots[end + 1][1] === slots[i][1]) end++
          const o = 3
          roundRect(ctx, tileX(i) - o, tileY(i) - o, tileX(end) + cardW - tileX(i) + o * 2, cardH + o * 2, 9)
          ctx.stroke()
          i = end + 1
        }
        const total = cards.slice(a, b + 1).reduce((n, c) => n + c.qty, 0)
        drawQtyBadge(ctx, tileX(b), tileY(b), cardW, cardH, total)
      }
    }
    const mainCount = mainGrid.reduce((n, c) => n + c.qty, 0)
    drawLabel(ctx, 'Main deck', mainCount, rx, contentTop)
    drawGrid(mainGrid, contentTop + labelH)

    if (sideboard.length) {
      const sideTop = contentTop + mainBlockH + 24
      drawLabel(ctx, 'Sideboard', sideboard.reduce((n, c) => n + c.qty, 0), rx, sideTop)
      drawGrid(sideboard, sideTop + labelH)
    }

    const fileName = `${safeFileName(deck.name)}_share.png`
    const dataUrl = canvas.toDataURL('image/png')
    return { ok: true, fileName, dataUrl }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function downloadSharePng(dataUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.click()
}
