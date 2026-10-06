import type { Card, Deck, DeckCard } from './types'
import { sectionOf } from './deckHelpers'

const BG = '#1c1c1c'
const GOLD = '#c9a227'
const BADGE_BG = 'rgba(0,0,0,0.78)'
/** Fixed 3× logical layout so exported PNG stays crisp on all displays. */
const RENDER_SCALE = 3
const DOMAIN_FILES: Record<string, string> = {
  Fury: 'fury.png',
  Calm: 'calm.png',
  Mind: 'mind.png',
  Body: 'body.png',
  Chaos: 'chaos.png',
  Order: 'order.png',
  Colorless: 'colorless.png',
}

type Loaded = HTMLImageElement | null

/** Drop CDN thumb/resize params so we load full card art. */
function fullResImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    for (const key of [
      'w',
      'h',
      'width',
      'height',
      'auto',
      'q',
      'dpr',
      'fit',
      'rect',
      'max-w',
      'max-h',
      'quality',
      'fm',
    ]) {
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
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
  const label = `x${qty}`
  ctx.font = 'bold 12px system-ui, sans-serif'
  const tw = ctx.measureText(label).width
  const bw = tw + 10
  const bh = 17
  const bx = x + (w - bw) / 2
  const by = y + h - bh - 4
  ctx.fillStyle = BADGE_BG
  roundRect(ctx, bx, by, bw, bh, 8)
  ctx.fill()
  ctx.fillStyle = '#fff'
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
) {
  ctx.save()
  roundRect(ctx, x, y, w, h, 5)
  ctx.clip()
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(x, y, w, h)
  if (img) {
    const s = Math.max(w / img.width, h / img.height)
    const dw = img.width * s
    const dh = img.height * s
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }
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
    const portrait = img.naturalHeight > img.naturalWidth
    if (portrait) {
      ctx.translate(x + w / 2, y + h / 2)
      ctx.rotate(Math.PI / 2)
      const boxW = h
      const boxH = w
      const s = Math.max(boxW / img.width, boxH / img.height)
      const dw = img.width * s
      const dh = img.height * s
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    } else {
      const s = Math.max(w / img.width, h / img.height)
      const dw = img.width * s
      const dh = img.height * s
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    }
  }
  ctx.restore()
}

function safeFileName(name: string) {
  return name.replace(/[^\w\- äöüÄÖÜß]+/gi, '_').replace(/\s+/g, '_').slice(0, 80) || 'deck'
}

function paintBg(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'
  ctx.lineWidth = 1
  for (let x = 0; x < width; x += 48) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 0; y < height; y += 48) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
}

