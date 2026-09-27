import type { Deck, DeckCard } from './types'
import { sectionOf } from './deckHelpers'

/** Opening hand size (Riftbound CR / InkSight consensus). */
export const OPENING_HAND_SIZE = 4

/** Max cards bottomed in a single mulligan. */
export const MULLIGAN_MAX = 2

/** Sections that form the draw library (Main + Champion only). */
export const DRAW_POOL_SECTIONS = new Set(['main', 'champion'] as const)

/** Expand Main Deck + Champion by qty into a multiset of card ids. */
export function buildDrawPool(cards: DeckCard[]): string[] {
  const pool: string[] = []
  for (const dc of cards) {
    const sec = sectionOf(dc)
    if (sec !== 'main' && sec !== 'champion') continue
    const n = Math.max(0, Math.floor(dc.qty) || 0)
    for (let i = 0; i < n; i++) pool.push(dc.id)
  }
  return pool
}

export function drawPoolSize(deck: Deck): number {
  return buildDrawPool(deck.cards).length
}

/** Fisher–Yates in place; returns the same array. */
export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

export function shuffleCopy<T>(arr: readonly T[]): T[] {
  return shuffleInPlace([...arr])
}

export type DealResult = {
  hand: string[]
  library: string[]
}

/** Shuffle the draw pool and deal an opening hand of OPENING_HAND_SIZE. */
export function dealOpeningHand(cards: DeckCard[]): DealResult | null {
  const pool = buildDrawPool(cards)
  if (pool.length < OPENING_HAND_SIZE) return null
  const shuffled = shuffleCopy(pool)
  const hand = shuffled.slice(0, OPENING_HAND_SIZE)
  const library = shuffled.slice(OPENING_HAND_SIZE)
  return { hand, library }
}

/**
 * Mulligan: put selected hand indices on the bottom of the remaining library
 * in random order, then draw that many replacements from the top.
 * One mulligan per deal — caller enforces mulliganUsed.
 */
export function applyMulligan(
  hand: string[],
  library: string[],
  selectedIndices: number[],
): DealResult | null {
  const unique = [...new Set(selectedIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < hand.length)
    .sort((a, b) => a - b)
  if (unique.length < 1 || unique.length > MULLIGAN_MAX) return null
  if (unique.length > library.length) return null

  const bottomed: string[] = []
  const keep: string[] = []
  for (let i = 0; i < hand.length; i++) {
    if (unique.includes(i)) bottomed.push(hand[i]!)
    else keep.push(hand[i]!)
  }

  const nextLib = [...library]
  const drawn = nextLib.splice(0, bottomed.length)
  const bottom = shuffleCopy(bottomed)
  nextLib.push(...bottom)

  return { hand: [...keep, ...drawn], library: nextLib }
}

/** Informational rune channel counts for T1 (and optional T2–T3 note). */
export function runeChannelsForSeat(goingSecond: boolean): { t1: number; note: string } {
  // Both players channel 2 on T1; second player channels +1 extra (3 total).
  const t1 = goingSecond ? 3 : 2
  return { t1, note: goingSecond ? '2+1' : '2' }
}
