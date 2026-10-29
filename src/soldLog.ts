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

/** Revenue of all priced entries; paid and profit only over entries with both price and cost. */
export function soldTotals(log: SoldEntry[]) {
  let revenue = 0
  let paid = 0
  let profit = 0
  let open = 0
  for (const e of log) {
    if (e.eur != null) revenue += e.eur
    if (e.eur != null && e.cost != null) {
      paid += e.cost
      profit += e.eur - e.cost
    } else open += 1
  }
  return { revenue, paid, profit, open }
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
    }]
  })
}
