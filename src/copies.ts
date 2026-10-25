import { BOOSTERS_PER_DISPLAY } from './displays.ts'
import type { Owned, PriceEntry } from './types'

/** Every Riftbound booster holds 14 cards (Riot's set overviews). */
export const CARDS_PER_BOOSTER = 14

/** Print languages a copy can have, in Cardmarket's order. */
export const CARD_LANGS = ['EN', 'DE', 'FR', 'IT', 'ES', 'PT', 'ZH', 'JA', 'KO'] as const
export type CardLang = (typeof CARD_LANGS)[number]

/** Cardmarket conditions, best first. */
export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'] as const
export type Condition = (typeof CONDITIONS)[number]

/** Rough share of the NM price per condition. The price guide has no per condition
 *  prices, so worse copies are an estimate with the usual Cardmarket discounts. */
export const CONDITION_FACTOR: Record<Condition, number> = { MT: 1, NM: 1, EX: 0.85, GD: 0.7, LP: 0.6, PL: 0.45, PO: 0.3 }

/** Language names as Cardmarket's stock CSV spells them. */
export const CM_LANGUAGE: Record<CardLang, string> = {
  EN: 'English',
  DE: 'German',
  FR: 'French',
  IT: 'Italian',
  ES: 'Spanish',
  PT: 'Portuguese',
  ZH: 'Simplified Chinese',
  JA: 'Japanese',
  KO: 'Korean',
}

export const DEFAULT_LANG: CardLang = 'EN'
export const DEFAULT_COND: Condition = 'NM'

/** Tracked cards per product, so each pulled card carries its share of the price. Plain runes are not
 *  tracked, so they are left out. Sources: retailer / Asmodee listings and the published deck lists.
 *  Pre-Rift kit: 5 boosters + 15 card mini precon + 1 promo. Box set (Proving Grounds): 4 decks of
 *  40 + Legend + Battlefield. Vault: 6 boosters + 3 tokens (36 basic runes). Precon: Legend + 40 + 3 Battlefields. */
export const PACK_CARDS = {
  booster: CARDS_PER_BOOSTER,
  display: BOOSTERS_PER_DISPLAY * CARDS_PER_BOOSTER,
  prerift: 5 * CARDS_PER_BOOSTER + 15 + 1,
  boxset: 4 * 42,
  vault: 6 * CARDS_PER_BOOSTER + 3,
  precon: 44,
} as const
export type PackKind = keyof typeof PACK_CARDS
export const PACK_KINDS = Object.keys(PACK_CARDS) as PackKind[]

/** The product a pulled copy came from, with what it cost (null: not entered yet). */
export type PackSource = { kind: PackKind; eur: number | null }

/** Some copies of one card that share foil, language, condition and purchase price per copy.
 *  `pulled`: opened from a pack, so there is no purchase price (buy stays null). With `pack` the copies
 *  cost their share of that pack (`lotCost`) and count in paid / profit, without it they stay out.
 *  Copies of a card without a lot are EN / NM with no purchase price. */
export type CopyLot = { id: string; foil: boolean; n: number; lang: CardLang; cond: Condition; buy: number | null; pulled?: boolean; pack?: PackSource }

/** One card's share of a pack: every card in it carries the same part of the price. */
export function packShare(pack: PackSource): number | null {
  return pack.eur == null ? null : pack.eur / PACK_CARDS[pack.kind]
}

/** What one copy of a lot cost: the purchase price, or for pulled copies their share of the pack. */
export function lotCost(l: CopyLot): number | null {
  return l.pulled ? (l.pack ? packShare(l.pack) : null) : l.buy
}

/** Lots per card id. Lives next to the collection; the counts in the collection stay the truth. */
export type CopyBook = Record<string, CopyLot[]>

/** One group of copies for value math: a lot, or the copies without details (lot undefined). */
export type CopyGroup = { foil: boolean; n: number; lang: CardLang; cond: Condition; buy: number | null; lot?: CopyLot }

