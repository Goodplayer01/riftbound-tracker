import type { CopyLot } from './copies.ts'
import { splitCents } from './soldLog.ts'

/** One card line of a purchase: `n` copies at `price` each (null while unknown). */
export type BuyLine = { id: string; n: number; foil: boolean; price: number | null }

const cents = (x: number) => Math.round(x * 100) / 100

/** What each line's copies cost: their price plus their share of the order's shipping, split by price
 *  (by copies when no price is known), so the shares add up to the exact shipping. Null when the price is unknown. */
export function purchaseCosts(lines: BuyLine[], ship: number | null) {
  const priced = lines.map((l) => (l.price ?? 0) * l.n)
  const weights = priced.some((x) => x > 0) ? priced : lines.map((l) => l.n)
  const shares = splitCents(ship || 0, weights)
  return lines.map((l, i) => (l.price == null || !(l.n > 0) ? null : cents((l.price * l.n + shares[i]) / l.n)))
}

/** New lots for one purchase, one per line: bought, English NM, with seller and day. */
export function purchaseLots(lines: BuyLine[], ship: number | null, meta: { from?: string; at?: string }, newId: () => string) {
  const costs = purchaseCosts(lines, ship)
  const from = meta.from?.trim().slice(0, 60)
  return lines.flatMap((l, i) => (l.n > 0 ? [{
    cardId: l.id,
    lot: {
      id: newId(),
      foil: l.foil,
      n: l.n,
      lang: 'EN',
      cond: 'NM',
      buy: costs[i],
      ...(from ? { from } : {}),
      ...(meta.at ? { at: meta.at } : {}),
    } satisfies CopyLot,
  }] : []))
}
