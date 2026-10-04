import type { Card } from './types'

export type PackRole = 'common' | 'uncommon' | 'foil' | 'token' | 'high'

export type PackSlot = { card: Card; foil: boolean; role: PackRole }

export type Booster = { id: string; name: string; tint: string }

export const BOOSTERS: Booster[] = [
  { id: 'OGN', name: 'Origins', tint: '#7a3b2e' },
  { id: 'SFD', name: 'Spiritforged', tint: '#2c5878' },
  { id: 'UNL', name: 'Unleashed', tint: '#5a3478' },
  { id: 'VEN', name: 'Vendetta', tint: '#7a2430' },
  { id: 'RAD', name: 'Radiance', tint: '#8a6a32' },
]

function isToken(c: Card) {
  return (c.types || []).includes('Token') || (c.superTypes || []).includes('Token')
}

function isRune(c: Card) {
  return (c.types || []).includes('Rune')
}

function isShowcase(c: Card) {
  return c.rarity === 'Showcase' || (c.tags || []).includes('showcase')
}

function isSignature(c: Card) {
  return !!c.signed || (c.superTypes || []).includes('Signature')
}

/** Commons / uncommons eligible for the 7, the 3, and the foil slot. */
function bulkOk(c: Card) {
  return !c.signed && !c.overnumbered && !isShowcase(c) && !isToken(c) && !isRune(c) && !(c.tags || []).includes('promo')
}

/** Rares / epics: no alt, overnumber, or signature. */
function highOk(c: Card) {
  return !c.altArt && !c.overnumbered && !isSignature(c)
}

function pools(cards: Card[], setId: string) {
  const inSet = cards.filter((c) => c.set === setId)
  return {
    commons: inSet.filter((c) => c.rarity === 'Common' && bulkOk(c)),
    uncommons: inSet.filter((c) => c.rarity === 'Uncommon' && bulkOk(c)),
    tokens: inSet.filter((c) => (isToken(c) || isRune(c)) && !c.altArt),
    rares: inSet.filter((c) => c.rarity === 'Rare' && highOk(c)),
    epics: inSet.filter((c) => c.rarity === 'Epic' && highOk(c)),
  }
}

function take(pool: Card[], n: number, rng: () => number): Card[] {
  const bag = pool.slice()
  const out: Card[] = []
  for (let k = 0; k < n; k++) {
    if (!bag.length) {
      // ponytail: refill when the pool is shorter than the slot; duplicates instead of a crash
      for (const c of pool) bag.push(c)
    }
    let j = Math.floor(rng() * bag.length)
    if (j >= bag.length) j = bag.length - 1
    out.push(bag.splice(j, 1)[0])
  }
  return out
}

export function boosterSets(cards: Card[]): Booster[] {
  return BOOSTERS.filter((s) => {
    const p = pools(cards, s.id)
    return p.commons.length > 0 && p.uncommons.length > 0 && p.tokens.length > 0 && p.rares.length > 0
  })
}

/** Chance this printing shows in its slot group. Draws are uniform; k from n is k/n (capped at 1 when the pool refills). */
function groupChance(draw: number, pool: number) {
  if (pool <= 0) return null
  return Math.min(1, draw / pool)
}

/** Prior used by rollPack for this exact printing in this slot. Not a Riot rate. */
export function pullChance(cards: Card[], setId: string, slot: PackSlot): number | null {
  const p = pools(cards, setId)
  if (slot.role === 'common') return groupChance(7, p.commons.length)
  if (slot.role === 'uncommon') return groupChance(3, p.uncommons.length)
  if (slot.role === 'token') return groupChance(1, p.tokens.length)
  if (slot.role === 'foil') return groupChance(1, p.commons.length + p.uncommons.length)
  if (setId === 'OGN' && slot.card.rarity === 'Epic') return p.epics.length ? (1 / 4) / p.epics.length : null
  if (setId === 'RAD' && (slot.card.id === 'rad-164-ur' || slot.card.rarity === 'Ultimate Rare')) return 0.00025
  const rares = p.rares.length
  if (!rares) return null
  if (setId === 'OGN' && p.epics.length) return Math.min(1, 1.75 / rares)
  if (setId === 'RAD') return Math.min(1, (2 - 0.00025) / rares)
  return groupChance(2, rares)
}

/** 14 cards, front to back. OGN epic 1/4 replaces the first high slot. RAD ultimate 0.00025 replaces the second. */
export function rollPack(cards: Card[], setId: string, rng: () => number = Math.random): PackSlot[] | null {
  const p = pools(cards, setId)
  if (!p.commons.length || !p.uncommons.length || !p.tokens.length || !p.rares.length) return null
  const highs = take(p.rares, 2, rng).map((card) => ({ card, foil: true, role: 'high' as const }))
  if (setId === 'OGN' && p.epics.length && rng() < 1 / 4) {
    highs[0] = { card: take(p.epics, 1, rng)[0], foil: true, role: 'high' }
  }
  if (setId === 'RAD' && rng() < 0.00025) {
    const ur = cards.find((c) => c.id === 'rad-164-ur') || cards.find((c) => c.set === 'RAD' && c.rarity === 'Ultimate Rare')
    if (ur) highs[1] = { card: ur, foil: false, role: 'high' }
  }
  return [
    ...take(p.commons, 7, rng).map((card) => ({ card, foil: false, role: 'common' as const })),
    ...take(p.uncommons, 3, rng).map((card) => ({ card, foil: false, role: 'uncommon' as const })),
    ...take(p.tokens, 1, rng).map((card) => ({ card, foil: false, role: 'token' as const })),
    ...take([...p.commons, ...p.uncommons], 1, rng).map((card) => ({ card, foil: true, role: 'foil' as const })),
    ...highs,
  ]
}
