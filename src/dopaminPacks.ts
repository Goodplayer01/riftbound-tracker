import type { Card, PriceEntry } from './types'

/**
 * Booster simulator. Pack layout from Riot's "The Radiance Overview" (same 14 cards in every set):
 * 7 commons, 3 uncommons, 1 token / rune / alt art rune, 1 foil (common to epic),
 * 1 rare or epic, 1 flex slot (rare, epic, alt art, overnumbered, signature, ultimate).
 */
export type PackRole = 'common' | 'uncommon' | 'token' | 'foil' | 'rare' | 'flex'

/** What makes a pull special, for the glow and the label. */
export type HitKind = '' | 'rare' | 'epic' | 'alt' | 'altrune' | 'over' | 'signed' | 'ultimate'

export type PackSlot = {
  card: Card
  foil: boolean
  role: PackRole
  hit: HitKind
  /** Chance of this exact printing in this slot. */
  chance: number
  /** True when Riot has not published the rate and the simulator uses an estimate. */
  estimate: boolean
}

export type Booster = { id: string; name: string; tint: string }

export const BOOSTERS: Booster[] = [
  { id: 'OGN', name: 'Origins', tint: '#7a3b2e' },
  { id: 'SFD', name: 'Spiritforged', tint: '#2c5878' },
  { id: 'UNL', name: 'Unleashed', tint: '#5a3478' },
  { id: 'VEN', name: 'Vendetta', tint: '#7a2430' },
  { id: 'RAD', name: 'Radiance', tint: '#8a6a32' },
]

/** Riot, "Collectability in Riftbound: Origins": Epic in about 1 of 4 packs, taking a rare slot. */
export const EPIC_RATE = 1 / 4
/** Riot: about 2 alt art champions per 24 pack display. */
export const ALT_RATE = 1 / 12
/** Riot: about 1 overnumbered card per 3 displays, 1 in 10 of them signed. */
export const OVER_RATE = 1 / 72
export const SIGNED_SHARE = 1 / 10
/** Ultimate Rare per pack: Radiance 0.025 % (Riot, "The Radiance Overview"), Unleashed under 0.1 %. */
export const ULTIMATE_RATE: Record<string, number> = { RAD: 0.00025, UNL: 0.001 }
/** Estimate: Riot only says "now and then" an alt art rune; about one per display. */
export const ALT_RUNE_RATE = 1 / 24
/** Estimate: Riot says the foil slot is common to epic but gives no split; weighted like the rest of the pack. */
const FOIL_WEIGHTS = { common: 7, uncommon: 3, rare: 2, epic: EPIC_RATE }

const has = (c: Card, tag: string) => (c.tags || []).includes(tag)
const isRune = (c: Card) => (c.types || []).includes('Rune')
const isToken = (c: Card) => (c.types || []).includes('Token') || (c.superTypes || []).includes('Token')
const isSigned = (c: Card) => !!c.signed || has(c, 'signed')
const isOver = (c: Card) => !!c.overnumbered || has(c, 'overnumbered')

function pools(cards: Card[], setId: string) {
  // Promos share the set code but never come in boosters.
  const inSet = cards.filter((c) => c.set === setId && !has(c, 'promo'))
  const base = (c: Card) => !c.altArt && !isOver(c) && !isSigned(c) && !isRune(c) && !isToken(c)
  return {
    commons: inSet.filter((c) => c.rarity === 'Common' && base(c)),
    uncommons: inSet.filter((c) => c.rarity === 'Uncommon' && base(c)),
    rares: inSet.filter((c) => c.rarity === 'Rare' && base(c)),
    epics: inSet.filter((c) => c.rarity === 'Epic' && base(c)),
    tokens: inSet.filter((c) => (isToken(c) || isRune(c)) && !c.altArt),
    altRunes: inSet.filter((c) => isRune(c) && c.altArt),
    alts: inSet.filter((c) => c.altArt && !isRune(c) && !isOver(c) && !isSigned(c)),
    overs: inSet.filter((c) => isOver(c) && !isSigned(c) && c.rarity !== 'Ultimate Rare'),
    signed: inSet.filter((c) => isSigned(c)),
    ultimates: inSet.filter((c) => c.rarity === 'Ultimate Rare'),
  }
}

type Pools = ReturnType<typeof pools>

function pick(pool: Card[], rng: () => number): Card {
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}

/** n different cards; repeats only when the pool is smaller than n. */
function take(pool: Card[], n: number, rng: () => number): Card[] {
  let bag: Card[] = []
  const out: Card[] = []
  for (let k = 0; k < n; k++) {
    if (!bag.length) bag = pool.slice()
    out.push(bag.splice(Math.min(bag.length - 1, Math.floor(rng() * bag.length)), 1)[0])
  }
  return out
}

