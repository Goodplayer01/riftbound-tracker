import { cleanSoldLog, defaultPicks, entryProfit, feeFor, groupKey, parseCmSold, saleEntries, soldTotals, takeCopies } from '../src/soldLog.ts'
import { copyGroups } from '../src/copies.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
globalThis.crypto ??= { randomUUID: () => Math.random().toString(36).slice(2) }

// 3 normal: 1 bought for 4 €, 1 pulled from a 120 € display (336 cards), 1 without details; 1 foil bought for 10 €.
const lots = [
  { id: 'b', foil: false, n: 1, lang: 'EN', cond: 'NM', buy: 4 },
  { id: 'p', foil: false, n: 1, lang: 'EN', cond: 'NM', buy: null, pulled: true, pack: { kind: 'display', eur: 120 } },
  { id: 'f', foil: true, n: 1, lang: 'EN', cond: 'NM', buy: 10 },
]
const owned = { qty: 3, foil: 1 }

// Default: same rule as before (copies without details first, then lots from the end, normal before foil).
let picks = defaultPicks(lots, owned, false, { qty: 2, foil: 0 })
assert(picks.free === 1 && picks.p === 1 && !picks.b, `default picks free + last lot: ${JSON.stringify(picks)}`)
picks = defaultPicks(lots, owned, false, { qty: 9, foil: 0 })
assert(picks.free === 1 && picks.b === 1 && picks.p === 1, 'default picks never exceed what a group holds')

// Picking the bought copy and the foil: lots and counts shrink exactly there, costs come along.
let r = takeCopies(lots, owned, false, { b: 1, f: 1 })
assert(r.owned.qty === 2 && r.owned.foil === 0, `counts: ${JSON.stringify(r.owned)}`)
assert(r.lots.map((l) => l.id).join() === 'p', `lots left: ${r.lots.map((l) => l.id)}`)
assert(r.taken.map((x) => `${groupKey(x.g)}:${x.n}:${x.g.buy}`).join() === 'b:1:4,f:1:10', 'taken groups with their cost')
// The rest still describes the collection: the pulled copy and one without details.
assert(copyGroups(r.lots, r.owned, false).map(groupKey).join() === 'p,free', 'remaining groups stay consistent')

// Picks above a group's size are capped; the pulled copy carries its display share.
r = takeCopies(lots, owned, false, { p: 5 })
assert(r.taken[0].n === 1 && Math.abs(r.taken[0].g.buy - 120 / 336) < 1e-9 && r.owned.qty === 2, 'capped pick, pack share as cost')

// Two orders of one card in a row: the second only sees what the first left.
const first = takeCopies(lots, owned, false, defaultPicks(lots, owned, false, { qty: 2, foil: 0 }))
const second = defaultPicks(first.lots, first.owned, false, { qty: 1, foil: 0 })
assert(second.b === 1 && !second.p && !second.free, `second order takes the bought copy: ${JSON.stringify(second)}`)

// Foil only card: every copy is foil, whichever field holds it.
const fo = [{ id: 'x', foil: true, n: 1, lang: 'EN', cond: 'NM', buy: 2 }]
picks = defaultPicks(fo, { qty: 2, foil: 0 }, true, { qty: 2, foil: 0 })
assert(picks['free-foil'] === 1 && picks.x === 1, `foil only default: ${JSON.stringify(picks)}`)
r = takeCopies(fo, { qty: 2, foil: 0 }, true, picks)
assert(r.owned.qty === 0 && r.owned.foil === 0 && r.lots.length === 0, 'foil only copies leave from qty')

// Commission in whole cents; profit takes off cost, commission and shipping.
assert(feeFor(95, 5) === 4.75 && feeFor(3.3, 5) === 0.17 && feeFor(null, 5) === 0 && feeFor(10, 0) === 0, 'fee in cents')
assert(entryProfit({ eur: 33, cost: 4, fee: 1.65, ship: 1.2 }) === 26.15, 'profit after fee and shipping')
assert(entryProfit({ eur: 33, cost: null }) === null, 'no profit without cost')

// Totals: fees and shipping over everything, cost and profit only over entries with both price and cost.
const t = soldTotals([
  { eur: 1000, cost: null },
  { eur: 6, cost: 4, fee: 0.3 },
  { eur: 2, cost: 0.5, ship: 1 },
  { eur: null, cost: 3 },
])
assert(t.revenue === 1008 && t.fees === 1.3 && t.paid === 4.5 && t.profit === 2.2 && t.open === 2, `totals: ${JSON.stringify(t)}`)

