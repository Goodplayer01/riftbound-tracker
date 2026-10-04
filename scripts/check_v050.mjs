import { cardMatchesDomains, deckDropIndex, moveDeck, moveDeckTo } from '../src/domainMatch.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(cardMatchesDomains(['Fury'], []) === true, 'none selected shows all')
assert(cardMatchesDomains(['Fury'], ['Calm']) === false, 'miss')
assert(cardMatchesDomains(['Fury', 'Calm'], ['Order', 'Calm']) === true, 'or match')
assert(cardMatchesDomains(['Body'], ['Fury', 'Body']) === true, 'any selected')
assert(cardMatchesDomains(undefined, ['Fury']) === false, 'no domains')

const moved = moveDeck([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'c', 'a')
assert(moved.map((x) => x.id).join('') === 'cab', 'drop on first')
const mid = moveDeck([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 'c')
assert(mid.map((x) => x.id).join('') === 'bca', 'drop on last')
assert(moveDeck([{ id: 'a' }], 'a', 'a')[0].id === 'a', 'same')

const rows = [{ top: 0, height: 70 }, { top: 78, height: 70 }, { top: 156, height: 70 }]
assert(deckDropIndex(-20, rows, 2) === 0, 'above list is first')
assert(deckDropIndex(2, rows, 2) === 0, 'top edge is first')
assert(deckDropIndex(900, rows, 0) === 2, 'below list is last')
assert(deckDropIndex(200, rows, 0) === 2, 'past last midpoint is last')
const toFront = moveDeckTo([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'c', 0)
assert(toFront.map((x) => x.id).join('') === 'cab', 'index first')
const toEnd = moveDeckTo([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 2)
assert(toEnd.map((x) => x.id).join('') === 'bca', 'index last')
assert(moveDeckTo([{ id: 'a' }, { id: 'b' }], 'a', 0)[0].id === 'a', 'index same')
console.log('ok')
