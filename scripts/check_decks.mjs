import { coverDeckLines } from '../src/deckHelpers.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Kai'Sa: the deck wants 3 of the base print, you own 1 base and 2 alt arts -> all 3 covered.
let c = coverDeckLines([{ id: 'base', key: 'kaisa', need: 3, own: 1 }], new Map([['kaisa', 3]]))
assert(c.get('base') === 3, 'alt art copies cover the base card')

// Not enough in any print: 1 base + 1 alt for 3 -> 2 covered.
c = coverDeckLines([{ id: 'base', key: 'kaisa', need: 3, own: 1 }], new Map([['kaisa', 2]]))
assert(c.get('base') === 2, 'short when all prints together are not enough')

// Both prints in the deck: each serves itself first, no copy counts twice.
// Deck: 2 base + 1 alt; owned: 1 base, 2 alt -> base gets 1 own + 1 spare alt, alt gets its own -> 3 of 3.
c = coverDeckLines(
  [{ id: 'base', key: 'k', need: 2, own: 1 }, { id: 'alt', key: 'k', need: 1, own: 2 }],
  new Map([['k', 3]]),
)
assert(c.get('base') === 2 && c.get('alt') === 1, 'own print first, spares fill the gap')
c = coverDeckLines(
  [{ id: 'base', key: 'k', need: 2, own: 0 }, { id: 'alt', key: 'k', need: 2, own: 2 }],
  new Map([['k', 2]]),
)
assert(c.get('base') === 0 && c.get('alt') === 2, 'the alt art lines keep their own copies')

// Other cards are not mixed in.
c = coverDeckLines(
  [{ id: 'a', key: 'x', need: 1, own: 0 }, { id: 'b', key: 'y', need: 1, own: 3 }],
  new Map([['x', 0], ['y', 3]]),
)
assert(c.get('a') === 0 && c.get('b') === 1, 'separate cards stay separate')

console.log('ok')
