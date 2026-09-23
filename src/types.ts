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
}

export type Owned = { qty: number; foil: number }

export type DeckCard = { id: string; qty: number }

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
