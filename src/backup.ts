/** Full backup of everything the app keeps in localStorage, as one JSON file. */

export const BACKUP_APP = 'deakrix-riftbound-tracker'
export const BACKUP_FORMAT = 1

/** Caches reload by themselves, the CardTrader token is personal, rb.backup.* are the app's own snapshots. */
const SKIP = /^rb\.(prices\.|cardtrader\.|backup\.)/
/** Keys that hold a plain string instead of JSON. */
const PLAIN = new Set(['riftbound-lang', 'riftbound-hide-nexus-night', 'rb.storeHome.v1', 'rb.poolHidden'])

export function isBackupKey(key: string) {
  return (key.startsWith('rb.') || key.startsWith('riftbound-')) && !SKIP.test(key)
}

/** Values are the raw stored strings, so a restore writes back exactly what was there. */
export type BackupFile = { app: string; format: number; at: string; version: string; data: Record<string, string> }

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>

function backupKeys(store: Store) {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k && isBackupKey(k)) keys.push(k)
  }
  return keys
}

export function makeBackup(store: Store, version: string, at = new Date()): BackupFile {
  const data: Record<string, string> = {}
  for (const k of backupKeys(store)) data[k] = store.getItem(k) ?? ''
  return { app: BACKUP_APP, format: BACKUP_FORMAT, at: at.toISOString(), version, data }
}

export type BackupError = 'invalid' | 'newer'

/** Checks a file before anything gets overwritten: our app, a known format, only our keys, readable values. */
export function parseBackup(text: string): BackupFile | BackupError {
  let b: unknown
  try {
    b = JSON.parse(text)
  } catch {
    return 'invalid'
  }
  if (!b || typeof b !== 'object') return 'invalid'
  const f = b as Partial<BackupFile>
  if (f.app !== BACKUP_APP || typeof f.format !== 'number' || !f.data || typeof f.data !== 'object' || Array.isArray(f.data)) return 'invalid'
  if (f.format > BACKUP_FORMAT) return 'newer'
  const entries = Object.entries(f.data)
  if (!entries.length) return 'invalid'
  for (const [k, v] of entries) {
    if (!isBackupKey(k) || typeof v !== 'string') return 'invalid'
    if (!PLAIN.has(k)) {
      try {
        JSON.parse(v)
      } catch {
        return 'invalid'
      }
    }
  }
  return { app: BACKUP_APP, format: f.format, at: String(f.at ?? ''), version: String(f.version ?? ''), data: f.data as Record<string, string> }
}

export type BackupSummary = { cards: number; copies: number; decks: number; wish: number; sales: number; borrowed: number }

function json(data: Record<string, string>, key: string): unknown {
  try {
    return JSON.parse(data[key] ?? 'null')
  } catch {
    return null
  }
}

const size = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0)

/** `skip` leaves out cards the app does not track (plain runes), so the numbers match the sidebar. */
export function summarizeBackup(b: BackupFile, skip: (id: string) => boolean = () => false): BackupSummary {
  let cards = 0
  let copies = 0
  const col = json(b.data, 'rb.collection.v1')
  if (col && typeof col === 'object') {
    for (const [id, o] of Object.entries(col as Record<string, { qty?: number; foil?: number }>)) {
      const n = (Number(o?.qty) || 0) + (Number(o?.foil) || 0)
      if (n > 0 && !skip(id)) {
        cards++
        copies += n
      }
    }
  }
  return {
    cards,
    copies,
    decks: size(json(b.data, 'rb.decks.v1')),
    wish: size(json(b.data, 'rb.wishlist.v1')),
    sales: size(json(b.data, 'rb.sales.v1')),
    borrowed: size(json(b.data, 'rb.borrowed.v1')),
  }
}

/** Nothing the user entered: no cards, decks, wishlist, sales or borrowed lists. */
export function isEmptyBackup(b: BackupFile) {
  return Object.values(summarizeBackup(b)).every((n) => n === 0)
}

/** Replaces everything: our keys missing from the file are removed, the rest is written as stored. */
export function restoreBackup(store: Store, b: BackupFile) {
  for (const k of backupKeys(store)) if (!(k in b.data)) store.removeItem(k)
  for (const [k, v] of Object.entries(b.data)) store.setItem(k, v)
}