// Cardmarket "Sold Articles" CSV: one row per article, product id = cmId, refs tell rows apart.
const csv = [
  'Shipment nr.;Date of purchase;Article;Product ID;Localized Product Name;Expansion;Category;Amount;Article Value;Total;Currency;Comments',
  '1001;2026-10-23 10:49:27;Some Unit;111111;Some Unit;Unleashed;Riftbound Single;2;3.3;6.6;EUR;Fast shipping; thanks',
  '1002;2026-10-27 01:39:27;Big Dragon (V.1 - Epic);222222;Big Dragon (V.1 - Epic);Unleashed;Riftbound Single;1;16.75;16.75;EUR;',
  '1002;2026-10-27 01:39:27;Some Unit;111111;Some Unit;Unleashed;Riftbound Single;1;3.3;3.3;EUR;',
  'broken;line',
  '',
].join('\r\n')
const p = parseCmSold('﻿' + csv)
assert(p.rows.length === 3 && p.skipped === 1, `cm rows: ${p.rows.length} skipped ${p.skipped}`)
assert(p.rows[0].n === 2 && p.rows[0].price === 3.3 && p.rows[0].at === '2026-10-23' && p.rows[0].productId === '111111', 'cm row fields')
assert(p.rows[1].name === 'Big Dragon (V.1 - Epic)' && p.rows[1].shipment === '1002', 'cm name and shipment')
assert(new Set(p.rows.map((x) => x.ref)).size === 3, 'same card in two shipments keeps two refs')

// A German export with decimal commas reads the same.
const de = parseCmSold('header\n1003;2026-10-28 18:29:12;Hook;333333;Hook;Origins;Riftbound Single;1;33,5;33,5;EUR;')
assert(de.rows.length === 1 && de.rows[0].price === 33.5, `decimal comma: ${JSON.stringify(de)}`)

// Booking a sale: shipping once per shipment, commission per line, lines without a lot have no cost, empty lines vanish.
let k = 0
const entries = saleEntries(
  [
    { cardId: 'a', name: 'A', at: '2026-10-27', price: 3.3, shipment: 's1', ref: 'cm:s1:1:3.3', lines: [{ n: 1, foil: false, cost: 4 }, { n: 1, foil: true, cost: null }] },
    { cardId: 'b', name: 'B', at: '2026-10-27', price: 10, shipment: 's1', ref: 'cm:s1:2:10', lines: [{ n: 0, foil: false, cost: null }, { n: 2, foil: false, cost: 0.5, pulled: true }] },
    { cardId: 'c', name: 'C', at: '2026-10-28', price: null, shipment: 's2', lines: [{ n: 1, foil: false, cost: 1 }] },
  ],
  { feePct: 5, ship: 1.2, perShipment: true, newId: () => `e${k++}` },
)
assert(entries.length === 4, `four entries, the empty line is dropped: ${entries.length}`)
assert(entries.filter((e) => e.ship).map((e) => e.cardId).join() === 'a,c', 'shipping once per shipment')
assert(entries[0].eur === 3.3 && entries[0].fee === 0.17 && entries[0].cost === 4 && entries[0].ref === 'cm:s1:1:3.3', 'first line with fee, cost and ref')
assert(entries[1].cost === null && entries[1].foil === true, 'copy without a lot keeps its foil flag and no cost')
assert(entries[2].eur === 20 && entries[2].cost === 1 && entries[2].pulled === true && entries[2].fee === 1, 'two pulled copies')
assert(entries[3].eur === null && !entries[3].fee, 'no price, no commission')
const once = saleEntries(
  [{ cardId: 'a', name: 'A', at: '2026-10-27', price: 5, lines: [{ n: 1, foil: false, cost: 1 }] }, { cardId: 'b', name: 'B', at: '2026-10-27', price: 5, lines: [{ n: 1, foil: false, cost: 1 }] }],
  { feePct: 0, ship: 2, perShipment: false, newId: () => `f${k++}` },
)
assert(once.filter((e) => e.ship).length === 1 && !once.some((e) => e.fee), 'cart sale: shipping once, no commission at 0 %')

// Cleaning keeps good entries, drops broken ones, normalises money.
const clean = cleanSoldLog([
  { id: 'a', at: '2026-10-29', name: ' Ultimate ', n: 1, eur: '1000', cost: '', fee: 50, ship: '1.2', ref: 'cm:1:2:3' },
  { at: 'yesterday', name: 'x', n: 1 },
  { at: '2026-10-29', name: '', n: 1 },
  { at: '2026-10-29', name: 'y', n: 0 },
  null,
])
assert(
  clean.length === 1 && clean[0].name === 'Ultimate' && clean[0].eur === 1000 && clean[0].cost === null && clean[0].fee === 50 && clean[0].ship === 1.2 && clean[0].ref === 'cm:1:2:3',
  `clean: ${JSON.stringify(clean)}`,
)
assert(cleanSoldLog('nope').length === 0, 'non-array log is empty')

console.log('ok')
