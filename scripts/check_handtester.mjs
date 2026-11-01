import { MULLIGAN_MAX, OPENING_HAND_SIZE, applyMulligan, buildRunePool, dealOpeningHand, playTurn, runesToChannel } from '../src/handTester.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// A deck: 40 main (10 cards × 4 ids), a champion, a legend, 12 runes (7 Fury, 5 Body), a sideboard card.
const cards = [
  { id: 'legend', qty: 1, section: 'legend' },
  { id: 'champ', qty: 1, section: 'champion' },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, qty: 4, section: 'main' })),
  { id: 'fury', qty: 7, section: 'rune' },
  { id: 'body', qty: 5, section: 'rune' },
  { id: 'side', qty: 2, section: 'sideboard' },
]

// Setup (Core Rules 114, 116): 4 cards from the shuffled Main Deck, the Rune Deck shuffled apart.
assert(OPENING_HAND_SIZE === 4 && MULLIGAN_MAX === 2, 'draw 4, mulligan up to 2')
const s0 = dealOpeningHand(cards)
assert(s0 && s0.hand.length === 4 && s0.library.length === 36 && s0.turn === 0, 'opening hand of 4, 36 left')
assert(![...s0.hand, ...s0.library].some((id) => ['champ', 'legend', 'fury', 'side'].includes(id)), 'only Main Deck cards are drawn')
assert(buildRunePool(cards).length === 12 && s0.runeLibrary.length === 12 && s0.runes.length === 0, '12 runes in the Rune Deck, none channeled yet')
assert(dealOpeningHand(cards.slice(0, 2)) === null, 'no hand without 4 Main Deck cards')

// Mulligan (117): the set-aside cards end up at the bottom, the replacements come from the top.
const m = applyMulligan(s0.hand, s0.library, [0, 2])
assert(m.hand.length === 4 && m.library.length === 36, 'mulligan keeps the counts')
assert(m.hand[2] === s0.library[0] && m.hand[3] === s0.library[1], 'replacements are the top two cards')
assert([s0.hand[0], s0.hand[2]].sort().join() === m.library.slice(-2).sort().join(), 'set-aside cards are recycled to the bottom')
assert(applyMulligan(s0.hand, s0.library, [0, 1, 2]) === null, 'never more than 2')

// Turns (315.3, 315.4, 431.4.a, 487.7): channel 2 runes, then draw 1, from turn 1 on; going second adds one rune on turn 1.
assert(runesToChannel(1, true) === 2 && runesToChannel(1, false) === 3 && runesToChannel(2, false) === 2, 'runes per turn')
const first1 = playTurn(s0, true)
assert(first1.turn === 1 && first1.runes.length === 2 && first1.hand.length === 5 && first1.library.length === 35, 'going first: 2 runes and a draw on turn 1')
assert(first1.runes.join() === s0.runeLibrary.slice(0, 2).join() && first1.runeLibrary.length === 10, 'runes come off the top of the Rune Deck')
const second1 = playTurn(s0, false)
assert(second1.runes.length === 3 && second1.hand.length === 5, 'going second: 3 runes on turn 1')
let s = second1
for (let i = 0; i < 5; i++) s = playTurn(s, false)
assert(s.turn === 6 && s.runes.length === 12 && s.runeLibrary.length === 0 && s.hand.length === 10, 'runes run out at 12, draws go on')
assert(s0.runes.length === 0 && s0.hand.length === 4, 'playTurn leaves the old state untouched')

console.log('check_handtester ok')