export function boosterSets(cards: Card[]): Booster[] {
  return BOOSTERS.filter((s) => {
    const p = pools(cards, s.id)
    return p.commons.length > 0 && p.uncommons.length > 0 && p.tokens.length > 0 && p.rares.length > 0
  })
}

function rareSlot(p: Pools, rng: () => number): PackSlot {
  const epic = p.epics.length ? EPIC_RATE : 0
  if (rng() < epic) return { card: pick(p.epics, rng), foil: true, role: 'rare', hit: 'epic', chance: epic / p.epics.length, estimate: false }
  return { card: pick(p.rares, rng), foil: true, role: 'rare', hit: 'rare', chance: (1 - epic) / p.rares.length, estimate: false }
}

/** The flex slot: one roll, rarest outcome first; an empty pool falls through to a rare. */
function flexSlot(p: Pools, setId: string, rng: () => number): PackSlot {
  const tiers: [HitKind, Card[], number][] = [
    ['ultimate', p.ultimates, ULTIMATE_RATE[setId] || 0],
    ['signed', p.signed, OVER_RATE * SIGNED_SHARE],
    ['over', p.overs, OVER_RATE * (1 - SIGNED_SHARE)],
    ['alt', p.alts, ALT_RATE],
  ]
  const r = rng()
  let edge = 0
  let used = 0
  for (const [hit, pool, rate] of tiers) {
    if (!pool.length || !rate) continue
    used += rate
    if (r < (edge += rate)) {
      // Ultimate Rares come without foil, every other showcase printing is foil.
      return { card: pick(pool, rng), foil: hit !== 'ultimate', role: 'flex', hit, chance: rate / pool.length, estimate: false }
    }
  }
  return { card: pick(p.rares, rng), foil: true, role: 'flex', hit: 'rare', chance: (1 - used) / p.rares.length, estimate: false }
}

function tokenSlot(p: Pools, rng: () => number): PackSlot {
  const alt = p.altRunes.length ? ALT_RUNE_RATE : 0
  if (rng() < alt) return { card: pick(p.altRunes, rng), foil: true, role: 'token', hit: 'altrune', chance: alt / p.altRunes.length, estimate: true }
  return { card: pick(p.tokens, rng), foil: false, role: 'token', hit: '', chance: (1 - alt) / p.tokens.length, estimate: true }
}

function foilSlot(p: Pools, rng: () => number): PackSlot {
  const groups: [HitKind, Card[], number][] = (
    [['', p.commons, FOIL_WEIGHTS.common], ['', p.uncommons, FOIL_WEIGHTS.uncommon], ['rare', p.rares, FOIL_WEIGHTS.rare], ['epic', p.epics, FOIL_WEIGHTS.epic]] as [HitKind, Card[], number][]
  ).filter(([, pool]) => pool.length > 0)
  const total = groups.reduce((s, [, , w]) => s + w, 0)
  let r = rng() * total
  for (const [hit, pool, w] of groups) {
    if ((r -= w) < 0 || pool === groups[groups.length - 1][1]) {
      return { card: pick(pool, rng), foil: true, role: 'foil', hit, chance: w / total / pool.length, estimate: true }
    }
  }
  throw new Error('unreachable')
}

/** 14 cards in reveal order: bulk first, the best slots last. */
export function rollPack(cards: Card[], setId: string, rng: () => number = Math.random): PackSlot[] | null {
  const p = pools(cards, setId)
  if (!p.commons.length || !p.uncommons.length || !p.tokens.length || !p.rares.length) return null
  const bulk = (role: 'common' | 'uncommon', pool: Card[], n: number): PackSlot[] =>
    take(pool, n, rng).map((card) => ({ card, foil: false, role, hit: '', chance: Math.min(1, n / pool.length), estimate: false }))
  return [
    ...bulk('common', p.commons, 7),
    ...bulk('uncommon', p.uncommons, 3),
    tokenSlot(p, rng),
    foilSlot(p, rng),
    rareSlot(p, rng),
    flexSlot(p, setId, rng),
  ]
}

/** Value of one pulled card at the Cardmarket trend (the low is often a 0.02 € junk listing): foil trend for foils. */
export function slotValue(slot: Pick<PackSlot, 'foil'>, p?: PriceEntry): number | null {
  if (!p) return null
  const v = slot.foil ? (p.foilTrend || p.trend || p.foilLow || p.low) : (p.trend || p.low)
  return v ?? null
}
