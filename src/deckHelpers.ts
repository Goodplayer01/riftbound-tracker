import type { Card, Deck, DeckCard, DeckSection } from './types'
import { loadLang, t } from './i18n'

export const SECTION_ORDER: DeckSection[] = [
  'legend',
  'champion',
  'main',
  'battlefield',
  'sideboard',
  'rune',
]

const NAME_COPY_SECTIONS: DeckSection[] = ['champion', 'main', 'sideboard']
const NAME_COPY_LIMIT = 3
const BATTLEFIELD_NAME_COPY_LIMIT = 1

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
  'rune pool': 'rune',
  runepool: 'rune',
  'rune deck': 'rune',
  runedeck: 'rune',
  'runen pool': 'rune',
  runenpool: 'rune',
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
  const id = c.id.toLowerCase()
  const code = c.code.toLowerCase()
  const set = c.set.toLowerCase()
  // Imports should resolve to the ordinary numbered print, not promos or
  // special-set rows that happen to share the same display name.
  if (set.endsWith('-nn')) s -= 30
  if (/(?:-p|-top8|-champion)$/.test(id) || /(?:-p|-top8|-champion)$/.test(code)) s -= 30
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
export function matchCardByName(cards: Card[], rawName: string, section?: DeckSection): Card | undefined {
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
    const sectionBonus = section && cardFitsSection(c, section) ? 60 : 0
    scored.push({ c, score: hit + sectionBonus + printScore(c) })
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
      const card = matchCardByName(cards, line, section)
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
    const card = matchCardByName(cards, name, section)
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

/** Sections that require exactly one Legend before building (Battlefields exempt). */
export const SECTIONS_NEED_LEGEND: DeckSection[] = ['champion', 'main', 'sideboard', 'rune']

export function sectionNeedsLegend(section: DeckSection): boolean {
  return SECTIONS_NEED_LEGEND.includes(section)
}

/** True if card has no real domain / only Colorless (Battlefields etc.). */
export function isColorlessCard(c: Card): boolean {
  const domains = c.domains || []
  if (domains.length === 0) return true
  return domains.every((d) => d === 'Colorless')
}

/** Non-Colorless domains that must be covered by Legend identity (103.1.b). */
export function cardDomainIdentity(c: Card): string[] {
  return (c.domains || []).filter((d) => d && d !== 'Colorless')
}

/**
 * Official Domain Identity (103.1.b.3–4): every non-Colorless domain on the card
 * must be included in the Legend's domains. Colorless cards always match.
 */
export function cardMatchesLegendDomains(c: Card, legendDomains: string[]): boolean {
  if (isColorlessCard(c)) return true
  const cardDoms = cardDomainIdentity(c)
  if (cardDoms.length === 0) return true
  return cardDoms.every((d) => legendDomains.includes(d))
}

/** Domains of the deck's Legend (first legend entry), or null if none. */
export function getLegendDomains(deckCards: DeckCard[], byId: Map<string, Card>): string[] | null {
  const legendEntry = deckCards.find((dc) => sectionOf(dc) === 'legend')
  if (!legendEntry) return null
  const c = byId.get(legendEntry.id)
  if (!c) return null
  return cardDomainIdentity(c)
}

export function hasLegend(deckCards: DeckCard[]): boolean {
  return sectionCount(deckCards, 'legend') >= 1
}

/** Sections with hard cap 1 (qty steppers → trash; hide Add when full). */
export function isSingleSlotSection(section: DeckSection): boolean {
  return SECTION_CAPS[section] === 1
}

/**
 * Non-Colorless domains already present in Champion/Main/Sideboard/Runes.
 * A replacement Legend must cover all of these. Empty → any Legend OK
 * (Colorless-only leftovers, Battlefields-only, or empty gated sections).
 */
export function requiredDomainsFromDeck(deckCards: DeckCard[], byId: Map<string, Card>): string[] {
  const set = new Set<string>()
  for (const dc of deckCards) {
    const sec = sectionOf(dc)
    if (!sectionNeedsLegend(sec)) continue
    const c = byId.get(dc.id)
    if (!c) continue
    for (const d of cardDomainIdentity(c)) set.add(d)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** True when Legend is missing but gated sections still hold cards (swap / re-pick). */
export function isLegendSwapState(deckCards: DeckCard[]): boolean {
  if (hasLegend(deckCards)) return false
  return SECTIONS_NEED_LEGEND.some((sec) => sectionCount(deckCards, sec) > 0)
}

/** Legend card domains include every required deck domain. */
export function legendCoversRequiredDomains(legend: Card, required: string[]): boolean {
  if (required.length === 0) return true
  const legendDoms = cardDomainIdentity(legend)
  return required.every((d) => legendDoms.includes(d))
}

export function legendSwapBlockMessage(required: string[]): string {
  const lang = loadLang()
  if (required.length === 0) return t(lang, 'deck.legendSwapAny')
  return t(lang, 'deck.legendSwapDomains', { domains: required.join(', ') })
}

export type AddBlockReason = 'type' | 'legend' | 'domain' | 'cap' | 'copies'

export type CanAddResult = { ok: true } | { ok: false; reason: AddBlockReason; message: string }

/** Hard gate: type fit, Legend-first (except Battlefields), domain identity, section cap. */
export function canAddToSection(
  deckCards: DeckCard[],
  card: Card,
  section: DeckSection,
  byId: Map<string, Card>,
  qtyToAdd = 1,
): CanAddResult {
  const lang = loadLang()
  if (!cardFitsSection(card, section)) {
    return { ok: false, reason: 'type', message: t(lang, 'deck.typeMismatch') }
  }
  const needsLeg = sectionNeedsLegend(section)
  if (needsLeg && !hasLegend(deckCards)) {
    return { ok: false, reason: 'legend', message: t(lang, 'deck.needLegend') }
  }
  if (needsLeg) {
    const legendDomains = getLegendDomains(deckCards, byId)
    if (legendDomains && !cardMatchesLegendDomains(card, legendDomains)) {
      return { ok: false, reason: 'domain', message: t(lang, 'deck.domainMismatch') }
    }
  }
  // Replacement Legend must cover domains already used in gated sections
  if (section === 'legend') {
    const required = requiredDomainsFromDeck(deckCards, byId)
    if (!legendCoversRequiredDomains(card, required)) {
      return { ok: false, reason: 'domain', message: legendSwapBlockMessage(required) }
    }
  }
  const count = sectionCount(deckCards, section)
  const cap = SECTION_CAPS[section]
  if (count + qtyToAdd > cap) {
    return { ok: false, reason: 'cap', message: t(lang, 'deck.capReached', { cap, section: SECTION_LABEL[section] }) }
  }

  // The three-copy pool is shared by Champion, Main Deck and Sideboard.
  // Runes are intentionally excluded: they have their own 12-card cap.
  if (NAME_COPY_SECTIONS.includes(section)) {
    const name = norm(card.name)
    const currentNameQty = deckCards.reduce((sum, dc) => {
      const dcSection = sectionOf(dc)
      if (!NAME_COPY_SECTIONS.includes(dcSection)) return sum
      const c = byId.get(dc.id)
      return c && norm(c.name) === name ? sum + dc.qty : sum
    }, 0)
    if (currentNameQty + qtyToAdd > NAME_COPY_LIMIT) {
      return { ok: false, reason: 'copies', message: t(lang, 'deck.copyLimit', { name: card.name }) }
    }
  }

  // Battlefields have a section cap of three, but only one copy of each
  // battlefield name is allowed.
  if (section === 'battlefield') {
    const name = norm(card.name)
    const currentNameQty = deckCards.reduce((sum, dc) => {
      if (sectionOf(dc) !== 'battlefield') return sum
      const c = byId.get(dc.id)
      return c && norm(c.name) === name ? sum + dc.qty : sum
    }, 0)
    if (currentNameQty + qtyToAdd > BATTLEFIELD_NAME_COPY_LIMIT) {
      return { ok: false, reason: 'copies', message: t(lang, 'deck.battlefieldCopyLimit', { name: card.name }) }
    }
  }

  return { ok: true }
}

export type SanitizeResult = {
  cards: DeckCard[]
  trimmed: number
  copyRemoved: number
  battlefieldRemoved: number
  domainRemoved: number
  notice: string | null
}

/**
 * Trim excess beyond section caps and strip Champion/Main/Sideboard/Runes
 * that violate Legend domain identity. Battlefields are never domain-filtered.
 */
export function sanitizeDeckCards(deckCards: DeckCard[], byId: Map<string, Card>): SanitizeResult {
  let trimmed = 0
  let copyRemoved = 0
  let battlefieldRemoved = 0
  let domainRemoved = 0

  // 1) Cap trim per section (preserve order)
  const bySec = new Map<DeckSection, DeckCard[]>()
  for (const sec of SECTION_ORDER) bySec.set(sec, [])
  for (const dc of deckCards) {
    const sec = sectionOf(dc)
    const list = bySec.get(sec) || []
    list.push({ ...dc, section: sec })
    bySec.set(sec, list)
  }

  const capped: DeckCard[] = []
  for (const sec of SECTION_ORDER) {
    const list = bySec.get(sec) || []
    let remaining = SECTION_CAPS[sec]
    for (const dc of list) {
      if (remaining <= 0) {
        trimmed += dc.qty
        continue
      }
      if (dc.qty <= remaining) {
        capped.push(dc)
        remaining -= dc.qty
      } else {
        trimmed += dc.qty - remaining
        capped.push({ ...dc, qty: remaining })
        remaining = 0
      }
    }
  }

  // 2) Trim duplicate names across the shared card pool. Keep the existing
  // order so imported/legacy decks are repaired deterministically.
  const copyNameQty = new Map<string, number>()
  const battlefieldNameQty = new Map<string, number>()
  const nameCapped: DeckCard[] = []
  for (const dc of capped) {
    const sec = sectionOf(dc)
    const limit = NAME_COPY_SECTIONS.includes(sec)
      ? NAME_COPY_LIMIT
      : sec === 'battlefield' ? BATTLEFIELD_NAME_COPY_LIMIT : null
    if (limit == null) {
      nameCapped.push(dc)
      continue
    }
    const c = byId.get(dc.id)
    if (!c) {
      nameCapped.push(dc)
      continue
    }
    const key = norm(c.name)
    const counts = sec === 'battlefield' ? battlefieldNameQty : copyNameQty
    const used = counts.get(key) || 0
    const keep = Math.max(0, Math.min(dc.qty, limit - used))
    const removed = dc.qty - keep
    if (removed > 0) {
      if (sec === 'battlefield') battlefieldRemoved += removed
      else copyRemoved += removed
    }
    if (keep > 0) {
      nameCapped.push(keep === dc.qty ? dc : { ...dc, qty: keep })
      counts.set(key, used + keep)
    }
  }

  // 3) Domain strip for gated sections when a Legend is present
  const legendDomains = getLegendDomains(nameCapped, byId)
  let afterDomain = nameCapped
  if (legendDomains && hasLegend(capped)) {
    afterDomain = []
    for (const dc of nameCapped) {
      const sec = sectionOf(dc)
      if (!sectionNeedsLegend(sec)) {
        afterDomain.push(dc)
        continue
      }
      const c = byId.get(dc.id)
      if (!c || cardMatchesLegendDomains(c, legendDomains)) {
        afterDomain.push(dc)
      } else {
        domainRemoved += dc.qty
      }
    }
  }

  const lang = loadLang()
  const parts: string[] = []
  if (trimmed > 0) {
    parts.push(t(lang, 'deck.sanitizedCap', { n: trimmed, plural: trimmed === 1 ? '' : (lang === 'de' ? 'n' : 's') }))
  }
  if (copyRemoved > 0) {
    parts.push(t(lang, 'deck.sanitizedCopies', { n: copyRemoved, plural: copyRemoved === 1 ? '' : (lang === 'de' ? 'n' : 's') }))
  }
  if (battlefieldRemoved > 0) {
    parts.push(t(lang, 'deck.sanitizedBattlefield', { n: battlefieldRemoved, plural: battlefieldRemoved === 1 ? '' : (lang === 'de' ? 'n' : 's') }))
  }
  if (domainRemoved > 0) {
    parts.push(t(lang, 'deck.sanitizedDomain', { n: domainRemoved, plural: domainRemoved === 1 ? '' : (lang === 'de' ? 'n' : 's') }))
  }
  const notice = parts.length ? parts.join(' · ') + '.' : null
  return { cards: afterDomain, trimmed, copyRemoved, battlefieldRemoved, domainRemoved, notice }
}


export function deckTotalQtyById(cards: DeckCard[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const dc of cards) {
    m.set(dc.id, (m.get(dc.id) || 0) + dc.qty)
  }
  return m
}
