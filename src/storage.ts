import { cleanCopyBook, type CopyBook } from './copies'
import { cleanSoldLog, type SoldEntry } from './soldLog'
import type { BorrowedGroup, Deck, Owned } from './types'

const COLLECTION_KEY = 'rb.collection.v1'
const DECKS_KEY = 'rb.decks.v1'
const BORROWED_KEY = 'rb.borrowed.v1'
const WISH_KEY = 'rb.wishlist.v1'

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

export function loadWish(): Collection {
  return readJson(WISH_KEY, {})
}

export function saveWish(w: Collection) {
  writeJson(WISH_KEY, w)
}

const SALES_KEY = 'rb.sales.v1'

export function loadSales(): Record<string, number> {
  return readJson(SALES_KEY, {})
}

export function saveSales(s: Record<string, number>) {
  writeJson(SALES_KEY, s)
}

/** What each cart card is listed for on Cardmarket, per copy: `{ [cardId]: eur }`. */
const SALE_ASKS_KEY = 'rb.saleAsks.v1'

export function loadSaleAsks(): Record<string, number> {
  return readJson(SALE_ASKS_KEY, {})
}

export function saveSaleAsks(s: Record<string, number>) {
  writeJson(SALE_ASKS_KEY, s)
}

/** Every sale with what came in and what the copies cost (`src/soldLog.ts`). */
const SOLD_LOG_KEY = 'rb.soldLog.v1'

export function loadSoldLog(): SoldEntry[] {
  return cleanSoldLog(readJson(SOLD_LOG_KEY, []))
}

export function saveSoldLog(s: SoldEntry[]) {
  writeJson(SOLD_LOG_KEY, s)
}

const COPIES_KEY = 'rb.copies.v1'

/** Language, condition and purchase price per copy. Separate from rb.collection.v1 so older
 *  versions keep reading the collection unchanged. */
export function loadCopies(): CopyBook {
  return cleanCopyBook(readJson<unknown>(COPIES_KEY, {}))
}

export function saveCopies(c: CopyBook) {
  writeJson(COPIES_KEY, c)
}

const WISH_TARGET_KEY = 'rb.wishTargets.v1'

/** Price alert per wishlist card: alert when the price is at or below this many euros per copy. */
export function loadWishTargets(): Record<string, number> {
  const raw = readJson<Record<string, unknown>>(WISH_TARGET_KEY, {})
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(raw || {})) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) out[id] = n
  }
  return out
}

export function saveWishTargets(t: Record<string, number>) {
  writeJson(WISH_TARGET_KEY, t)
}

const ALERT_SEEN_KEY = 'rb.wishAlertsSeen.v1'

/** Price per card at the last alert the user saw, so the same hit only notifies once. */
export function loadAlertsSeen(): Record<string, number> {
  return readJson(ALERT_SEEN_KEY, {})
}

export function saveAlertsSeen(s: Record<string, number>) {
  writeJson(ALERT_SEEN_KEY, s)
}

const BACKUP_KEY = 'rb.backup.v1'

/** One time copy of the raw collection and wishlist before the first start with per copy details.
 *  Never overwritten, so a bad update can always be rolled back by hand. */
export function backupOnce() {
  try {
    if (localStorage.getItem(BACKUP_KEY)) return
    localStorage.setItem(BACKUP_KEY, JSON.stringify({
      at: new Date().toISOString(),
      collection: localStorage.getItem(COLLECTION_KEY),
      wishlist: localStorage.getItem(WISH_KEY),
    }))
  } catch {
    // Quota full: skip, nothing gets changed in the collection anyway.
  }
}