export type ShareRender =
  | { ok: true; canvas: HTMLCanvasElement; fileName: string; dataUrl: string }
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
        const file = DOMAIN_FILES[d]
        if (!file) return
        domainImgs.set(d, await loadUrl(`${import.meta.env.BASE_URL}domains/${file}`))
      }),
    )

    const pad = 20
    const brandH = 28
    const leftW = 200
    const gap = 14
    const cardW = 110
    const cardH = 154
    const cardGap = 6
    const cols = 8
    const mainRows = Math.max(1, Math.ceil(Math.max(mainGrid.length, 1) / cols))
    const sideRows = sideboard.length ? Math.ceil(sideboard.length / cols) : 0

    const legendH = 280
    // Gold rimmed domain icons (same public/domains assets as filter chips).
    const domainIcon = 40
    const domainRim = 2.5
    const domainLabelGap = 6
    const domainItemGap = 18
    const domainRowH = domainCounts.size ? domainIcon + 4 : 0
    const bfH = 52
    const bfGap = 6
    const leftStack =
      legendH +
      (domainRowH ? 12 + domainRowH : 0) +
      (battlefields.length ? 10 + battlefields.length * (bfH + bfGap) - bfGap : 0)

    const mainBlockH = mainGrid.length ? mainRows * (cardH + cardGap) - cardGap : 40
    const sideLabelH = 28
    const sideBlockH = sideboard.length ? sideRows * (cardH + cardGap) - cardGap : 0

    const rightW = cols * (cardW + cardGap) - cardGap
    const width = pad * 2 + leftW + gap + rightW
    const contentTop = pad + brandH + 10
    const mainBottom = contentTop + mainBlockH
    const leftBottom = contentTop + leftStack
    // Sideboard sits under the main deck grid only (right column), not under max(left, main).
    const sideTop = mainBottom + 14
    const sideEnd = sideTop + sideLabelH + (sideboard.length ? 10 + sideBlockH : 0)
    const height = Math.max(leftBottom, sideEnd) + pad

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * RENDER_SCALE)
    canvas.height = Math.round(height * RENDER_SCALE)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, error: 'canvas' }
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    paintBg(ctx, width, height)

    const brand = `${(deck.name || 'Deck').trim()} · Deakrix`
    ctx.fillStyle = '#fff'
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillText(brand, pad, pad + 18)

    let lx = pad
    let ly = contentTop

    if (legend) {
      drawCard(ctx, imgMap.get(legend.id) || null, lx, ly, leftW, legendH, 0)
      ly += legendH + 8
    } else {
      ctx.fillStyle = '#333'
      roundRect(ctx, lx, ly, leftW, 72, 5)
      ctx.fill()
      ly += 80
    }

    if (domainCounts.size) {
      let dx = lx
      for (const [dom, n] of domainCounts) {
        const cx = dx + domainIcon / 2
        const cy = ly + domainIcon / 2
        const r = domainIcon / 2
        // Soft disc + gold rim (Piltover Archive chip look; art from public/domains).
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = '#141414'
        ctx.fill()
        const dimg = domainImgs.get(dom)
        if (dimg) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(cx, cy, r - domainRim, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(dimg, dx + 1, ly + 1, domainIcon - 2, domainIcon - 2)
          ctx.restore()
        }
        ctx.beginPath()
        ctx.arc(cx, cy, r - domainRim / 2, 0, Math.PI * 2)
        ctx.strokeStyle = GOLD
        ctx.lineWidth = domainRim
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 14px system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        const qtyLabel = `x${n}`
        ctx.fillText(qtyLabel, dx + domainIcon + domainLabelGap, cy + 0.5)
        const tw = ctx.measureText(qtyLabel).width
        ctx.textBaseline = 'alphabetic'
        dx += domainIcon + domainLabelGap + tw + domainItemGap
      }
      ly += domainRowH + 12
    }

    for (const bf of battlefields) {
      drawBattlefieldBanner(ctx, imgMap.get(bf.id) || null, lx, ly, leftW, bfH)
      ly += bfH + bfGap
    }

    const rx = pad + leftW + gap
    const ry = contentTop
    if (!mainGrid.length) {
      ctx.fillStyle = '#666'
      ctx.font = '13px system-ui, sans-serif'
      ctx.fillText('Main', rx, ry + 16)
    } else {
      mainGrid.forEach((dc, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = rx + col * (cardW + cardGap)
        const y = ry + row * (cardH + cardGap)
        drawCard(ctx, imgMap.get(dc.id) || null, x, y, cardW, cardH, dc.qty)
      })
    }

    // Gold divider + SIDEBOARD label span the right column only (under main grid).
    const lineY = sideTop
    const rightMid = rx + rightW / 2
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(rx, lineY)
    ctx.lineTo(rx + rightW, lineY)
    ctx.stroke()
    const sideLabel = 'SIDEBOARD'
    ctx.font = 'bold 11px system-ui, sans-serif'
    const sw = ctx.measureText(sideLabel).width + 16
    ctx.fillStyle = BG
    ctx.fillRect(rightMid - sw / 2, lineY - 10, sw, 20)
    ctx.strokeStyle = GOLD
    roundRect(ctx, rightMid - sw / 2, lineY - 10, sw, 20, 4)
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sideLabel, rightMid, lineY)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    const sy = lineY + 16
    if (sideboard.length) {
      sideboard.forEach((dc, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = rx + col * (cardW + cardGap)
        const y = sy + row * (cardH + cardGap)
        drawCard(ctx, imgMap.get(dc.id) || null, x, y, cardW, cardH, dc.qty)
      })
    }

    const fileName = `${safeFileName(deck.name)}_share.png`
    const dataUrl = canvas.toDataURL('image/png')
    return { ok: true, canvas, fileName, dataUrl }
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
