import type { Card, Deck, DeckCard } from './types'
import { sectionOf } from './deckHelpers'

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
) {
  if (qty <= 1) return
  const label = `×${qty}`
  ctx.font = `800 13px ${FONT}`
  const tw = ctx.measureText(label).width
  const bw = tw + 14
  const bh = 20
  const bx = x + w - bw - 5
  const by = y + h - bh - 5
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 6
  ctx.fillStyle = AMBER
  roundRect(ctx, bx, by, bw, bh, 10)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#1c1306'
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
    const sideboard = sectionCards(deck, 'sideboard')
    const domainCounts = runeDomainCounts(deck, byId)

    // Champion is the first card of the main grid (not under Legend).
    const mainGrid: DeckCard[] = champion ? [champion, ...main] : main

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
    const cardW = 110
    const cardH = 154
    const cardGap = 8
    const cols = 8
    const mainRows = Math.max(1, Math.ceil(Math.max(mainGrid.length, 1) / cols))
    const sideRows = sideboard.length ? Math.ceil(sideboard.length / cols) : 0

    const legendH = Math.round(leftW * 1039 / 744)
    const domainIcon = 34
    const domainRowH = domainCounts.size ? labelH + domainIcon : 0
    const bfH = 56
    const bfGap = 8
    const leftStack =
      legendH +
      (domainRowH ? 20 + domainRowH : 0) +
      (battlefields.length ? 20 + labelH + battlefields.length * (bfH + bfGap) - bfGap : 0)

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
    ctx.textAlign = 'right'
    ctx.fillStyle = AMBER
    ctx.font = `700 14px ${FONT}`
    ctx.fillText('DEAKRIX', width - pad, pad + 26)
    ctx.fillStyle = MUTED
    ctx.font = `500 12px ${FONT}`
    ctx.fillText('Riftbound Tracker', width - pad, pad + 46)
    ctx.textAlign = 'left'
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
    const drawGrid = (cards: DeckCard[], top: number) =>
      cards.forEach((dc, i) => {
        const x = rx + (i % cols) * (cardW + cardGap)
        const y = top + Math.floor(i / cols) * (cardH + cardGap)
        drawCard(ctx, imgMap.get(dc.id) || null, x, y, cardW, cardH, dc.qty)
      })
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
