import { cardEur, cardInvest, cleanCopyBook, fitLots, parseEur, soldGroups } from '../src/copies.ts'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const lot = (id, foil, n, buy, cond = 'NM') => ({ id, foil, n, lang: 'EN', cond, buy })
const a = lot('a', false, 2, 1.5)
const b = lot('b', false, 2, 3)

// Fewer copies owned than the lots describe: earlier lots stay, later ones shrink or go.
let fitted = fitLots([a, b], { qty: 3, foil: 0 }, false)
assert(fitted.length === 2 && fitted[0] === a && fitted[1].n === 1 && fitted[1].buy === 3, 'trim from the end')
fitted = fitLots([a, b], { qty: 0, foil: 0 }, false)
assert(fitted.length === 0, 'nothing owned drops every lot')
const same = [a, b]
assert(fitLots(same, { qty: 9, foil: 0 }, false) === same, 'unchanged lots keep the same array')

// Foil only cards: every copy counts as foil, a normal lot turns foil.
fitted = fitLots([a], { qty: 2, foil: 0 }, true)
assert(fitted.length === 1 && fitted[0].foil === true && fitted[0].n === 2, 'foil only lot')

// Selling: copies without details go first, then lots from the end.
let sold = soldGroups([a, b], { qty: 5, foil: 0 }, false, false, 2)
assert(sold.length === 2 && !sold[0].lot && sold[0].n === 1 && sold[1].lot === b && sold[1].n === 1, 'sell order')
sold = soldGroups([a], { qty: 1, foil: 0 }, false, false, 3)
assert(sold.reduce((s, g) => s + g.n, 0) === 3 && sold.at(-1).buy === null, 'oversell pads with plain copies')

// Value: condition factor applies, copies without a lot count as NM.
const price = { low: 10 }
assert(cardEur([lot('c', false, 1, null, 'LP')], { qty: 2, foil: 0 }, false, price) === 10 * 0.6 + 10, 'condition value')
const inv = cardInvest([a], { qty: 3, foil: 0 }, false, price)
assert(inv.copies === 2 && inv.paid === 3 && inv.worth === 20, 'invest only counts lots with a price')

// Stored data from older versions or hand edits.
const book = cleanCopyBook({ x: [{ n: '2', foil: 1, lang: 'XX', cond: 'bad', buy: -1 }, { n: 0 }], y: 'junk' })
assert(book.x.length === 1 && book.x[0].n === 2 && book.x[0].foil && book.x[0].lang === 'EN' && book.x[0].cond === 'NM' && book.x[0].buy === null, 'clean book')
assert(!('y' in book), 'drop non arrays')

assert(parseEur('3,50 €') === 3.5 && parseEur('') === null && parseEur('abc') === undefined, 'parseEur')

console.log('ok')
