import type { Card, Deck, DeckCard, DeckSection } from './types'

export const SECTION_ORDER: DeckSection[] = [
  'legend',
  'champion',
  'main',
  'battlefield',
  'sideboard',
  'rune',
]

export const SECTION_CAPS: Record<DeckSection, number> = {
  legend: 1,
  champion: 1,
  main: 39,
  battlefield: 3,
  sideboard: 10,
  rune: 12,
}

export const SECTION_LABEL: Record<DeckSection, string> = {
  legend: 'Legend',
  champion: 'Champion',
  main: 'Main Deck',
  battlefield: 'Battlefields',
  sideboard: 'Sideboard',
  rune: 'Runes',
}

export const SECTION_ADD_LABEL: Record<DeckSection, string> = {
  legend: '+ Add Legend',
  champion: '+ Add Champion',
  main: '+ Add Main Deck',
  battlefield: '+ Add Battlefields',
  sideboard: '+ Add Sideboard',
  rune: '+ Add Runes',
}

const SECTION_HEADER: Record<string, DeckSection> = {
  legend: 'legend',
  legende: 'legend',
  champion: 'champion',
  maindeck: 'main',
  'main deck': 'main',
  main: 'main',
  hauptdeck: 'main',
  battlefield: 'battlefield',
  battlefields: 'battlefield',
  gefechtsfeld: 'battlefield',
  gefechtsfelder: 'battlefield',
  rune: 'rune',
  runes: 'rune',
  runen: 'rune',
  sideboard: 'sideboard',
  side: 'sideboard',
}

export function displayCardName(c: Card) {
  return c.subtitle ? `${c.name}, ${c.subtitle}` : c.name
}

export function inferSection(c: Card): DeckSection {
  const types = c.types || []
  const supers = c.superTypes || []
  if (types.includes('Legend')) return 'legend'
  if (types.includes('Battlefield')) return 'battlefield'
  if (types.includes('Rune')) return 'rune'
  if (supers.includes('Champion') && !types.includes('Legend')) return 'champion'
  return 'main'
}

export function cardFitsSection(c: Card, section: DeckSection): boolean {
  const types = c.types || []
  const supers = c.superTypes || []
  const isLegend = types.includes('Legend')
  const isBf = types.includes('Battlefield')
  const isRune = types.includes('Rune')
  const isToken = types.includes('Token') || supers.includes('Token')
  // Champion Unit = Unit + superType Champion (not Legend). Chosen Champion slot
  // is separate; additional Champion Unit copies are legal in Main Deck / Sideboard.
  const isChamp = supers.includes('Champion') && !isLegend

  if (section === 'legend') return isLegend
  if (section === 'champion') return isChamp
  if (section === 'battlefield') return isBf
  if (section === 'rune') return isRune
  // main / sideboard: Units (incl. Champion Units), Spells, Gear — not Legend/BF/Rune/Token
  if (isLegend || isBf || isRune || isToken) return false
  return types.some((t) => t === 'Unit' || t === 'Spell' || t === 'Gear') || types.length > 0
}

export function sectionOf(dc: DeckCard): DeckSection {
  return dc.section || 'main'
}

export function migrateDeck(d: Deck, byId: Map<string, Card>): Deck {
  let changed = false
  const cards = d.cards.map((dc) => {
    if (dc.section) return dc
    changed = true
    const c = byId.get(dc.id)
    return { ...dc, section: c ? inferSection(c) : ('main' as DeckSection) }
  })
  return changed ? { ...d, cards } : d
}

function printScore(c: Card): number {
  let s = 0
  if (c.signed) s -= 20
  if (c.overnumbered) s -= 10
  if (c.altArt) s -= 5
  if ((c.types || []).includes('Token') || (c.superTypes || []).includes('Token')) s -= 8
  return s
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Prefer base print (non-signed / non-ON / non-alt). */
export function matchCardByName(cards: Card[], rawName: string): Card | undefined {
  const cleaned = rawName.trim()
  if (!cleaned) return undefined
  const nClean = norm(cleaned)
  const comma = cleaned.indexOf(',')
  const left = comma >= 0 ? cleaned.slice(0, comma).trim() : cleaned
  const right = comma >= 0 ? cleaned.slice(comma + 1).trim() : ''
  const nLeft = norm(left)
  const nRight = right ? norm(right) : ''

  const scored: { c: Card; score: number }[] = []
  for (const c of cards) {
    const cn = norm(c.name)
    const cs = c.subtitle ? norm(c.subtitle) : ''
    const disp = norm(displayCardName(c))
    let hit = 0
    if (disp === nClean) hit = 100
    else if (nRight && cn === nLeft && cs === nRight) hit = 95
    else if (nRight && cn === nRight) hit = 90
    else if (nRight && cn === nLeft && cs && cs.includes(nRight)) hit = 85
    else if (!nRight && cn === nLeft) hit = 80
    else if (nRight && cs === nRight && cn.includes(nLeft)) hit = 70
    else continue
    scored.push({ c, score: hit + printScore(c) })
  }
  if (!scored.length) return undefined
  scored.sort((a, b) => b.score - a.score)
  return scored[0].c
}

export type ImportLine = { section: DeckSection; qty: number; name: string; card?: Card; unmatched?: boolean }
export type ImportResult = {
  cards: DeckCard[]
  lines: ImportLine[]
  unmatched: string[]
}

export function parseDeckImport(text: string, cards: Card[]): ImportResult {
  let section: DeckSection = 'main'
  const lines: ImportLine[] = []
  const unmatched: string[] = []
  const acc = new Map<string, DeckCard>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    const header = line.replace(/:$/, '').trim().toLowerCase()
    if (SECTION_HEADER[header]) {
      section = SECTION_HEADER[header]
      continue
    }

    const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/) || line.match(/^(\d+)\s+(.+)$/)
    if (!m) {
      const card = matchCardByName(cards, line)
      if (!card) {
        unmatched.push(line)
        lines.push({ section, qty: 1, name: line, unmatched: true })
        continue
      }
      const key = `${card.id}|${section}`
      const prev = acc.get(key)
      acc.set(key, { id: card.id, qty: (prev?.qty || 0) + 1, section })
      lines.push({ section, qty: 1, name: line, card })
      continue
    }

    const qty = Math.max(1, Number(m[1]) || 1)
    const name = m[2].trim()
    const card = matchCardByName(cards, name)
    if (!card) {
      unmatched.push(`${qty} ${name}`)
      lines.push({ section, qty, name, unmatched: true })
      continue
    }
    const key = `${card.id}|${section}`
    const prev = acc.get(key)
    acc.set(key, { id: card.id, qty: (prev?.qty || 0) + qty, section })
    lines.push({ section, qty, name, card })
  }

  return { cards: [...acc.values()], lines, unmatched }
}


export function sectionCount(cards: DeckCard[], section: DeckSection) {
  return cards.filter((c) => sectionOf(c) === section).reduce((s, c) => s + c.qty, 0)
}

export function deckTotalQtyById(cards: DeckCard[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const dc of cards) {
    m.set(dc.id, (m.get(dc.id) || 0) + dc.qty)
  }
  return m
}
