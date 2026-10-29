import { cleanSoldLog, defaultPicks, groupKey, soldTotals, takeCopies } from '../src/soldLog.ts'
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

// Foil only card: every copy is foil, whichever field holds it.
const fo = [{ id: 'x', foil: true, n: 1, lang: 'EN', cond: 'NM', buy: 2 }]
picks = defaultPicks(fo, { qty: 2, foil: 0 }, true, { qty: 2, foil: 0 })
assert(picks['free-foil'] === 1 && picks.x === 1, `foil only default: ${JSON.stringify(picks)}`)
r = takeCopies(fo, { qty: 2, foil: 0 }, true, picks)
assert(r.owned.qty === 0 && r.owned.foil === 0 && r.lots.length === 0, 'foil only copies leave from qty')

// Totals: profit only over entries with both price and cost.
const t = soldTotals([
  { eur: 1000, cost: null },
  { eur: 6, cost: 4 },
  { eur: 2, cost: 0.5 },
  { eur: null, cost: 3 },
])
assert(t.revenue === 1008 && t.paid === 4.5 && t.profit === 3.5 && t.open === 2, `totals: ${JSON.stringify(t)}`)

// Cleaning keeps good entries, drops broken ones, normalises money.
const clean = cleanSoldLog([
  { id: 'a', at: '2026-10-29', name: ' Ultimate ', n: 1, eur: '1000', cost: '' },
  { at: 'yesterday', name: 'x', n: 1 },
  { at: '2026-10-29', name: '', n: 1 },
  { at: '2026-10-29', name: 'y', n: 0 },
  null,
])
assert(clean.length === 1 && clean[0].name === 'Ultimate' && clean[0].eur === 1000 && clean[0].cost === null, `clean: ${JSON.stringify(clean)}`)
assert(cleanSoldLog('nope').length === 0, 'non-array log is empty')

console.log('ok')
