import { readFileSync } from 'node:fs'
import { LENT_HEADER, formatBorrowList, parseBorrowList } from '../src/borrowList.ts'

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

console.log('check_borrow ok')
