import { cardMatchesDomains, moveDeck } from '../src/domainMatch.ts'

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
console.log('ok')
