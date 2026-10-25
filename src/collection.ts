import type { Owned } from './types'

export function ownedQty(o?: { qty: number; foil: number }) {
  return (o?.qty || 0) + (o?.foil || 0)
}

/** Reduce non-foil (qty) first, then foil. Never below 0. */
export function subtractOwnedCopies(o: Owned, sellQty: number) {
  const have = ownedQty(o)
  const want = Math.max(0, Math.floor(sellQty) || 0)
  const sold = Math.min(want, have)
  const short = want - sold
  let rem = sold
  let qty = o.qty || 0
  let foil = o.foil || 0
  const fromNonFoil = Math.min(qty, rem)
  qty -= fromNonFoil
  rem -= fromNonFoil
  if (rem > 0) {
    const fromFoil = Math.min(foil, rem)
    foil -= fromFoil
  }
  return { qty, foil, sold, short }
}

/** Which copies a sale of `sellQty` takes: same rule as subtractOwnedCopies (normal first, then foil).
 *  The sell export and the cart value use it, so they name the copies that really leave. */
export function saleSplit(o: Owned | undefined, sellQty: number) {
  const cur = { qty: o?.qty || 0, foil: o?.foil || 0 }
  const r = subtractOwnedCopies(cur, sellQty)
  return { qty: cur.qty - r.qty, foil: cur.foil - r.foil }
}
