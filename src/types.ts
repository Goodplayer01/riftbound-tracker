export type Card = {
  id: string
  name: string
  subtitle?: string | null
  code: string
  cn: number
  set: string
  setName: string
  types: string[]
  superTypes?: string[]
  rarity: string | null
  domains: string[]
  energy: number | null
  might: number | null
  image: string | null
  signed?: boolean
  overnumbered?: boolean
  altArt?: boolean
  tags?: string[]
  /** Official EN rules text when baked from Riot gallery; null = unknown / use OCR. */
  rulesText?: string | null
}

export type Owned = { qty: number; foil: number }

export type DeckSection = 'legend' | 'champion' | 'main' | 'battlefield' | 'rune' | 'sideboard'

export type DeckCard = { id: string; qty: number; section?: DeckSection }

export type Deck = {
  id: string
  name: string
  cards: DeckCard[]
  updatedAt: string
}

export type Catalog = { sets: Record<string, string>; cards: Card[] }

export type PriceEntry = {
  low: number | null
  high?: number | null
  avg30?: number | null
  trend: number | null
  foilLow: number | null
  foilTrend: number | null
  cmId: string
  cmUrl?: string | null
}

export type PriceBook = {
  updatedAt: string
  currency: string
  source: string
  cards: Record<string, PriceEntry>
}

/** Flat card entry for a lent-out stack (no deck sections). */
export type BorrowedCard = { id: string; qty: number }

/** Group of cards lent to one borrower (accordion like decks). */
export type BorrowedGroup = {
  id: string
  name: string
  cards: BorrowedCard[]
  updatedAt: string
}