function isLang(x: unknown): x is CardLang {
  return (CARD_LANGS as readonly unknown[]).includes(x)
}

function isCond(x: unknown): x is Condition {
  return (CONDITIONS as readonly unknown[]).includes(x)
}

/** Drops anything malformed from a stored book (hand edits, older formats). */
export function cleanCopyBook(raw: unknown): CopyBook {
  const out: CopyBook = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, lots] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(lots)) continue
    const ok: CopyLot[] = []
    for (const l of lots as Partial<CopyLot>[]) {
      const n = Math.floor(Number(l?.n))
      if (!l || !(n > 0)) continue
      const buy = l.buy == null ? null : Number(l.buy)
      const pulled = l.pulled === true
      const kind = l.pack?.kind
      const packEur = l.pack?.eur == null ? null : Number(l.pack.eur)
      const pack: PackSource | null = pulled && PACK_KINDS.includes(kind as PackKind)
        ? { kind: kind as PackKind, eur: packEur != null && Number.isFinite(packEur) && packEur >= 0 ? packEur : null }
        : null
      ok.push({
        id: typeof l.id === 'string' && l.id ? l.id : crypto.randomUUID(),
        foil: !!l.foil,
        n,
        lang: isLang(l.lang) ? l.lang : DEFAULT_LANG,
        cond: isCond(l.cond) ? l.cond : DEFAULT_COND,
        buy: !pulled && buy != null && Number.isFinite(buy) && buy >= 0 ? buy : null,
        ...(pulled ? { pulled } : {}),
        ...(pack ? { pack } : {}),
      })
    }
    if (ok.length) out[id] = ok
  }
  return out
}

/** Owned copies per class. Foil only cards count every copy as foil. */
function classCounts(o: Owned | undefined, foilOnly: boolean) {
  const qty = o?.qty || 0
  const foil = o?.foil || 0
  return foilOnly ? { normal: 0, foil: qty + foil } : { normal: qty, foil }
}

/** Trims lots so they never describe more copies than the collection holds.
 *  Copies without details go first, then lots from the end. Same array when nothing changes. */
export function fitLots(lots: CopyLot[], o: Owned | undefined, foilOnly: boolean): CopyLot[] {
  const have = classCounts(o, foilOnly)
  const left = { normal: have.normal, foil: have.foil }
  let changed = false
  const out: CopyLot[] = []
  for (const lot of lots) {
    const foil = foilOnly ? true : lot.foil
    const key = foil ? 'foil' : 'normal'
    const n = Math.min(lot.n, left[key])
    left[key] -= n
    if (n !== lot.n || foil !== lot.foil) changed = true
    if (n > 0) out.push(n === lot.n && foil === lot.foil ? lot : { ...lot, n, foil })
  }
  return changed ? out : lots
}

/** fitLots for the whole book. Same object when nothing changes. */
export function fitCopyBook(book: CopyBook, collection: Record<string, Owned>, foilOnly: (id: string) => boolean): CopyBook {
  let out = book
  for (const [id, lots] of Object.entries(book)) {
    const next = fitLots(lots, collection[id], foilOnly(id))
    if (next === lots) continue
    if (out === book) out = { ...book }
    if (next.length) out[id] = next
    else delete out[id]
  }
  return out
}

/** Copies of one class not covered by a lot. */
export function freeCopies(lots: CopyLot[], o: Owned | undefined, foilOnly: boolean, foil: boolean) {
  const have = classCounts(o, foilOnly)
  const used = lots.filter((l) => (foilOnly || l.foil === foil)).reduce((s, l) => s + l.n, 0)
  return Math.max(0, (foil ? have.foil : have.normal) - used)
}

