export type Card = {
  id: string
  name: string
  code: string
  cn: number
  set: string
  setName: string
  types: string[]
  rarity: string | null
  domains: string[]
  energy: number | null
  might: number | null
  image: string | null
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
