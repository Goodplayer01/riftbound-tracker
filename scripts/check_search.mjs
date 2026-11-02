import { readFileSync } from 'node:fs'
import { cardMatchesQuery } from '../src/search.ts'
import { matchCardByName } from '../src/deckHelpers.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const raw = JSON.parse(readFileSync(new URL('../public/cards.json', import.meta.url), 'utf8'))
const cards = Array.isArray(raw) ? raw : raw.cards
const hits = (q) => cards.filter((c) => cardMatchesQuery(c, q))
const names = (q) => new Set(hits(q).map((c) => c.name))

// Apostrophes are optional (and any kind of apostrophe works).
for (const q of ["kha'zix", 'khazix', 'kha’zix']) assert(names(q).has("Kha'Zix"), `${q} finds Kha'Zix`)
assert(names('kaisa').has("Kai'Sa"), 'kaisa finds Kai\'Sa')

// Every word anywhere on the card: champion name + "legend" finds the Legend.
const vexLegend = hits('vex legend')
assert(vexLegend.length > 0 && vexLegend.every((c) => c.name === 'Vex' && c.types.includes('Legend')), 'vex legend finds only Vex Legends')
assert(hits('legend vex').length === vexLegend.length, 'word order does not matter')
assert(hits('').length === cards.length && hits('   ').length === cards.length, 'empty query matches all')

// Deck import: a list without the apostrophe still resolves.
const kz = matchCardByName(cards, 'Khazix, Voidreaver')
assert(kz && kz.name === "Kha'Zix" && kz.subtitle === 'Voidreaver', `deck import Khazix: ${kz && kz.name}`)

console.log('check_search ok')
