import { readFileSync } from 'node:fs'
import { saleSplit, subtractOwnedCopies } from '../src/collection.ts'
import { resolveToken } from '../src/parseBulk.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const cards = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url))).cards

// Selling takes non-foil first, then foil, never below zero.
let r = subtractOwnedCopies({ qty: 2, foil: 3 }, 4)
assert(r.qty === 0 && r.foil === 1 && r.sold === 4 && r.short === 0, 'non-foil first')
r = subtractOwnedCopies({ qty: 1, foil: 0 }, 3)
assert(r.qty === 0 && r.foil === 0 && r.sold === 1 && r.short === 2, 'short when not enough')
r = subtractOwnedCopies({ qty: 2, foil: 0 }, 0)
assert(r.qty === 2 && r.sold === 0, 'zero sells nothing')

// The sell export names the copies the sale really takes: only foils owned -> a foil leaves.
let s = saleSplit({ qty: 0, foil: 2 }, 1)
assert(s.qty === 0 && s.foil === 1, 'only foils: sells a foil')
s = saleSplit({ qty: 1, foil: 1 }, 2)
assert(s.qty === 1 && s.foil === 1, 'normal first, then foil')
s = saleSplit({ qty: 1, foil: 0 }, 3)
assert(s.qty === 1 && s.foil === 0, 'never more than owned')
assert(saleSplit(undefined, 2).qty === 0, 'nothing owned sells nothing')

// Card codes: plain, short, alt art, signed.
const id = (t) => resolveToken(t, cards)?.id
assert(id('OGN-056/298') === 'ogn-056-298', 'full code')
assert(id('ogn 56') === 'ogn-056-298', 'short code')
assert(id('OGN-007a') === 'ogn-007a-298', 'alt art')
assert(id('OGN-299*') === 'ogn-299-star-298', 'signed')
assert(id('OGN-299') === 'ogn-299-298', 'unsigned is not signed')
assert(id('XYZ-999') === undefined, 'unknown code')

console.log('ok')
