import { purchaseCosts, purchaseLots } from '../src/purchase.ts'
import { cleanCopyBook } from '../src/copies.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
globalThis.crypto ??= { randomUUID: () => Math.random().toString(36).slice(2) }

// Stefan's order from Pandrag0: 7.05 € of cards, 1.40 € shipping. Each copy carries its share by price.
const lines = [
  { id: 'edge', n: 2, foil: true, price: 0.49 },
  { id: 'boots', n: 1, foil: false, price: 0.29 },
  { id: 'boots', n: 1, foil: true, price: 2 },
  { id: 'evelynn', n: 2, foil: true, price: 1.89 },
]
const costs = purchaseCosts(lines, 1.4)
const total = lines.reduce((s, l, i) => s + costs[i] * l.n, 0)
assert(Math.abs(total - 8.45) < 0.02, `copies add up to the order total 8.45 €: ${total.toFixed(2)}`)
assert(costs[0] > 0.49 && costs[0] < 0.65 && costs[2] > 2 && costs[2] < 2.5, `shipping split by price: ${costs}`)
assert(purchaseCosts([{ id: 'a', n: 1, foil: false, price: null }], 1).join() === '', 'unknown price stays unknown')
assert(purchaseCosts([{ id: 'a', n: 2, foil: false, price: 3 }], null).join() === '3', 'no shipping, plain price')

// Lots: bought, EN NM, seller and day, survive cleaning.
let k = 0
const lots = purchaseLots(lines, 1.4, { from: ' Pandrag0 ', at: '2026-10-28' }, () => `l${k++}`)
assert(lots.length === 4 && lots[0].cardId === 'edge' && lots[0].lot.n === 2 && lots[0].lot.foil && lots[0].lot.from === 'Pandrag0', 'one lot per line')
const clean = cleanCopyBook({ edge: [lots[0].lot], x: [{ id: 'z', n: 1, foil: false, buy: 1, from: '', at: 'yesterday' }] })
assert(clean.edge[0].from === 'Pandrag0' && clean.edge[0].at === '2026-10-28' && clean.edge[0].buy === costs[0], 'seller and day survive cleaning')
assert(!('from' in clean.x[0]) && !('at' in clean.x[0]), 'empty seller and bad day are dropped')

console.log('ok')