/** All copies of a card as groups: the lots, then the copies without details. */
export function copyGroups(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean): CopyGroup[] {
  const fitted = fitLots(lots || [], o, foilOnly)
  const out: CopyGroup[] = fitted.map((l) => ({ foil: l.foil, n: l.n, lang: l.lang, cond: l.cond, buy: lotCost(l), lot: l }))
  for (const foil of [false, true]) {
    const n = freeCopies(fitted, o, foilOnly, foil)
    if (n > 0) out.push({ foil, n, lang: DEFAULT_LANG, cond: DEFAULT_COND, buy: null })
  }
  return out
}

/** Market price per NM copy, same rule as the collection value (low, else trend; foil falls back to normal). */
export function unitEur(p: PriceEntry | null | undefined, foil: boolean) {
  if (!p) return null
  const n = p.low ?? p.trend
  return foil ? p.foilLow ?? p.foilTrend ?? n : n
}

/** Value of one group, condition included. */
export function groupEur(g: { foil: boolean; n: number; cond: Condition }, p: PriceEntry | null | undefined) {
  const u = unitEur(p, g.foil)
  return u == null ? null : g.n * u * CONDITION_FACTOR[g.cond]
}

/** Copies whose source is still open, worth at least `minEur` each: no lot at all, or bought without a price.
 *  Pulled lots count as done, with or without a pack price. Cheaper copies are bulk nobody wants to sort. */
export function unsourcedCopies(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean, p: PriceEntry | null | undefined, minEur: number) {
  let n = 0
  for (const g of copyGroups(lots, o, foilOnly)) {
    const open = !g.lot || (!g.lot.pulled && g.lot.buy == null)
    if (open && (unitEur(p, g.foil) ?? 0) * CONDITION_FACTOR[g.cond] >= minEur) n += g.n
  }
  return n
}

/** Value of every owned copy of a card, condition included. */
export function cardEur(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean, p: PriceEntry | null | undefined) {
  let sum = 0
  for (const g of copyGroups(lots, o, foilOnly)) sum += groupEur(g, p) ?? 0
  return sum
}

/** Paid vs. worth today for the copies that have a purchase price. */
export function cardInvest(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean, p: PriceEntry | null | undefined) {
  let copies = 0
  let paid = 0
  let worth = 0
  for (const g of copyGroups(lots, o, foilOnly)) {
    if (g.buy == null) continue
    copies += g.n
    paid += g.n * g.buy
    worth += groupEur(g, p) ?? 0
  }
  return { copies, paid, worth }
}

/** The copies that leave when `count` copies of one class are sold: those without details first, then lots from the end. */
export function soldGroups(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean, foil: boolean, count: number): CopyGroup[] {
  const groups = copyGroups(lots, o, foilOnly).filter((g) => g.foil === foil)
  const ordered = [...groups.filter((g) => !g.lot), ...groups.filter((g) => g.lot).reverse()]
  const out: CopyGroup[] = []
  let left = count
  for (const g of ordered) {
    if (left <= 0) break
    const n = Math.min(g.n, left)
    out.push({ ...g, n })
    left -= n
  }
  // More sold than owned: the rest as plain NM copies.
  if (left > 0) out.push({ foil, n: left, lang: DEFAULT_LANG, cond: DEFAULT_COND, buy: null })
  return out
}

/** Moves one copy of a lot into a new lot right after it (same foil, language, condition and source, no price),
 *  so copies bought for different prices can each get their own. Lots with one copy stay as they are. */
export function splitLot(lots: CopyLot[], id: string, newId: string): CopyLot[] {
  const i = lots.findIndex((l) => l.id === id)
  const l = lots[i]
  if (!l || l.n < 2) return lots
  const one: CopyLot = { id: newId, foil: l.foil, n: 1, lang: l.lang, cond: l.cond, buy: null, ...(l.pulled ? { pulled: true } : {}) }
  return [...lots.slice(0, i), { ...l, n: l.n - 1 }, one, ...lots.slice(i + 1)]
}

/** "3,50" or "3.50" -> 3.5; empty -> null; garbage -> undefined. */
export function parseEur(text: string): number | null | undefined {
  const s = text.trim().replace(/€/g, '').replace(/\s/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined
}
