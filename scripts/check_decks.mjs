import { readFileSync } from 'node:fs'
import { canAddToSection, copyName, coverDeckLines, parseDeckImport } from '../src/deckHelpers.ts'

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

// Real cards for the copy limit and the import.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} }
const cards = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url))).cards
const byId = new Map(cards.map((x) => [x.id, x]))
const id = (code) => cards.find((x) => x.code.toUpperCase().startsWith(code))?.id

// Copy limit is per full name: 2 "Evelynn, in Control" + 1 "Evelynn, Entrancing" still allows more of each.
const deck = [
  { id: id('UNL-232'), qty: 1, section: 'legend' },
  { id: id('RAD-SP3'), qty: 2, section: 'main' },
  { id: id('UNL-141'), qty: 1, section: 'main' },
]
assert(canAddToSection(deck, byId.get(id('UNL-141')), 'main', byId).ok, 'another Evelynn, Entrancing fits')
assert(copyName(byId.get(id('RAD-SP3'))) === copyName(byId.get(id('RAD-109'))), 'alt art and base share the name')
const full = [...deck, { id: id('RAD-109'), qty: 1, section: 'main' }]
assert(!canAddToSection(full, byId.get(id('RAD-SP3')), 'main', byId).ok, 'a 4th Evelynn, in Control (any print) is blocked')

// Import with Rift Atlas codes: the code picks the exact print, a missing comma still matches by name.
const imp = parseDeckImport('MainDeck:\n2 Evelynn in Control [RAD-SP3]\n1 Pyke, Returned [UNL-145A]\n1 Evelynn in Control\nRunes:\n6 Calm Rune [SFD-R02B]', cards)
const got = (code) => imp.cards.find((x) => x.id === id(code))?.qty
assert(got('RAD-SP3') === 2, 'alt art Evelynn by code')
assert(got('UNL-145A') === 1, 'alt art Pyke by code')
assert(got('RAD-109') === 1, 'name without comma finds the base card')
assert(imp.unmatched.length === 0 && imp.cards.some((x) => x.section === 'rune' && x.qty === 6), 'unknown code falls back to the name')

console.log('ok')
