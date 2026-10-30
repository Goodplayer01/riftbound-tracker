import { readFileSync } from 'node:fs'
import { LENT_HEADER, formatBorrowList, parseBorrowList, settleBorrowed } from '../src/borrowList.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const raw = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'))
const cards = Array.isArray(raw) ? raw : raw.cards
const byId = new Map(cards.map((c) => [c.id, c]))

// Alt art and base print share a name: the export must bring back the exact print.
const alt = cards.find((c) => c.id === 'ogn-202a-298')
const base = cards.find((c) => c.id === 'ogn-202-298')
assert(alt && base, 'test cards exist')
const list = [{ id: alt.id, qty: 2 }, { id: base.id, qty: 1 }]
const text = formatBorrowList(list, byId, 'Max', true)
assert(text.startsWith(LENT_HEADER), 'lent export starts with the header')
let back = parseBorrowList(text, cards)
assert(back.unmatched.length === 0, 'header and name lines are not unmatched')
assert(back.cards.length === 2 && back.cards.find((c) => c.id === alt.id)?.qty === 2 && back.cards.find((c) => c.id === base.id)?.qty === 1, 'round trip keeps prints and counts')

// Plain name lists (deck list style) still work, codes are case insensitive.
back = parseBorrowList(`1 ${alt.code.toLowerCase()}\n2 Jinx, Rebel\n1 Not A Card`, cards)
assert(back.cards.find((c) => c.id === alt.id)?.qty === 1, 'lower case code')
assert(back.cards.reduce((s, c) => s + c.qty, 0) === 3 && back.unmatched.length === 1, 'names and unmatched')

// Settling: kept cards join the collection, given away ones leave it (normal first), both leave the entry.
const groups = [
  { id: 'a', name: 'Max', direction: 'from', updatedAt: '', cards: [{ id: 'x', qty: 2 }, { id: 'y', qty: 1 }] },
  { id: 'b', name: 'Tom', updatedAt: '', cards: [{ id: 'z', qty: 2 }, { id: 'w', qty: 1 }] },
]
const coll = { x: { qty: 1, foil: 0 }, z: { qty: 1, foil: 2 }, w: { qty: 1, foil: 0 } }
let r = settleBorrowed(groups, 'a', ['x'], coll)
assert(r.collection.x.qty === 3 && r.copies === 2, 'kept copies added as normal copies')
assert(r.groups[0].cards.map((c) => c.id).join() === 'y' && r.groups[1] === groups[1], 'kept card leaves its entry only')
assert(coll.x.qty === 1 && groups[0].cards.length === 2, 'inputs untouched')
r = settleBorrowed(groups, 'b', ['z', 'w'], coll)
assert(r.collection.z.qty === 0 && r.collection.z.foil === 1, 'given away: normal first, then foil')
assert(!r.collection.w && r.groups[1].cards.length === 0 && r.copies === 3, 'card with no copies left is removed')
assert(settleBorrowed(groups, 'nope', ['x'], coll).collection === coll, 'unknown entry changes nothing')

console.log('check_borrow ok')
