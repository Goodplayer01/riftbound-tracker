import type { Card, Deck, DeckCard } from './types'
import { sectionOf } from './deckHelpers'

const BG = '#1a1a1a'
const GOLD = '#c9a227'
const BADGE_BG = 'rgba(0,0,0,0.72)'
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

async function loadUrl(url: string | null | undefined): Promise<Loaded> {
  if (!url) return null
  let src = url
  try {
    if (window.riftbound?.fetchImageDataUrl && /^https:\/\//i.test(url)) {
      const res = await window.riftbound.fetchImageDataUrl(url)
      if (res.ok && res.dataUrl) src = res.dataUrl
    }
  } catch {
    /* fall through to direct load */
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
  roundRect(ctx, x, y, w, h, 6)
  ctx.clip()
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(x, y, w, h)
  if (img) {
    // cover
    const s = Math.max(w / img.width, h / img.height)
    const dw = img.width * s
    const dh = img.height * s
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }
  ctx.restore()
  if (qty > 1) {
    const label = `x${qty}`
    ctx.font = 'bold 14px system-ui, sans-serif'
    const tw = ctx.measureText(label).width
    const bw = tw + 14
    const bh = 22
    const bx = x + (w - bw) / 2
    const by = y + h - bh - 6
    ctx.fillStyle = BADGE_BG
    roundRect(ctx, bx, by, bw, bh, 11)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
}

function drawLandscape(
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
    // battlefield art is portrait; crop center as landscape
    const srcH = img.width * (h / w)
    const sy = Math.max(0, (img.height - srcH) / 2)
    const sh = Math.min(img.height, srcH)
    ctx.drawImage(img, 0, sy, img.width, sh, x, y, w, h)
  }
  ctx.restore()
}

function safeFileName(name: string) {
  return name.replace(/[^\w\- äöüÄÖÜß]+/gi, '_').replace(/\s+/g, '_').slice(0, 80) || 'deck'
}

/** Render a Piltover Archive style deck PNG and trigger a download. */
export async function exportDeckScreenshot(
  deck: Deck,
  byId: Map<string, Card>,
): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  try {
    const legend = sectionCards(deck, 'legend')[0]
    const champion = sectionCards(deck, 'champion')[0]
    const main = sectionCards(deck, 'main')
    const battlefields = sectionCards(deck, 'battlefield')
    const runes = sectionCards(deck, 'rune')
    const sideboard = sectionCards(deck, 'sideboard')
    const domainCounts = runeDomainCounts(deck, byId)

    const allIds = [
      legend?.id,
      champion?.id,
      ...main.map((c) => c.id),
      ...battlefields.map((c) => c.id),
      ...runes.map((c) => c.id),
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

    const pad = 28
    const leftW = 220
    const gap = 16
    const cardW = 110
    const cardH = 154
    const cardGap = 10
    const cols = 8
    const mainRows = Math.max(1, Math.ceil(Math.max(main.length, 1) / cols))
    const sideRows = sideboard.length ? Math.ceil(sideboard.length / cols) : 0
    const runeRows = runes.length ? Math.ceil(runes.length / cols) : 0

    const legendH = 300
    const champW = 90
    const champH = 126
    const domainRowH = domainCounts.size ? 56 : 0
    const bfH = 52
    const bfGap = 8
    const leftStack =
      legendH +
      (champion ? 12 + champH : 0) +
      (domainRowH ? 12 + domainRowH : 0) +
      (battlefields.length ? 12 + battlefields.length * (bfH + bfGap) : 0)

    const titleH = 36
    const mainBlockH = main.length ? mainRows * (cardH + cardGap) - cardGap : 40
    const runeLabelH = runes.length ? 28 : 0
    const runeBlockH = runes.length ? runeRows * (cardH + cardGap) - cardGap : 0
    const sideLabelH = 36
    const sideBlockH = sideboard.length ? sideRows * (cardH + cardGap) - cardGap : 0

    const rightW = cols * (cardW + cardGap) - cardGap
    const width = pad * 2 + leftW + gap + rightW
    const contentH = Math.max(
      leftStack,
      titleH + 8 + mainBlockH + (runes.length ? 20 + runeLabelH + runeBlockH : 0),
    )
    const height = pad * 2 + contentH + sideLabelH + (sideboard.length ? 12 + sideBlockH : 8) + 24

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, error: 'canvas' }

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, width, height)
    // subtle grid pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    const title = deck.name?.trim() || 'Deakrix Riftbound Tracker'
    ctx.fillStyle = '#fff'
    ctx.font = '600 20px system-ui, sans-serif'
    ctx.fillText(title, pad + leftW + gap, pad + 22)
    ctx.fillStyle = GOLD
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillText('Deakrix Riftbound Tracker', pad + leftW + gap, pad + 40)

    let lx = pad
    let ly = pad

    // Legend
    if (legend) {
      drawCard(ctx, imgMap.get(legend.id) || null, lx, ly, leftW, legendH, legend.qty)
      ly += legendH + 12
    } else {
      ctx.fillStyle = '#333'
      roundRect(ctx, lx, ly, leftW, 80, 6)
      ctx.fill()
      ctx.fillStyle = '#888'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText('Legend', lx + 12, ly + 44)
      ly += 92
    }

    // Champion under legend
    if (champion) {
      drawCard(ctx, imgMap.get(champion.id) || null, lx, ly, champW, champH, champion.qty)
      ctx.fillStyle = '#ccc'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText('Champion', lx + champW + 8, ly + 18)
      const ch = byId.get(champion.id)
      if (ch) {
        ctx.fillStyle = '#fff'
        ctx.font = '13px system-ui, sans-serif'
        const nm = ch.subtitle ? `${ch.name}, ${ch.subtitle}` : ch.name
        ctx.fillText(nm.slice(0, 28), lx + champW + 8, ly + 38)
      }
      ly += champH + 12
    }

    // Domain / rune counts
    if (domainCounts.size) {
      let dx = lx
      for (const [dom, n] of domainCounts) {
        const dimg = domainImgs.get(dom)
        if (dimg) ctx.drawImage(dimg, dx, ly, 36, 36)
        else {
          ctx.fillStyle = '#444'
          ctx.beginPath()
          ctx.arc(dx + 18, ly + 18, 18, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 12px system-ui, sans-serif'
        ctx.fillText(`x${n}`, dx + 8, ly + 52)
        dx += 48
      }
      ly += domainRowH + 12
    }

    // Battlefields stacked
    for (const bf of battlefields) {
      drawLandscape(ctx, imgMap.get(bf.id) || null, lx, ly, leftW, bfH)
      if (bf.qty > 1) {
        ctx.fillStyle = BADGE_BG
        roundRect(ctx, lx + leftW - 36, ly + bfH - 24, 30, 18, 9)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`x${bf.qty}`, lx + leftW - 21, ly + bfH - 11)
        ctx.textAlign = 'left'
      }
      ly += bfH + bfGap
    }

    // Main deck grid
    const rx = pad + leftW + gap
    let ry = pad + titleH + 16
    if (!main.length) {
      ctx.fillStyle = '#666'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText('Main', rx, ry + 20)
    } else {
      main.forEach((dc, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = rx + col * (cardW + cardGap)
        const y = ry + row * (cardH + cardGap)
        drawCard(ctx, imgMap.get(dc.id) || null, x, y, cardW, cardH, dc.qty)
      })
    }
    ry += mainBlockH + 20

    // Runes
    if (runes.length) {
      ctx.fillStyle = GOLD
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.fillText('RUNES', rx, ry + 14)
      ry += runeLabelH
      runes.forEach((dc, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = rx + col * (cardW + cardGap)
        const y = ry + row * (cardH + cardGap)
        drawCard(ctx, imgMap.get(dc.id) || null, x, y, cardW, cardH, dc.qty)
      })
      ry += runeBlockH + 16
    }

    // Sideboard divider
    const sideY = Math.max(ry, pad + leftStack + 8)
    const lineY = sideY + 8
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pad, lineY)
    ctx.lineTo(width - pad, lineY)
    ctx.stroke()
    const sideLabel = 'SIDEBOARD'
    ctx.font = 'bold 12px system-ui, sans-serif'
    const sw = ctx.measureText(sideLabel).width + 20
    ctx.fillStyle = GOLD
    roundRect(ctx, (width - sw) / 2, lineY - 11, sw, 22, 11)
    ctx.fill()
    ctx.fillStyle = '#111'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sideLabel, width / 2, lineY)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    let sy = lineY + 24
    if (sideboard.length) {
      sideboard.forEach((dc, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = pad + col * (cardW + cardGap)
        const y = sy + row * (cardH + cardGap)
        drawCard(ctx, imgMap.get(dc.id) || null, x, y, cardW, cardH, dc.qty)
      })
    }

    const fileName = `${safeFileName(deck.name)}_screenshot.png`
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!blob) return { ok: false, error: 'blob' }

    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    return { ok: true, fileName }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
