import type { Deck, DeckCard } from './types'
import { sectionOf } from './deckHelpers.ts'

/** Opening hand size (Core Rules 116: players each draw 4). */
export const OPENING_HAND_SIZE = 4

/** Max cards set aside in the mulligan (Core Rules 117.1). */
export const MULLIGAN_MAX = 2

/** Sections that form the draw library (Main Deck only).
 * Champion starts face-up on the board and is never in the opening/draw pile.
 * Legend / Battlefield / Rune / Sideboard stay excluded. */
export const DRAW_POOL_SECTIONS = new Set(['main'] as const)

/** Expand one deck section by qty into a multiset of card ids. */
function expandSection(cards: DeckCard[], section: 'main' | 'rune'): string[] {
  const pool: string[] = []
  for (const dc of cards) {
    if (sectionOf(dc) !== section) continue
    const n = Math.max(0, Math.floor(dc.qty) || 0)
    for (let i = 0; i < n; i++) pool.push(dc.id)
  }
  return pool
}

/** Expand Main Deck by qty into a multiset of card ids (Champion excluded). */
export function buildDrawPool(cards: DeckCard[]): string[] {
  return expandSection(cards, 'main')
}

/** The Rune Deck as card ids, one per rune. */
export function buildRunePool(cards: DeckCard[]): string[] {
  return expandSection(cards, 'rune')
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

/** A test game: hand and Main Deck, plus the runes on the board and the rest of the Rune Deck. */
export type HandState = DealResult & {
  runes: string[]
  runeLibrary: string[]
  /** turns played so far; 0 = still in setup (mulligan allowed) */
  turn: number
}

/** Shuffle Main and Rune Deck and draw an opening hand of OPENING_HAND_SIZE (Core Rules 114, 116). */
export function dealOpeningHand(cards: DeckCard[]): HandState | null {
  const pool = buildDrawPool(cards)
  if (pool.length < OPENING_HAND_SIZE) return null
  const shuffled = shuffleCopy(pool)
  return {
    hand: shuffled.slice(0, OPENING_HAND_SIZE),
    library: shuffled.slice(OPENING_HAND_SIZE),
    runes: [],
    runeLibrary: shuffleCopy(buildRunePool(cards)),
    turn: 0,
  }
}

/** Runes channeled in one of your turns: 2 (Core Rules 431.4.a), plus 1 on your first turn when you go
 *  second (1v1, 487.7 / 488.7). */
export function runesToChannel(turn: number, goingFirst: boolean) {
  return 2 + (turn === 1 && !goingFirst ? 1 : 0)
}

/** Your next turn: Channel Phase, then Draw Phase (Core Rules 315.3, 315.4). In 1v1 the player going
 *  first draws on turn 1 too; only the 3 player modes skip that draw. */
export function playTurn(s: HandState, goingFirst: boolean): HandState {
  const turn = s.turn + 1
  const n = Math.min(runesToChannel(turn, goingFirst), s.runeLibrary.length)
  const draw = s.library.length ? 1 : 0
  return {
    hand: [...s.hand, ...s.library.slice(0, draw)],
    library: s.library.slice(draw),
    runes: [...s.runes, ...s.runeLibrary.slice(0, n)],
    runeLibrary: s.runeLibrary.slice(n),
    turn,
  }
}

/**
 * Mulligan (Core Rules 117): set aside up to 2 cards, draw as many, then recycle the set-aside cards
 * (bottom of the Main Deck, random order when several, 417.5). Once per game, before turn 1;
 * the caller enforces that.
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

  // The library already is the shuffled remainder. Draw replacements from its
  // top, then put the set-aside cards at the very bottom (randomized only
  // among themselves), so T1 draws cannot hit mulliganed cards.
  const nextLib = [...library]
  const drawn = nextLib.splice(0, bottomed.length)
  nextLib.push(...shuffleCopy(bottomed))

  return { hand: [...keep, ...drawn], library: nextLib }
}
