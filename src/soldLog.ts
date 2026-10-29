import { copyGroups, soldGroups, type CopyGroup, type CopyLot } from './copies.ts'
import type { Owned } from './types'

/** One line of the sales log: copies of one card that left together, or a sale typed in by hand.
 *  `eur` is what came in for all `n` copies, `cost` what they cost (purchase price or pack share);
 *  null when unknown, so they stay out of the profit. `cardId` is missing for free text entries. */
export type SoldEntry = {
  id: string
  at: string
  cardId?: string
  name: string
  foil: boolean
  n: number
  eur: number | null
  cost: number | null
  pulled?: boolean
  note?: string
  /** Marketplace commission and shipping the seller paid, both in EUR; missing means none. */
  fee?: number
  ship?: number
  /** Import key ("cm:<shipment>:<product>:<price>") so the same Cardmarket row is never booked twice. */
  ref?: string
}

/** Cardmarket's commission on the article price (5 % for private sellers). */
export const CM_FEE_PCT = 5

const cents = (x: number) => Math.round(x * 100) / 100

/** Commission on a sale, in whole cents. */
export function feeFor(eur: number | null, pct: number) {
  return eur == null || !(pct > 0) ? 0 : cents((eur * pct) / 100)
}

/** What a sale left over: price minus cost, commission and shipping; null while price or cost is unknown. */
export function entryProfit(e: SoldEntry) {
  return e.eur == null || e.cost == null ? null : cents(e.eur - e.cost - (e.fee || 0) - (e.ship || 0))
}

/** One sold article from Cardmarket's "Sold Articles" CSV export. */
export type CmSoldRow = { shipment: string; at: string; productId: string; name: string; n: number; price: number; ref: string }

/** Parses Cardmarket's "Sold Articles" CSV (Sales > Sold articles > Export): semicolon separated, one row per
 *  article: shipment nr; date of purchase; article; product id; localized name; expansion; category; amount;
 *  article value; total; currency; comments. Rows that do not fit are skipped and counted. */
export function parseCmSold(text: string) {
  const rows: CmSoldRow[] = []
  let skipped = 0
  // shortcut: plain split by ';' and fixed column order, as in the English export of Oct 2026; Cardmarket
  // quotes nothing there. Read the header by name if they ever add columns or quoting.
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    const f = line.split(';')
    const [shipment, date, name, productId] = f
    const n = Number(f[7])
    const price = Number(f[8])
    const at = /^\d{4}-\d{2}-\d{2}/.exec(date || '')?.[0]
    if (!shipment || !at || !/^\d+$/.test(productId || '') || !(n > 0) || !Number.isInteger(n) || !(price >= 0) || (f[10] && f[10] !== 'EUR')) {
      skipped += 1
      continue
    }
    rows.push({ shipment, at, productId, name: name.trim(), n, price, ref: `cm:${shipment}:${productId}:${price}` })
  }
  return { rows, skipped }
}

/** Today as YYYY-MM-DD in local time (toISOString alone would give the UTC day). */
export function localDay(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Stable key of a copy group within one card: the lot id, or the copies without details per class. */
export function groupKey(g: CopyGroup) {
  return g.lot ? g.lot.id : g.foil ? 'free-foil' : 'free'
}

/** The copies "Mark as sold" takes when nobody picks: normal first, then foil, each without details first. */
export function defaultPicks(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean, split: { qty: number; foil: number }) {
  const picks: Record<string, number> = {}
  // Foil only cards hold every copy as foil, whatever field the count sits in.
  const classes: [boolean, number][] = foilOnly ? [[true, split.qty + split.foil]] : [[false, split.qty], [true, split.foil]]
  for (const [foil, n] of classes) {
    if (n <= 0) continue
    for (const g of soldGroups(lots, o, foilOnly, foil, n)) picks[groupKey(g)] = (picks[groupKey(g)] || 0) + g.n
  }
  // soldGroups adds copies beyond what is owned to the "without details" key; nobody can sell those.
  const cap = new Map(copyGroups(lots, o, foilOnly).map((g) => [groupKey(g), g.n]))
  for (const k of Object.keys(picks)) picks[k] = Math.min(picks[k], cap.get(k) ?? 0)
  return picks
}

/** Takes the picked copies (capped at what each group holds) out of one card's lots and owned counts. */
export function takeCopies(lots: CopyLot[] | undefined, o: Owned | undefined, foilOnly: boolean, picks: Record<string, number>) {
  let qty = o?.qty || 0
  let foil = o?.foil || 0
  const taken: { g: CopyGroup; n: number }[] = []
  const left = new Map<string, number>()
  for (const g of copyGroups(lots, o, foilOnly)) {
    const n = Math.min(g.n, Math.max(0, Math.floor(picks[groupKey(g)] || 0)))
    if (!n) continue
    taken.push({ g, n })
    if (g.lot) left.set(g.lot.id, g.n - n)
    if (foilOnly) {
      const a = Math.min(qty, n)
      qty -= a
      foil -= n - a
    } else if (g.foil) foil -= n
    else qty -= n
  }
  const nextLots = (lots || []).flatMap((l) => {
    const n = left.get(l.id)
    return n == null ? [l] : n > 0 ? [{ ...l, n }] : []
  })
  return { lots: nextLots, owned: { qty, foil }, taken }
}

/** Revenue, commission and shipping of all entries; cost and profit only over entries whose price and cost are known
 *  (`open` counts the others). */
export function soldTotals(log: SoldEntry[]) {
  let revenue = 0
  let fees = 0
  let paid = 0
  let profit = 0
  let open = 0
  for (const e of log) {
    revenue += e.eur || 0
    fees += (e.fee || 0) + (e.ship || 0)
    const p = entryProfit(e)
    if (p == null) open += 1
    else {
      paid += e.cost || 0
      profit += p
    }
  }
  return { revenue: cents(revenue), fees: cents(fees), paid: cents(paid), profit: cents(profit), open }
}

const money = (x: unknown) => {
  if (x == null || x === '') return null
  const v = Number(x)
  return Number.isFinite(v) && v >= 0 ? v : null
}

/** Drops anything malformed from a stored log (hand edits, older formats). */
export function cleanSoldLog(raw: unknown): SoldEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e: Partial<SoldEntry> | null) => {
    const n = Math.floor(Number(e?.n))
    if (!e || !(n > 0) || typeof e.name !== 'string' || !e.name.trim() || typeof e.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.at)) return []
    return [{
      id: typeof e.id === 'string' && e.id ? e.id : crypto.randomUUID(),
      at: e.at,
      ...(typeof e.cardId === 'string' && e.cardId ? { cardId: e.cardId } : {}),
      name: e.name.trim(),
      foil: !!e.foil,
      n,
      eur: money(e.eur),
      cost: money(e.cost),
      ...(e.pulled ? { pulled: true } : {}),
      ...(typeof e.note === 'string' && e.note.trim() ? { note: e.note.trim() } : {}),
      ...(money(e.fee) ? { fee: money(e.fee)! } : {}),
      ...(money(e.ship) ? { ship: money(e.ship)! } : {}),
      ...(typeof e.ref === 'string' && e.ref ? { ref: e.ref } : {}),
    }]
  })
}
