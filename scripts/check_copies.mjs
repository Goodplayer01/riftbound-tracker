import { cardEur, cardInvest, cleanCopyBook, fitLots, parseEur, soldGroups, splitLot } from '../src/copies.ts'

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

// Pulled copies: kept by the cleaner without a price, counted in the value but not in paid / profit.
const pulledBook = cleanCopyBook({ p: [{ id: 'p', n: 1, pulled: true, buy: 5 }, { id: 'q', n: 1, buy: 2 }] })
assert(pulledBook.p[0].pulled === true && pulledBook.p[0].buy === null && !('pulled' in pulledBook.p[1]), 'pulled lot kept, price dropped')
const invP = cardInvest(pulledBook.p, { qty: 2, foil: 0 }, false, price)
assert(invP.copies === 1 && invP.paid === 2 && cardEur(pulledBook.p, { qty: 2, foil: 0 }, false, price) === 20, 'pulled copies have value, no cost')

// Splitting a lot: one copy moves into its own lot right after, without a price.
const split = splitLot([a, b], 'a', 'a2')
assert(split.length === 3 && split[0].n === 1 && split[1].id === 'a2' && split[1].n === 1 && split[1].buy === null && split[2] === b, 'split lot')
assert(splitLot([lot('s', false, 1, 1)], 's', 'x').length === 1, 'single copy lot does not split')

assert(parseEur('3,50 €') === 3.5 && parseEur('') === null && parseEur('abc') === undefined, 'parseEur')

console.log('ok')
