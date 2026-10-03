import type { BorrowedGroup, Deck, Owned } from './types'

const COLLECTION_KEY = 'rb.collection.v1'
const DECKS_KEY = 'rb.decks.v1'
const BORROWED_KEY = 'rb.borrowed.v1'

export type Collection = Record<string, Owned>

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadCollection(): Collection {
  return readJson(COLLECTION_KEY, {})
}

export function saveCollection(c: Collection) {
  writeJson(COLLECTION_KEY, c)
}

export function loadDecks(): Deck[] {
  return readJson(DECKS_KEY, [])
}

export function saveDecks(d: Deck[]) {
  writeJson(DECKS_KEY, d)
}

export function loadBorrowed(): BorrowedGroup[] {
  return readJson(BORROWED_KEY, [])
}

export function saveBorrowed(groups: BorrowedGroup[]) {
  writeJson(BORROWED_KEY, groups)
}
