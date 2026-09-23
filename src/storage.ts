import type { Deck, Owned } from './types'

const COLLECTION_KEY = 'rb.collection.v1'
const DECKS_KEY = 'rb.decks.v1'

export type Collection = Record<string, Owned>

export function loadCollection(): Collection {
  try {
    return JSON.parse(localStorage.getItem(COLLECTION_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveCollection(c: Collection) {
  localStorage.setItem(COLLECTION_KEY, JSON.stringify(c))
}

export function loadDecks(): Deck[] {
  try {
    return JSON.parse(localStorage.getItem(DECKS_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveDecks(d: Deck[]) {
  localStorage.setItem(DECKS_KEY, JSON.stringify(d))
}
